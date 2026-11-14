package content

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// ResolvedMedia 是「粘贴链接即播」的解析结果。
// PlayURL 交给播放页作为 filePath，MediaKey 是播放历史里稳定的标识：
// B站 的代理地址每次会话都会变，所以历史用 bili:<bvid>，YouTube 用 yt:<id>。
type ResolvedMedia struct {
	OK            bool    `json:"ok"`
	Kind          string  `json:"kind"`     // bilibili | youtube | unsupported
	MediaKey      string  `json:"mediaKey"` // 播放历史标识
	PlayURL       string  `json:"playUrl"`  // 播放器地址
	VideoID       string  `json:"videoId"`  // 平台原始 ID（BVxxx / 11 位）
	Title         string  `json:"title"`
	Cover         string  `json:"cover"`
	Duration      float64 `json:"duration"`
	NeedSubscribe bool    `json:"needSubscribe"`
	FeedURL       string  `json:"feedUrl"`
	Error         string  `json:"error"`
}

var (
	// 剪贴板里常常是「标题 + 链接」，只取第一段 http(s) 地址
	firstURLRe = regexp.MustCompile(`https?://[^\s<>"']+`)
	youtubeID  = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)
	bilibiliBV = regexp.MustCompile(`^BV[0-9A-Za-z]+$`)
)

// ResolveMediaURL 解析粘贴进来的链接：可播放的返回播放地址，频道链接返回订阅引导，
// 直播/番剧/付费等明确不支持的内容给出可直接展示的原因。
func (s *MediaService) ResolveMediaURL(rawURL string) ResolvedMedia {
	raw := strings.TrimSpace(rawURL)
	if m := firstURLRe.FindString(raw); m != "" {
		raw = m
	}
	// 粘贴的中文文本常把标点紧跟在链接后面，去掉尾部标点再解析
	raw = strings.TrimRight(raw, ".,;:!?)]}>，。、；：！？）】」》")
	if raw == "" {
		return ResolvedMedia{Error: "没有识别到链接，请粘贴 YouTube 或 B站 视频地址"}
	}

	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" {
		return ResolvedMedia{Error: "链接格式不正确，请粘贴完整的视频地址"}
	}

	host := strings.ToLower(u.Hostname())
	switch {
	case isYouTubeHost(host):
		return s.resolveYouTube(u, raw)
	case isBilibiliHost(host):
		return s.resolveBilibili(u, raw)
	}
	return ResolvedMedia{Error: "暂不支持该链接，目前仅支持 YouTube 与 B站 视频地址"}
}

func isYouTubeHost(host string) bool {
	return host == "youtube.com" || host == "youtu.be" ||
		strings.HasSuffix(host, ".youtube.com") || host == "youtube-nocookie.com" ||
		strings.HasSuffix(host, ".youtube-nocookie.com")
}

func isBilibiliHost(host string) bool {
	return host == "bilibili.com" || host == "b23.tv" || host == "bili2233.cn" ||
		strings.HasSuffix(host, ".bilibili.com") || strings.HasSuffix(host, ".b23.tv")
}

// --- YouTube ---

func (s *MediaService) resolveYouTube(u *url.URL, raw string) ResolvedMedia {
	host := strings.ToLower(u.Hostname())
	path := strings.TrimSuffix(u.Path, "/")

	if strings.Contains(path, "/live/") {
		return ResolvedMedia{Kind: "unsupported", Error: "暂不支持 YouTube 直播，请在直播结束后再试"}
	}

	if host == "youtu.be" {
		id := strings.TrimPrefix(u.Path, "/")
		if i := strings.IndexAny(id, "/?#"); i >= 0 {
			id = id[:i]
		}
		return s.youtubeVideo(id)
	}

	switch {
	case path == "/watch":
		return s.youtubeVideo(u.Query().Get("v"))
	case strings.HasPrefix(path, "/shorts/"):
		return s.youtubeVideo(strings.TrimPrefix(path, "/shorts/"))
	case strings.HasPrefix(path, "/embed/"):
		return s.youtubeVideo(strings.TrimPrefix(path, "/embed/"))
	case path == "/playlist":
		return ResolvedMedia{Kind: "unsupported", Error: "暂不支持播放列表，请粘贴单个视频链接，或订阅对应频道"}
	case strings.HasPrefix(path, "/@"), strings.HasPrefix(path, "/channel/"),
		strings.HasPrefix(path, "/user/"), strings.HasPrefix(path, "/c/"):
		return s.channelSubscribe(raw)
	}
	return ResolvedMedia{Kind: "unsupported", Error: "无法从该链接中识别出视频，请粘贴 YouTube 视频地址"}
}

func (s *MediaService) youtubeVideo(id string) ResolvedMedia {
	id = strings.TrimSpace(id)
	if !youtubeID.MatchString(id) {
		return ResolvedMedia{Kind: "unsupported", Error: "无法从链接中识别出 YouTube 视频 ID"}
	}

	// 用 oEmbed 取标题与封面；失败通常意味着当前网络访问不到 YouTube
	var meta struct {
		Title        string `json:"title"`
		ThumbnailURL string `json:"thumbnail_url"`
	}
	oembed := "https://www.youtube.com/oembed?format=json&url=" +
		url.QueryEscape("https://www.youtube.com/watch?v="+id)
	if err := s.fetchJSONWithTimeout(oembed, &meta, 12*time.Second); err != nil {
		return ResolvedMedia{
			Kind:  "youtube",
			Error: "无法访问 YouTube，请在播客页配置网络代理后重试",
		}
	}

	return ResolvedMedia{
		OK:       true,
		Kind:     "youtube",
		MediaKey: "yt:" + id,
		PlayURL:  "yt:" + id,
		VideoID:  id,
		Title:    meta.Title,
		Cover:    meta.ThumbnailURL,
	}
}

// --- Bilibili ---

func (s *MediaService) resolveBilibili(u *url.URL, raw string) ResolvedMedia {
	host := strings.ToLower(u.Hostname())
	path := strings.TrimSuffix(u.Path, "/")

	if host == "live.bilibili.com" {
		return ResolvedMedia{Kind: "unsupported", Error: "暂不支持 B站 直播，请在直播结束后再试"}
	}
	if host == "bangumi.bilibili.com" || strings.HasPrefix(path, "/bangumi/") {
		return ResolvedMedia{Kind: "unsupported", Error: "暂不支持番剧/影视内容，请选择普通投稿视频"}
	}

	// b23.tv / bili2233.cn 短链先跟随重定向拿到真实地址
	if host == "b23.tv" || host == "bili2233.cn" || strings.HasSuffix(host, ".b23.tv") {
		target, err := s.followShortLink(raw)
		if err != nil {
			return ResolvedMedia{Kind: "unsupported", Error: "短链解析失败，请直接粘贴 bilibili.com 视频地址"}
		}
		targetURL, err := url.Parse(target)
		if err != nil {
			return ResolvedMedia{Kind: "unsupported", Error: "短链解析失败，请直接粘贴 bilibili.com 视频地址"}
		}
		return s.resolveBilibili(targetURL, target)
	}

	if strings.HasPrefix(path, "/video/") {
		rest := strings.TrimPrefix(path, "/video/")
		if bv := strings.Split(rest, "/")[0]; bilibiliBV.MatchString(bv) {
			return s.bilibiliVideo(bv)
		}
		if strings.HasPrefix(rest, "av") {
			return ResolvedMedia{Kind: "unsupported", Error: "暂不支持 av 号链接，请使用包含 BV 号的视频地址"}
		}
		return ResolvedMedia{Kind: "unsupported", Error: "无法从链接中识别出 B站 视频 ID"}
	}

	if path == "/list" || strings.HasPrefix(path, "/list/") ||
		path == "/medialist" || strings.HasPrefix(path, "/medialist/") ||
		path == "/favlist" {
		return ResolvedMedia{Kind: "unsupported", Error: "暂不支持播放列表/收藏夹，请粘贴单个视频链接"}
	}

	if host == "space.bilibili.com" {
		return s.channelSubscribe(raw)
	}

	return ResolvedMedia{Kind: "unsupported", Error: "无法从该链接中识别出视频，请粘贴 B站 视频地址"}
}

func (s *MediaService) bilibiliVideo(bvid string) ResolvedMedia {
	res := s.GetBilibiliStream(bvid)
	if !res.OK || res.URL == "" {
		return ResolvedMedia{Kind: "unsupported", Error: biliResolveError(res.Error)}
	}
	return ResolvedMedia{
		OK:       true,
		Kind:     "bilibili",
		MediaKey: "bili:" + bvid,
		PlayURL:  res.URL,
		VideoID:  bvid,
		Title:    res.Title,
		Cover:    res.Cover,
		Duration: float64(res.Duration),
	}
}

// biliResolveError 把接口错误翻译成用户能直接理解的原因
func biliResolveError(msg string) string {
	switch {
	case msg == "":
		return "获取 B站 播放地址失败"
	case strings.Contains(msg, "-404"):
		return "视频不存在或已被删除"
	case strings.Contains(msg, "-403"):
		return "该视频需要登录或权限不足（可能是大会员/付费内容）"
	case strings.Contains(msg, "大会员"):
		return msg
	case strings.Contains(msg, "DASH"):
		return "该视频仅提供高清分轨，暂不支持直接播放"
	}
	return msg
}

// channelSubscribe 频道/UP主空间链接：转换成订阅地址，交给播客页引导订阅
func (s *MediaService) channelSubscribe(raw string) ResolvedMedia {
	res := ResolvedMedia{Kind: "unsupported", NeedSubscribe: true}
	if s.rssConvertFn == nil {
		res.Error = "频道订阅不可用，请到播客页手动添加订阅"
		return res
	}
	converted := s.rssConvertFn(raw)
	if converted.OK && converted.RSSURL != "" {
		res.FeedURL = converted.RSSURL
		return res
	}
	// 转换失败也保留 needSubscribe，前端会带着原链接跳到播客页手动处理
	res.Error = converted.Error
	return res
}

// SetRSSConverter 注入频道链接转订阅源的实现（由 bootstrap 关联 PlatformService）
func (s *MediaService) SetRSSConverter(fn func(string) RSSConvertResult) {
	s.rssConvertFn = fn
}

// fetchJSONWithTimeout 用订阅配置的代理拉取 JSON，避免 resolve 时长时间挂起
func (s *MediaService) fetchJSONWithTimeout(target string, out any, timeout time.Duration) error {
	client := s.remoteClientFn
	var httpClient *http.Client
	if client != nil {
		httpClient = client()
	}
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", bilibiliWebUA)
	req.Header.Set("Accept", "application/json")
	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// followShortLink 跟随短链重定向，只取最终地址，不读取页面内容
func (s *MediaService) followShortLink(raw string) (string, error) {
	httpClient := http.DefaultClient
	if s.remoteClientFn != nil {
		if c := s.remoteClientFn(); c != nil {
			httpClient = c
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", bilibiliWebUA)
	resp, err := httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.Request == nil || resp.Request.URL == nil {
		return raw, nil
	}
	return resp.Request.URL.String(), nil
}
