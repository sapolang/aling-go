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
	"strconv"
	"strings"
	"sync"
	"time"

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

	// audioMu / audioFlights 让同一条音轨的预热与转录共享下载+转码，避免并发踩同一个缓存文件。
	audioMu      sync.Mutex
	audioFlights map[string]*audioFlight
}

// audioFlight 是一次音轨准备（下载 + 转码）的共享结果。
type audioFlight struct {
	done    chan struct{}
	wavPath string
	err     error
}

func NewPlatformService(app *application.App, dataDir string, feed *FeedService, whisper *WhisperService) *PlatformService {
	return &PlatformService{
		app:          app,
		feed:         feed,
		whisper:      whisper,
		dataDir:      dataDir,
		audioFlights: make(map[string]*audioFlight),
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

type RSSConvertResult struct {
	OK       bool   `json:"ok"`
	RSSURL   string `json:"rssUrl,omitempty"`
	Platform string `json:"platform,omitempty"`
	Error    string `json:"error,omitempty"`
}

type PodcastTranscribeResult struct {
	OK        bool           `json:"ok"`
	Subtitles []SubtitleItem `json:"subtitles,omitempty"`
	Cached    bool           `json:"cached"`
	Error     string         `json:"error,omitempty"`
}

type PlatformSubtitlesResult struct {
	OK       bool          `json:"ok"`
	Platform string        `json:"platform,omitempty"`
	VideoID  string        `json:"videoId,omitempty"`
	Title    string        `json:"title,omitempty"`
	Cues     []SubtitleCue `json:"cues,omitempty"`
	Error    string        `json:"error,omitempty"`
}

// ConvertToRSS 把 YouTube/B站 频道链接转换成订阅源 RSS URL
func (s *PlatformService) ConvertToRSS(rawURL string) RSSConvertResult {
	kind, id := DetectPlatform(rawURL)
	switch kind {
	case platformYouTube:
		rss, err := s.youTubeToRSS(rawURL, id)
		if err != nil {
			return RSSConvertResult{Error: err.Error()}
		}
		return RSSConvertResult{OK: true, RSSURL: rss, Platform: "youtube"}
	case platformBilibili:
		rss, err := s.bilibiliToRSS(id)
		if err != nil {
			return RSSConvertResult{Error: err.Error()}
		}
		return RSSConvertResult{OK: true, RSSURL: rss, Platform: "bilibili"}
	default:
		return RSSConvertResult{Error: "无法识别的链接，请粘贴 YouTube 频道主页或 B站 UP主空间链接"}
	}
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
func (s *PlatformService) SetRSSHubURL(u string) ActionResult {
	u = strings.TrimSpace(u)
	if u != "" {
		if pu, err := url.Parse(u); err != nil || (pu.Scheme != "http" && pu.Scheme != "https") {
			return ActionResult{Error: "RSSHub 地址需以 http:// 或 https:// 开头"}
		}
	}
	s.mu.Lock()
	s.rssHubURL = u
	s.mu.Unlock()
	return ActionResult{OK: true}
}

// --- 字幕抓取 ---

type SubtitleCue struct {
	Start float64 `json:"start"`
	End   float64 `json:"end"`
	Text  string  `json:"text"`
}

// podcastSubtitleEventKey 返回播客增量字幕事件的稳定标识，与前端 isPodcast 分支一致。
func podcastSubtitleEventKey(episodeID int64) string {
	return fmt.Sprintf("podcast:%d", episodeID)
}

// TranscribePodcast 转录 RSS 节目。已下载节目直接使用本地文件；在线节目下载音频并转成
// 16kHz WAV，成功后删除原始下载、保留 WAV 供重新转录复用。字幕按本地路径或音频 URL
// 缓存，force 用于显式重新转录。
func (s *PlatformService) TranscribePodcast(episodeID int64, force bool) PodcastTranscribeResult {
	fail := func(err error) PodcastTranscribeResult {
		return PodcastTranscribeResult{Error: err.Error()}
	}

	info, err := q().GetEpisodeAudioAndLocalPath(context.Background(), episodeID)
	if err != nil {
		return fail(fmt.Errorf("节目不存在"))
	}
	audioURL, localPath := info.AudioUrl, info.LocalPath
	// 订阅源里的视频直链没有 audio_url，转录时走同一条在线音轨下载链路
	if audioURL == "" {
		audioURL = info.MediaUrl
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
				return PodcastTranscribeResult{OK: true, Subtitles: cached, Cached: true}
			}
		}
	}

	if err := s.checkWhisperReady(); err != nil {
		return fail(err)
	}
	// 增量事件用 episodeID 作为稳定 key：在线节目可能同时有 audio_url 和 media_url，
	// 前端只拿得到实际播放地址，用缓存 key 会因后端选了另一条地址而对不上。
	eventKey := podcastSubtitleEventKey(episodeID)
	var cues []SubtitleCue
	if localPath != "" {
		cues, err = s.transcribeAudioFile(localPath, eventKey)
	} else {
		s.app.Event.Emit("whisper:progress", whisperProgress{Progress: 0, Status: "downloading"})
		// 与 YouTube/B站一致：yt-dlp 下载到临时目录，函数返回前自动清理。
		cues, err = s.transcribeAudio(audioURL, eventKey)
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
	return PodcastTranscribeResult{OK: true, Subtitles: items, Cached: false}
}

// GetSubtitles 根据 FeedEpisode 的 link 字段抓取平台字幕
// 输入是 platformService 内部存储的 episode_link，自动识别平台
func (s *PlatformService) GetSubtitles(episodeID int64) PlatformSubtitlesResult {
	info, _ := q().GetEpisodeForSubtitles(context.Background(), episodeID)
	title, link, audioURL := info.Title, info.Link, info.AudioUrl

	// 播客源优先：如果有音频直链且音频字幕已缓存，直接返回缓存
	if audioURL != "" {
		// 检查 whisper 缓存字幕
		return PlatformSubtitlesResult{Error: "播客源请使用页面右上角的「转录字幕」按钮"}
	}

	if link == "" {
		return PlatformSubtitlesResult{Error: "该节目没有关联的视频页面链接"}
	}

	kind, id := DetectPlatform(link)
	result := s.subtitlesByPlatform(kind, id)
	if result.OK {
		result.Title = title
	}
	return result
}

// GetSubtitlesBySource 按平台与视频 ID 直接取字幕，供粘贴链接播放使用：
// 这类视频没有 feed_episodes 记录，不能走 GetSubtitles(episodeID)。
func (s *PlatformService) GetSubtitlesBySource(sourceKind, videoID string) PlatformSubtitlesResult {
	kind, id, err := normalizePlatformSource(sourceKind, videoID)
	if err != nil {
		return PlatformSubtitlesResult{Error: err.Error()}
	}
	return s.subtitlesByPlatform(kind, id)
}

// WarmAudioResult 音轨预热结果。前端在打开在线视频播放器时调用，
// 提前把音轨下载并转成 16kHz WAV，点「转录」时直接命中，省掉下载等待。
type WarmAudioResult struct {
	OK      bool   `json:"ok"`
	Ready   bool   `json:"ready"`
	Error   string `json:"error,omitempty"`
	Kind    string `json:"kind,omitempty"`
	VideoID string `json:"videoId,omitempty"`
}

// WarmAudio 后台预下载并转码在线视频音轨。
// 与转录共用同一份缓存和并发去重：已就绪时立即返回，不重复下载。
// 预热不需要 Whisper 模型，因此模型未下载时也能先把音轨准备好。
func (s *PlatformService) WarmAudio(sourceKind, videoID string) WarmAudioResult {
	kind, id, err := normalizePlatformSource(sourceKind, videoID)
	if err != nil {
		return WarmAudioResult{Error: err.Error()}
	}

	var videoURL, eventKey string
	switch kind {
	case platformYouTube:
		videoID = strings.TrimPrefix(id, "video:")
		if len(videoID) != 11 {
			return WarmAudioResult{Error: "无效的 YouTube 视频 ID", Kind: kindLabel(kind)}
		}
		videoURL = "https://www.youtube.com/watch?v=" + videoID
		eventKey = platformSubtitleEventKey(platformYouTube, videoID)
	case platformBilibili:
		bvid, cid := splitBiliVideoID(id)
		if bvid == "" || !strings.HasPrefix(bvid, "BV") {
			return WarmAudioResult{Error: "无效的 B站视频 ID", Kind: kindLabel(kind)}
		}
		videoURL = "https://www.bilibili.com/video/" + bvid
		keyID := bvid
		if cid > 0 && s.feed != nil {
			if page := s.feed.bilibiliPageOfCID(bvid, cid); page > 0 {
				videoURL = fmt.Sprintf("%s?p=%d", videoURL, page)
			}
			keyID = fmt.Sprintf("%s:%d", bvid, cid)
		}
		eventKey = platformSubtitleEventKey(platformBilibili, keyID)
		videoID = bvid
	default:
		return WarmAudioResult{Error: "不支持的平台", Kind: kindLabel(kind)}
	}

	// 已缓存直接返回，不必构造 Cookie，也不要求订阅服务可用
	if wavPath := cachedOnlineWav(s.onlineAudioDir(eventKey)); wavPath != "" {
		return WarmAudioResult{OK: true, Ready: true, Kind: kindLabel(kind), VideoID: videoID}
	}

	var extraArgs []string
	if kind == platformBilibili && s.feed != nil {
		cookiePath, err := bilibiliYtDlpCookieFile(s.feed.bilibiliCookie())
		if err != nil {
			return WarmAudioResult{Error: err.Error(), Kind: kindLabel(kind), VideoID: videoID}
		}
		if cookiePath != "" {
			defer func() { _ = os.Remove(cookiePath) }()
			extraArgs = append(extraArgs, "--cookies", cookiePath)
		}
	}

	// 预热阶段只准备音轨，不检查 Whisper 模型是否就绪。
	wavPath, err := s.prepareOnlineAudio(videoURL, eventKey, extraArgs...)
	if err != nil {
		return WarmAudioResult{Error: err.Error(), Kind: kindLabel(kind), VideoID: videoID}
	}
	return WarmAudioResult{OK: true, Ready: wavPath != "", Kind: kindLabel(kind), VideoID: videoID}
}

// normalizePlatformSource 归一化平台与视频 ID，供字幕获取和音轨预热共用。
func normalizePlatformSource(sourceKind, videoID string) (platformKind, string, error) {
	videoID = strings.TrimSpace(videoID)
	var kind platformKind
	switch strings.ToLower(strings.TrimSpace(sourceKind)) {
	case "youtube":
		kind = platformYouTube
		videoID = strings.TrimPrefix(videoID, "yt:")
		if !strings.HasPrefix(videoID, "video:") {
			videoID = "video:" + videoID
		}
	case "bilibili":
		kind = platformBilibili
		videoID = strings.TrimPrefix(videoID, "bili:")
		if !strings.HasPrefix(videoID, "bv:") {
			videoID = "bv:" + videoID
		}
	default:
		return platformUnknown, "", fmt.Errorf("不支持的平台，目前仅支持 YouTube 与 B站")
	}
	return kind, videoID, nil
}

// subtitlesByPlatform 按平台 + 视频 ID 取字幕：先读缓存，再抓官方字幕，最后兜底本地转录
func (s *PlatformService) subtitlesByPlatform(kind platformKind, id string) PlatformSubtitlesResult {
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
			return PlatformSubtitlesResult{Error: err.Error(), Platform: kindLabel(kind)}
		}

		if raw, err := json.Marshal(cues); err == nil {
			_ = os.MkdirAll(filepath.Dir(cachePath), 0755)
			_ = os.WriteFile(cachePath, raw, 0644)
		}
	}

	return PlatformSubtitlesResult{
		OK:       true,
		Platform: kindLabel(kind),
		VideoID:  id,
		Cues:     cues,
	}
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

// splitBiliVideoID 把内部标识 "bv:<bvid>" 或 "bv:<bvid>:<cid>" 拆成 bvid 与 cid。
// cid 为 0 表示未指定分 P，沿用平台默认值（P1）；带 cid 的标识用于多 P 视频的缓存隔离。
func splitBiliVideoID(id string) (string, int64) {
	id = strings.TrimPrefix(id, "bv:")
	if idx := strings.LastIndex(id, ":"); idx >= 0 {
		if cid, err := strconv.ParseInt(id[idx+1:], 10, 64); err == nil && cid > 0 {
			return id[:idx], cid
		}
		// 后缀不是合法 cid 时不可能是 bvid 的一部分，去掉以避免误判为视频 ID
		return id[:idx], 0
	}
	return id, 0
}

// fetchBilibiliSubtitles 先抓 B站字幕，接口连续未返回字幕时下载音轨走本地 Whisper 转录。
func (s *PlatformService) fetchBilibiliSubtitles(id string) ([]SubtitleCue, error) {
	bvid, cid := splitBiliVideoID(id)
	if bvid == "" || !strings.HasPrefix(bvid, "BV") {
		return nil, fmt.Errorf("无效的 B站视频 ID")
	}

	cues, subErr := s.fetchBilibiliSubtitleTrack(bvid, cid)
	if subErr == nil && len(cues) > 0 {
		return cues, nil
	}
	s.app.Logger.Info("B站字幕抓取失败，尝试本地转录", "bvid", bvid, "cid", cid, "error", subErr)

	cues, trErr := s.transcribeBilibiliAudio(bvid, cid)
	if trErr == nil && len(cues) > 0 {
		return cues, nil
	}
	return nil, fmt.Errorf("B站无可用字幕（%v），本地转录失败（%v）", subErr, trErr)
}

func (s *PlatformService) fetchBilibiliSubtitleTrack(bvid string, cid int64) ([]SubtitleCue, error) {
	// BV 转 cid（view 的 subtitle.list 为空，AI 字幕要走 player/v2）
	client := s.feed.httpClient()
	cookie := s.feed.bilibiliCookie()

	trackCID := cid
	if trackCID == 0 {
		var viewResp struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
			Data    struct {
				Cid int64 `json:"cid"`
			} `json:"data"`
		}
		if err := fetchBiliJSON(client, cookie, "https://api.bilibili.com/x/web-interface/view?bvid="+bvid, &viewResp); err != nil {
			return nil, fmt.Errorf("无法访问 B站: %w", err)
		}
		if viewResp.Code != 0 {
			return nil, fmt.Errorf("bilibili api error: %s", viewResp.Message)
		}
		trackCID = viewResp.Data.Cid
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
	playerAPI := fmt.Sprintf("https://api.bilibili.com/x/player/v2?bvid=%s&cid=%d", bvid, trackCID)
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
