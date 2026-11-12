package content

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"aling-go/internal/core"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// PlatformService 处理 YouTube / Bilibili 的链接解析与字幕抓取。
// YouTube 字幕交给 yt-dlp，视频没有字幕轨道时用本地 Whisper 转录音轨；B 站调官方公开 API。
// 订阅层面仍然复用 FeedService，本服务只做「链接转换」和「字幕获取」两件事。
type PlatformService struct {
	app     *application.App
	feed    *FeedService
	whisper *WhisperService
	dataDir string

	mu        sync.RWMutex
	rssHubURL string
}

func NewPlatformService(app *application.App, dataDir string, feed *FeedService, whisper *WhisperService) *PlatformService {
	return &PlatformService{
		app:     app,
		feed:    feed,
		whisper: whisper,
		dataDir: dataDir,
	}
}

func (s *PlatformService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	return nil
}

func (s *PlatformService) ServiceShutdown() error { return nil }

// --- 链接识别与转换 ---

type platformKind int

const (
	platformUnknown platformKind = iota
	platformYouTube
	platformBilibili
)

var (
	// YouTube 各种链接形态
	// 频道: https://www.youtube.com/@MKBHD  https://www.youtube.com/channel/UCxxx
	// 视频: https://www.youtube.com/watch?v=abc123  https://youtu.be/abc123
	youtubeShortRe   = regexp.MustCompile(`^(?:https?://)?(?:www\.)?youtu\.be/([a-zA-Z0-9_-]{11})`)
	youtubeWatchRe   = regexp.MustCompile(`^(?:https?://)?(?:www\.)?youtube\.com/watch\?(?:[^#]*&)?v=([a-zA-Z0-9_-]{11})`)
	youtubeEmbedRe   = regexp.MustCompile(`^(?:https?://)?(?:www\.)?youtube\.com/embed/([a-zA-Z0-9_-]{11})`)
	youtubeAtRe      = regexp.MustCompile(`^(?:https?://)?(?:www\.)?youtube\.com/@([^/?#]+)`)
	youtubeChannelRe = regexp.MustCompile(`^(?:https?://)?(?:www\.)?youtube\.com/channel/([a-zA-Z0-9_-]{16,32})`)
	youtubeUserRe    = regexp.MustCompile(`^(?:https?://)?(?:www\.)?youtube\.com/user/([^/?#]+)`)

	// Bilibili
	// UP主空间: https://space.bilibili.com/123456
	// 视频: https://www.bilibili.com/video/BV1xxx
	bilibiliSpaceRe = regexp.MustCompile(`^(?:https?://)?space\.bilibili\.com/(\d+)`)
	bilibiliBVRe    = regexp.MustCompile(`^(?:https?://)?(?:www\.)?bilibili\.com/video/(BV[a-zA-Z0-9]+)`)
	bilibiliAvRe    = regexp.MustCompile(`^(?:https?://)?(?:www\.)?bilibili\.com/video/av(\d+)`)
)

// DetectPlatform 识别一个 URL 属于哪个平台，返回平台类型和提取到的关键标识
func DetectPlatform(rawURL string) (kind platformKind, id string) {
	rawURL = strings.TrimSpace(rawURL)
	lower := strings.ToLower(rawURL)

	if strings.Contains(lower, "youtube.com") || strings.Contains(lower, "youtu.be") {
		if m := youtubeChannelRe.FindStringSubmatch(rawURL); len(m) == 2 {
			return platformYouTube, m[1]
		}
		if m := youtubeAtRe.FindStringSubmatch(rawURL); len(m) == 2 {
			return platformYouTube, "@" + m[1]
		}
		if m := youtubeUserRe.FindStringSubmatch(rawURL); len(m) == 2 {
			return platformYouTube, "user:" + m[1]
		}
		if m := youtubeWatchRe.FindStringSubmatch(rawURL); len(m) == 2 {
			return platformYouTube, "video:" + m[1]
		}
		if m := youtubeShortRe.FindStringSubmatch(rawURL); len(m) == 2 {
			return platformYouTube, "video:" + m[1]
		}
		if m := youtubeEmbedRe.FindStringSubmatch(rawURL); len(m) == 2 {
			return platformYouTube, "video:" + m[1]
		}
		return platformYouTube, ""
	}

	if strings.Contains(lower, "bilibili.com") || strings.Contains(lower, "b23.tv") {
		if m := bilibiliSpaceRe.FindStringSubmatch(rawURL); len(m) == 2 {
			return platformBilibili, m[1]
		}
		if m := bilibiliBVRe.FindStringSubmatch(rawURL); len(m) == 2 {
			return platformBilibili, "bv:" + m[1]
		}
		if m := bilibiliAvRe.FindStringSubmatch(rawURL); len(m) == 2 {
			return platformBilibili, "av:" + m[1]
		}
		return platformBilibili, ""
	}

	return platformUnknown, ""
}

// ConvertToRSS 把 YouTube/B站 频道链接转换成订阅源 RSS URL
// 返回值 JSON: { ok, rssUrl, platform, error }
func (s *PlatformService) ConvertToRSS(rawURL string) string {
	kind, id := DetectPlatform(rawURL)
	out := map[string]any{"ok": false}

	switch kind {
	case platformYouTube:
		rss, err := s.youTubeToRSS(rawURL, id)
		if err != nil {
			out["error"] = err.Error()
		} else {
			out["ok"] = true
			out["rssUrl"] = rss
			out["platform"] = "youtube"
		}
	case platformBilibili:
		rss, err := s.bilibiliToRSS(id)
		if err != nil {
			out["error"] = err.Error()
		} else {
			out["ok"] = true
			out["rssUrl"] = rss
			out["platform"] = "bilibili"
		}
	default:
		out["error"] = "无法识别的链接，请粘贴 YouTube 频道主页或 B站 UP主空间链接"
	}
	b, _ := json.Marshal(out)
	return string(b)
}

// youTubeToRSS 根据 YouTube 链接形态生成 RSS URL
func (s *PlatformService) youTubeToRSS(rawURL, id string) (string, error) {
	if id == "" {
		return "", fmt.Errorf("无法从链接中提取频道标识")
	}

	// 已经是 channel_id 格式（纯字母数字，长度 24+）
	if len(id) >= 20 && !strings.HasPrefix(id, "@") && !strings.HasPrefix(id, "video:") && !strings.HasPrefix(id, "user:") {
		return "https://www.youtube.com/feeds/videos.xml?channel_id=" + id, nil
	}

	switch {
	case strings.HasPrefix(id, "@"):
		// handle → channel_id 需要 HTTP 抓取页面解析
		channelID, err := s.resolveYouTubeHandle(id)
		if err != nil {
			return "", err
		}
		return "https://www.youtube.com/feeds/videos.xml?channel_id=" + channelID, nil
	case strings.HasPrefix(id, "user:"):
		// user → channel_id
		userName := strings.TrimPrefix(id, "user:")
		channelID, err := s.resolveYouTubeUser(userName)
		if err != nil {
			return "", err
		}
		return "https://www.youtube.com/feeds/videos.xml?channel_id=" + channelID, nil
	case strings.HasPrefix(id, "video:"):
		return "", fmt.Errorf("视频链接不能直接订阅，请粘贴频道主页链接")
	}

	return "", fmt.Errorf("无法从链接中提取频道标识")
}

// resolveYouTubeHandle 抓取 @handle 频道主页，提取页面内嵌的 channelId
func (s *PlatformService) resolveYouTubeHandle(handle string) (string, error) {
	client := s.feed.httpClient()
	req, _ := http.NewRequest(http.MethodGet, "https://www.youtube.com/"+handle, nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("无法访问 YouTube: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("无法访问 YouTube: HTTP %s", resp.Status)
	}
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	return extractYouTubeChannelID(data)
}

// extractYouTubeChannelID 从 YouTube 频道页面 HTML 中提取频道 ID
// 依次尝试：externalId、channelId、canonical link
func extractYouTubeChannelID(data []byte) (string, error) {
	// YouTube 页面字段名经历过 channelId → externalId 的变更，两种都匹配
	re := regexp.MustCompile(`"(?:channelId|externalId)":"([A-Za-z0-9_-]{20,})"`)
	if m := re.FindSubmatch(data); len(m) == 2 {
		return string(m[1]), nil
	}
	// 兜底：先提取 link href，再用已锚定的频道 URL 规则校验，避免匹配页面正文中的伪造地址
	canonicalHrefRe := regexp.MustCompile(`(?i)<link\b[^>]*\bhref="([^"]+)"`)
	for _, m := range canonicalHrefRe.FindAllSubmatch(data, -1) {
		if channel := youtubeChannelRe.FindSubmatch(m[1]); len(channel) == 2 {
			return string(channel[1]), nil
		}
	}
	return "", fmt.Errorf("未能从页面解析出频道 ID")
}

func (s *PlatformService) resolveYouTubeUser(userName string) (string, error) {
	client := s.feed.httpClient()
	req, _ := http.NewRequest(http.MethodGet, "https://www.youtube.com/user/"+userName, nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("无法访问 YouTube: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("无法访问 YouTube: HTTP %s", resp.Status)
	}
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	return extractYouTubeChannelID(data)
}

// bilibiliToRSS 返回 B站 UP 主空间链接，拉取时由 FeedService 直接调官方 wbi 签名 API
// 不再依赖 RSSHub（公共实例普遍 403）
func (s *PlatformService) bilibiliToRSS(id string) (string, error) {
	if id == "" {
		return "", fmt.Errorf("无法从链接中提取 UP主 ID")
	}
	if strings.HasPrefix(id, "bv:") || strings.HasPrefix(id, "av:") {
		return "", fmt.Errorf("视频链接不能直接订阅，请粘贴 UP主 空间链接")
	}
	return "https://space.bilibili.com/" + id, nil
}

// --- RSSHub 实例配置 ---

func (s *PlatformService) GetRSSHubURL() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.rssHubURL
}

// SetRSSHubURL 设置 RSSHub 实例地址，留空使用默认公共实例
func (s *PlatformService) SetRSSHubURL(u string) string {
	u = strings.TrimSpace(u)
	if u != "" {
		if pu, err := url.Parse(u); err != nil || (pu.Scheme != "http" && pu.Scheme != "https") {
			b, _ := json.Marshal(map[string]any{"ok": false, "error": "RSSHub 地址需以 http:// 或 https:// 开头"})
			return string(b)
		}
	}
	s.mu.Lock()
	s.rssHubURL = u
	s.mu.Unlock()
	b, _ := json.Marshal(map[string]any{"ok": true})
	return string(b)
}

// --- 字幕抓取 ---

type SubtitleCue struct {
	Start float64 `json:"start"`
	End   float64 `json:"end"`
	Text  string  `json:"text"`
}

// TranscribePodcast 转录 RSS 节目。已下载节目直接使用本地文件；在线节目临时下载音频，
// 转录完成后删除临时文件。字幕按本地路径或音频 URL 缓存，force 用于显式重新转录。
func (s *PlatformService) TranscribePodcast(episodeID int64, force bool) string {
	fail := func(err error) string {
		b, _ := json.Marshal(map[string]any{"ok": false, "error": err.Error()})
		return string(b)
	}

	var audioURL, localPath string
	if err := core.DB.QueryRow(`SELECT audio_url, local_path FROM feed_episodes WHERE id = ?`, episodeID).
		Scan(&audioURL, &localPath); err != nil {
		return fail(fmt.Errorf("节目不存在"))
	}
	if localPath != "" {
		if _, err := os.Stat(localPath); err != nil {
			localPath = ""
		}
	}
	cacheKey := localPath
	if cacheKey == "" {
		cacheKey = audioURL
	}
	if cacheKey == "" {
		return fail(fmt.Errorf("该节目没有可转录的音频"))
	}

	cachePath := filepath.Join(s.dataDir, "subtitle-cache", md5Hash(cacheKey)+".json")
	if !force {
		if raw, err := os.ReadFile(cachePath); err == nil {
			var cached []SubtitleItem
			if json.Unmarshal(raw, &cached) == nil && len(cached) > 0 {
				b, _ := json.Marshal(map[string]any{"ok": true, "subtitles": cached, "cached": true})
				return string(b)
			}
		}
	}

	if err := s.checkWhisperReady(); err != nil {
		return fail(err)
	}
	var (
		cues []SubtitleCue
		err  error
	)
	if localPath != "" {
		cues, err = s.transcribeAudioFile(localPath)
	} else {
		s.app.Event.Emit("whisper:progress", whisperProgress{Progress: 0, Status: "downloading"})
		// 与 YouTube/B站一致：yt-dlp 下载到临时目录，函数返回前自动清理。
		cues, err = s.transcribeAudio(audioURL)
	}
	if err != nil {
		return fail(err)
	}

	items := make([]SubtitleItem, 0, len(cues))
	for i, cue := range cues {
		items = append(items, SubtitleItem{
			ID:        i + 1,
			StartTime: cue.Start,
			EndTime:   cue.End,
			Text:      cue.Text,
		})
	}
	if raw, marshalErr := json.Marshal(items); marshalErr == nil {
		_ = os.MkdirAll(filepath.Dir(cachePath), 0755)
		_ = os.WriteFile(cachePath, raw, 0644)
	}
	b, _ := json.Marshal(map[string]any{"ok": true, "subtitles": items, "cached": false})
	return string(b)
}

// GetSubtitles 根据 FeedEpisode 的 link 字段抓取平台字幕
// 输入是 platformService 内部存储的 episode_link，自动识别平台
func (s *PlatformService) GetSubtitles(episodeID int64) string {
	var (
		feedID   int64
		title    string
		link     string
		audioURL string
	)
	_ = core.DB.QueryRow(`
		SELECT feed_id, title, link, audio_url FROM feed_episodes WHERE id = ?`, episodeID).
		Scan(&feedID, &title, &link, &audioURL)

	// 播客源优先：如果有音频直链且音频字幕已缓存，直接返回缓存
	if audioURL != "" {
		// 检查 whisper 缓存字幕
		out := map[string]any{"ok": false, "error": "播客源请使用页面右上角的「转录字幕」按钮"}
		b, _ := json.Marshal(out)
		return string(b)
	}

	if link == "" {
		b, _ := json.Marshal(map[string]any{"ok": false, "error": "该节目没有关联的视频页面链接"})
		return string(b)
	}

	kind, id := DetectPlatform(link)
	cacheKey := md5Hash("platform:" + kindLabel(kind) + ":" + id)
	cachePath := filepath.Join(s.dataDir, "subtitle-cache", cacheKey+".json")

	var cues []SubtitleCue
	if raw, err := os.ReadFile(cachePath); err == nil {
		var cached []SubtitleCue
		if err := json.Unmarshal(raw, &cached); err == nil {
			cues = cached
		}
	}

	if len(cues) == 0 {
		var err error
		switch kind {
		case platformYouTube:
			cues, err = s.fetchYouTubeSubtitles(id)
		case platformBilibili:
			cues, err = s.fetchBilibiliSubtitles(id)
		default:
			err = fmt.Errorf("不支持的平台链接")
		}
		if err != nil {
			b, _ := json.Marshal(map[string]any{"ok": false, "error": err.Error(), "platform": kindLabel(kind)})
			return string(b)
		}

		if raw, err := json.Marshal(cues); err == nil {
			_ = os.MkdirAll(filepath.Dir(cachePath), 0755)
			_ = os.WriteFile(cachePath, raw, 0644)
		}
	}

	b, _ := json.Marshal(map[string]any{
		"ok":       true,
		"platform": kindLabel(kind),
		"videoId":  id,
		"title":    title,
		"cues":     cues,
	})
	return string(b)
}

func kindLabel(k platformKind) string {
	switch k {
	case platformYouTube:
		return "youtube"
	case platformBilibili:
		return "bilibili"
	}
	return "unknown"
}

// fetchYouTubeSubtitles 先由 yt-dlp 取现成字幕，取不到时下载音轨走本地 Whisper 转录
func (s *PlatformService) fetchYouTubeSubtitles(id string) ([]SubtitleCue, error) {
	videoID := strings.TrimPrefix(id, "video:")
	if len(videoID) != 11 {
		return nil, fmt.Errorf("无效的 YouTube 视频 ID")
	}

	cues, subErr := s.fetchYouTubeSubtitlesViaYtDlp(videoID)
	if subErr == nil && len(cues) > 0 {
		return cues, nil
	}
	s.app.Logger.Info("YouTube 字幕抓取失败，尝试本地转录", "videoId", videoID, "error", subErr)

	cues, trErr := s.transcribeYouTubeAudio(videoID)
	if trErr == nil && len(cues) > 0 {
		return cues, nil
	}
	return nil, fmt.Errorf("YouTube 无可用字幕（%v），本地转录失败（%v）", subErr, trErr)
}

// fetchBilibiliSubtitles 先抓 B站字幕，接口连续未返回字幕时下载音轨走本地 Whisper 转录。
func (s *PlatformService) fetchBilibiliSubtitles(id string) ([]SubtitleCue, error) {
	bvid := strings.TrimPrefix(id, "bv:")
	if bvid == "" || !strings.HasPrefix(bvid, "BV") {
		return nil, fmt.Errorf("无效的 B站视频 ID")
	}

	cues, subErr := s.fetchBilibiliSubtitleTrack(bvid)
	if subErr == nil && len(cues) > 0 {
		return cues, nil
	}
	s.app.Logger.Info("B站字幕抓取失败，尝试本地转录", "bvid", bvid, "error", subErr)

	cues, trErr := s.transcribeBilibiliAudio(bvid)
	if trErr == nil && len(cues) > 0 {
		return cues, nil
	}
	return nil, fmt.Errorf("B站无可用字幕（%v），本地转录失败（%v）", subErr, trErr)
}

func (s *PlatformService) fetchBilibiliSubtitleTrack(bvid string) ([]SubtitleCue, error) {
	// BV 转 cid（view 的 subtitle.list 为空，AI 字幕要走 player/v2）
	client := s.feed.httpClient()
	cookie := s.feed.bilibiliCookie()

	var viewResp struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Data    struct {
			Cid int `json:"cid"`
		} `json:"data"`
	}
	if err := fetchBiliJSON(client, cookie, "https://api.bilibili.com/x/web-interface/view?bvid="+bvid, &viewResp); err != nil {
		return nil, fmt.Errorf("无法访问 B站: %w", err)
	}
	if viewResp.Code != 0 {
		return nil, fmt.Errorf("bilibili api error: %s", viewResp.Message)
	}

	// player/v2 才会返回 UP 主字幕与 AI 字幕（ai-zh / ai-en）。
	// 接口偶尔会返回空列表；AI 字幕接口实测会返回与视频不符的内容，这里只采用 UP 主上传的字幕。
	var playerResp struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Data    struct {
			Subtitle struct {
				Subtitles []struct {
					Lan         string `json:"lan"`
					LanDoc      string `json:"lan_doc"`
					SubtitleURL string `json:"subtitle_url"`
				} `json:"subtitles"`
			} `json:"subtitle"`
		} `json:"data"`
	}
	playerAPI := fmt.Sprintf("https://api.bilibili.com/x/player/v2?bvid=%s&cid=%d", bvid, viewResp.Data.Cid)
	var fetchErr error
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			time.Sleep(300 * time.Millisecond)
			playerResp.Data.Subtitle.Subtitles = nil
		}
		fetchErr = fetchBiliJSON(client, cookie, playerAPI, &playerResp)
		hasOfficial := false
		for _, sub := range playerResp.Data.Subtitle.Subtitles {
			if !strings.HasPrefix(sub.Lan, "ai-") {
				hasOfficial = true
				break
			}
		}
		if fetchErr == nil && playerResp.Code == 0 && hasOfficial {
			break
		}
	}
	if fetchErr != nil {
		return nil, fmt.Errorf("获取字幕列表失败: %w", fetchErr)
	}
	if playerResp.Code != 0 {
		return nil, fmt.Errorf("bilibili api error: %s", playerResp.Message)
	}
	subs := playerResp.Data.Subtitle.Subtitles
	if len(subs) == 0 {
		return nil, fmt.Errorf("该视频没有可用字幕")
	}

	// 优先 UP 主上传的英文字幕，其次中文和其他官方字幕
	var target *string
	choose := func(langs ...string) {
		if target != nil {
			return
		}
		for i := range subs {
			lan := subs[i].Lan
			if strings.HasPrefix(lan, "ai-") {
				continue
			}
			for _, want := range langs {
				if want == "*" || strings.HasPrefix(lan, want) {
					target = &subs[i].SubtitleURL
					return
				}
			}
		}
	}
	choose("en", "e")
	choose("zh")
	choose("*")
	if target == nil {
		return nil, fmt.Errorf("没有 UP 主上传的字幕")
	}

	subURL := *target
	if !strings.HasPrefix(subURL, "http") {
		subURL = "https:" + subURL
	}

	req2, _ := http.NewRequest(http.MethodGet, subURL, nil)
	req2.Header.Set("User-Agent", "Mozilla/5.0 Chrome/120")
	req2.Header.Set("Referer", "https://www.bilibili.com")
	resp2, err := client.Do(req2)
	if err != nil {
		return nil, fmt.Errorf("获取字幕失败: %w", err)
	}
	defer resp2.Body.Close()
	raw2, _ := io.ReadAll(resp2.Body)

	var subResp struct {
		Body []struct {
			From    float64 `json:"from"`
			To      float64 `json:"to"`
			Content string  `json:"content"`
		} `json:"body"`
	}
	if err := json.Unmarshal(raw2, &subResp); err != nil {
		return nil, fmt.Errorf("解析字幕失败: %w", err)
	}
	cues := make([]SubtitleCue, 0, len(subResp.Body))
	for _, b := range subResp.Body {
		cues = append(cues, SubtitleCue{
			Start: b.From,
			End:   b.To,
			Text:  strings.TrimSpace(b.Content),
		})
	}
	if len(cues) == 0 {
		return nil, fmt.Errorf("该视频没有可用字幕条目")
	}
	return cues, nil
}

// --- 给前端用的小工具 ---

// ExtractYouTubeVideoID 从任意 YouTube 链接提取 11 位 videoId，失败返回空串
func ExtractYouTubeVideoID(rawURL string) string {
	rawURL = strings.TrimSpace(rawURL)
	for _, re := range []*regexp.Regexp{
		youtubeWatchRe, youtubeShortRe, youtubeEmbedRe,
	} {
		if m := re.FindStringSubmatch(rawURL); len(m) == 2 {
			return m[1]
		}
	}
	return ""
}

// ExtractBilibiliBVID 从任意 B站 链接提取 BV 号
func ExtractBilibiliBVID(rawURL string) string {
	rawURL = strings.TrimSpace(rawURL)
	if m := bilibiliBVRe.FindStringSubmatch(rawURL); len(m) == 2 {
		return m[1]
	}
	return ""
}
