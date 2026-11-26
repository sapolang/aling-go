package content

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	"github.com/google/uuid"
)

// B站播放器 iframe 相对应用页面属第三方站点，WebKit/Chromium 都会拦截其 Cookie，
// 登录态拿不到、画质只能 360P。这里改由 Go 侧带订阅 Cookie 调 playurl 取流，
// 再经本地媒体服务补上 Referer 代理给页面内的 <video>，单窗口、全平台一致。

var bvidRe = regexp.MustCompile(`^BV[0-9A-Za-z]+$`)

// biliMediaHostSuffixes 允许代理的 B站 CDN 域名，避免变成任意地址的开放代理。
// B站会把 durl[0].url 动态分配到 *.edge.mountaintoys.cn（每次请求随机子域），需一并放行。
var biliMediaHostSuffixes = []string{".bilivideo.com", ".bilivideo.cn", ".hdslb.com", ".mountaintoys.cn"}

var biliQualityLabels = map[int]string{
	127: "8K",
	126: "杜比视界",
	125: "HDR",
	120: "4K",
	116: "1080P60",
	112: "1080P+",
	80:  "1080P",
	74:  "720P60",
	64:  "720P",
	32:  "480P",
	16:  "360P",
}

// BiliStreamPart 是 B站视频的一个分 P。Duration 为该 P 自身时长（秒），
// 与 BiliStreamResult.Duration（所有 P 累加的总时长）区分。
type BiliStreamPart struct {
	CID      int64  `json:"cid"`
	Page     int    `json:"page"`
	Title    string `json:"title"`
	Duration int    `json:"duration"`
}

type BiliStreamResult struct {
	OK           bool             `json:"ok"`
	URL          string           `json:"url"`
	Quality      int              `json:"quality"`
	QualityLabel string           `json:"qualityLabel"`
	Duration     int              `json:"duration"`
	CID          int64            `json:"cid"`
	Parts        []BiliStreamPart `json:"parts"`
	Title        string           `json:"title"`
	Cover        string           `json:"cover"`
	Error        string           `json:"error"`
}

type biliViewResponse struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    struct {
		Title    string `json:"title"`
		Duration int    `json:"duration"`
		CID      int64  `json:"cid"`
		Pic      string `json:"pic"`
		Pages    []struct {
			CID      int64  `json:"cid"`
			Page     int    `json:"page"`
			Part     string `json:"part"`
			Duration int    `json:"duration"`
		} `json:"pages"`
	} `json:"data"`
}

type biliPlayURLDURL struct {
	URL       string   `json:"url"`
	BackupURL []string `json:"backup_url"`
}

type biliPlayURLResponse struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    struct {
		Quality int               `json:"quality"`
		DURL    []biliPlayURLDURL `json:"durl"`
	} `json:"data"`
}

// SetBilibiliAuth 注入 B站 Cookie 与 HTTP 客户端（会带上用户配置的代理）
func (s *MediaService) SetBilibiliAuth(cookie func() string, client func() *http.Client) {
	s.biliCookieFn = cookie
	s.remoteClientFn = client
}

// GetBilibiliStream 用登录 Cookie 换取可直连的播放地址，返回给前端的是本地代理地址。
// cid 指定要播放的分 P；传 0 时沿用 view 接口返回的默认分 P（通常是 P1），兼容旧调用方。
// 返回值同时带上全部分 P 列表供前端切换；Duration 为当前 P 的时长（列表里的总时长是各 P 累加）。
func (s *MediaService) GetBilibiliStream(bvid string, cid int64) BiliStreamResult {
	bvid = strings.TrimSpace(bvid)
	if !bvidRe.MatchString(bvid) {
		return BiliStreamResult{Error: "视频 ID 不合法"}
	}
	if s.biliCookieFn == nil || s.remoteClientFn == nil {
		return BiliStreamResult{Error: "B 站取流未初始化"}
	}

	client := s.remoteClientFn()
	cookie := s.biliCookieFn()

	view, err := fetchBiliView(client, cookie, bvid)
	if err != nil {
		return BiliStreamResult{Error: err.Error()}
	}
	if view.Code != 0 {
		return BiliStreamResult{Error: biliAPIError("视频信息", view.Code, view.Message)}
	}
	if view.Data.CID == 0 {
		return BiliStreamResult{Error: "该视频没有可播放的分 P"}
	}

	parts := make([]BiliStreamPart, 0, len(view.Data.Pages))
	for _, p := range view.Data.Pages {
		if p.CID == 0 {
			continue
		}
		parts = append(parts, BiliStreamPart{
			CID:      p.CID,
			Page:     p.Page,
			Title:    p.Part,
			Duration: p.Duration,
		})
	}

	// 校验调用方传入的 cid 确实属于该视频，避免使用任意 cid 取流
	selected := view.Data.CID
	selectedDuration := view.Data.Duration
	if cid > 0 {
		found := false
		for _, p := range parts {
			if p.CID == cid {
				selected, selectedDuration, found = p.CID, p.Duration, true
				break
			}
		}
		if !found {
			return BiliStreamResult{Error: "分 P 不存在", Parts: parts, CID: view.Data.CID}
		}
	} else if len(parts) > 0 {
		// view.Data.Duration 是全部 P 的累加值；单 P 视频两者相等
		selectedDuration = parts[0].Duration
	}

	play, err := fetchBiliPlayURL(client, cookie, bvid, selected)
	if err != nil {
		return BiliStreamResult{Error: err.Error()}
	}
	if play.Code != 0 {
		return BiliStreamResult{Error: biliAPIError("播放地址", play.Code, play.Message)}
	}
	if len(play.Data.DURL) == 0 {
		return BiliStreamResult{Error: "该视频暂不支持直连播放（可能需要大会员或仅提供 DASH 分轨）", Parts: parts}
	}

	proxyURL := s.biliProxyURLForDURL(play.Data.DURL[0])
	if proxyURL == "" {
		return BiliStreamResult{Error: "播放地址未通过安全校验", Parts: parts}
	}
	label := biliQualityLabels[play.Data.Quality]
	if label == "" {
		label = fmt.Sprintf("%dP", play.Data.Quality)
	}
	return BiliStreamResult{
		OK:           true,
		URL:          proxyURL,
		Quality:      play.Data.Quality,
		QualityLabel: label,
		Duration:     selectedDuration,
		CID:          selected,
		Parts:        parts,
		Title:        view.Data.Title,
		Cover:        view.Data.Pic,
	}
}

func fetchBiliView(client *http.Client, cookie, bvid string) (biliViewResponse, error) {
	var out biliViewResponse
	err := fetchBiliJSON(client, cookie, "https://api.bilibili.com/x/web-interface/view?bvid="+url.QueryEscape(bvid), &out)
	return out, err
}

func fetchBiliPlayURL(client *http.Client, cookie, bvid string, cid int64) (biliPlayURLResponse, error) {
	var out biliPlayURLResponse
	// fnval=0 走 durl（整段 mp4），便于交给原生 <video> 直接播放；
	// 1080P 及以上通常只提供 DASH 分轨，此时 B站会回退到可用的最高 durl 画质
	api := fmt.Sprintf(
		"https://api.bilibili.com/x/player/playurl?bvid=%s&cid=%d&qn=80&fnver=0&fnval=0&fourk=1",
		url.QueryEscape(bvid), cid,
	)
	err := fetchBiliJSON(client, cookie, api, &out)
	return out, err
}

func fetchBiliJSON(client *http.Client, cookie, api string, out any) error {
	req, err := http.NewRequest(http.MethodGet, api, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", bilibiliWebUA)
	req.Header.Set("Referer", "https://www.bilibili.com/")
	if cookie != "" {
		req.Header.Set("Cookie", cookie)
	}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("请求 B 站失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("请求 B 站失败: HTTP %d", resp.StatusCode)
	}
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("解析 B 站响应失败: %w", err)
	}
	return nil
}

func biliAPIError(what string, code int, message string) string {
	if message == "" {
		return fmt.Sprintf("%s接口返回错误码 %d", what, code)
	}
	return fmt.Sprintf("%s接口返回错误码 %d: %s", what, code, message)
}

// biliProxyURLForDURL 按优先级尝试主地址与 B站返回的备用 CDN，取第一个通过安全校验的地址。
// B站会动态切换 durl[0].url 的 CDN 域名，主地址不在白名单时仍可从 backup_url 兜底。
func (s *MediaService) biliProxyURLForDURL(durl biliPlayURLDURL) string {
	candidates := make([]string, 0, 1+len(durl.BackupURL))
	if durl.URL != "" {
		candidates = append(candidates, durl.URL)
	}
	candidates = append(candidates, durl.BackupURL...)
	for _, upstream := range candidates {
		if proxy := s.biliProxyURL(upstream); proxy != "" {
			return proxy
		}
	}
	return ""
}

// biliProxyURL 把 B站 播放地址包装成本地代理地址，前端负责带 Cookie 拉流

func (s *MediaService) biliProxyURL(upstream string) string {
	parsed, err := url.Parse(upstream)
	if err != nil || parsed.Scheme != "https" || parsed.User != nil || !isBiliMediaHost(parsed.Hostname()) {
		return ""
	}
	id := uuid.NewString()
	s.biliMu.Lock()
	s.biliStreamID = id
	s.biliUpstream = parsed.String()
	s.biliMu.Unlock()
	return fmt.Sprintf("http://127.0.0.1:%d/bili-stream?id=%s", s.mediaPort, id)
}

// handleBiliStream 代理 B站 CDN 的视频分片：补上 Referer/UA，透传 Range 以支持拖动进度。
// 客户端只能提供 Go 侧生成的流 ID，不能直接指定上游 URL。
func (s *MediaService) handleBiliStream(w http.ResponseWriter, r *http.Request) {
	if s.remoteClientFn == nil {
		http.Error(w, "bilibili stream not initialized", http.StatusServiceUnavailable)
		return
	}
	s.biliMu.RLock()
	streamID, upstream := s.biliStreamID, s.biliUpstream
	s.biliMu.RUnlock()
	if streamID == "" || r.URL.Query().Get("id") != streamID {
		http.Error(w, "invalid stream id", http.StatusBadRequest)
		return
	}

	// upstream 只能由 biliProxyURL 在 HTTPS + CDN 白名单校验后登记，客户端无法直接提供。
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, upstream, nil)
	if err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	if rangeHeader := r.Header.Get("Range"); rangeHeader != "" {
		req.Header.Set("Range", rangeHeader)
	}
	req.Header.Set("Referer", "https://www.bilibili.com/")
	req.Header.Set("User-Agent", bilibiliWebUA)

	resp, err := s.remoteClientFn().Do(req)
	if err != nil {
		http.Error(w, "upstream request failed", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	for _, header := range []string{"Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "Last-Modified", "ETag"} {
		if value := resp.Header.Get(header); value != "" {
			w.Header().Set(header, value)
		}
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

func isBiliMediaHost(host string) bool {
	host = strings.ToLower(host)
	for _, suffix := range biliMediaHostSuffixes {
		if strings.HasSuffix(host, suffix) {
			return true
		}
	}
	return false
}
