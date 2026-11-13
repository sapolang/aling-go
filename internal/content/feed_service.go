package content

import (
	"context"
	"crypto/md5"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"aling-go/internal/core"

	"github.com/mmcdole/gofeed"
	ext "github.com/mmcdole/gofeed/extensions"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// Feed 是一个已订阅的播客/RSS 源
type Feed struct {
	ID            int64  `json:"id"`
	URL           string `json:"url"`
	Title         string `json:"title"`
	Description   string `json:"description"`
	Image         string `json:"image"`
	SiteURL       string `json:"siteUrl"`
	LastFetchedAt string `json:"lastFetchedAt"`
	LastError     string `json:"lastError"`
	EpisodeCount  int    `json:"episodeCount"`
}

// FeedEpisode 是订阅源下的一期节目
type FeedEpisode struct {
	ID          int64  `json:"id"`
	FeedID      int64  `json:"feedId"`
	Title       string `json:"title"`
	Description string `json:"description"`
	AudioURL    string `json:"audioUrl"`
	Link        string `json:"link"`
	Duration    int    `json:"duration"`
	PublishedAt string `json:"publishedAt"`
	LocalPath   string `json:"localPath"`
	Image       string `json:"image"`
	// GUID 仅用于入库去重，不返回前端
	GUID string `json:"-"`
}

type feedActionResult struct {
	OK      bool   `json:"ok"`
	Error   string `json:"error"`
	Message string `json:"message"`
}

type episodeDownloadResult struct {
	OK    bool   `json:"ok"`
	Error string `json:"error"`
	Path  string `json:"path"`
}

// FeedService 负责播客 RSS 订阅：拉取订阅源、解析节目列表、按需下载音频到本地。
// 下载完成的音频会写入媒体库，走现有播放器 + whisper 链路。
type FeedService struct {
	app     *application.App
	dataDir string
	library *LibraryService

	mu    sync.RWMutex
	proxy string

	// biliCookie 是匿名请求 B站接口所需的 buvid Cookie，首次使用时生成
	biliCookie string
	// biliUserCookie 是用户在播客页配置的 B站登录态 Cookie，优先使用
	biliUserCookie string
	// wbiMixinKey 是 WBI 签名密钥，接口侧约按小时轮换，这里缓存 1 小时
	wbiMixinKey string
	wbiExpireAt time.Time
}

func NewFeedService(app *application.App, dataDir string, library *LibraryService) *FeedService {
	cfg := loadFeedConfig(dataDir)
	return &FeedService{
		app:     app,
		dataDir: dataDir,
		library: library,
		proxy:   cfg.Proxy,

		biliUserCookie: cfg.BilibiliCookie,
	}
}

func (s *FeedService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	return s.ensureTables()
}

func (s *FeedService) ServiceShutdown() error { return nil }

func (s *FeedService) ensureTables() error {
	_, err := core.DB.Exec(`
		CREATE TABLE IF NOT EXISTS feeds (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			url TEXT NOT NULL UNIQUE,
			title TEXT DEFAULT '',
			description TEXT DEFAULT '',
			image TEXT DEFAULT '',
			site_url TEXT DEFAULT '',
			last_fetched_at TEXT DEFAULT '',
			last_error TEXT DEFAULT '',
			created_at TEXT DEFAULT (datetime('now','localtime'))
		);
		CREATE TABLE IF NOT EXISTS feed_episodes (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			feed_id INTEGER NOT NULL,
			guid TEXT NOT NULL,
			title TEXT DEFAULT '',
			description TEXT DEFAULT '',
			audio_url TEXT DEFAULT '',
			link TEXT DEFAULT '',
			duration INTEGER DEFAULT 0,
			published_at TEXT DEFAULT '',
			local_path TEXT DEFAULT '',
			created_at TEXT DEFAULT (datetime('now','localtime')),
			UNIQUE(feed_id, guid)
		);
		CREATE INDEX IF NOT EXISTS idx_feed_episodes_feed ON feed_episodes(feed_id, published_at);
	`)
	if err != nil {
		return err
	}
	// 增量迁移：老版本没有 link 列
	_, _ = core.DB.Exec(`ALTER TABLE feed_episodes ADD COLUMN link TEXT DEFAULT ''`)
	_, _ = core.DB.Exec(`ALTER TABLE feed_episodes ADD COLUMN image TEXT DEFAULT ''`)
	return nil
}

// --- 网络配置 ---

func feedConfigPath(dataDir string) string {
	return filepath.Join(dataDir, "feed-config.json")
}

type feedConfig struct {
	Proxy          string `json:"proxy"`
	BilibiliCookie string `json:"bilibiliCookie"`
}

func loadFeedConfig(dataDir string) feedConfig {
	data, err := os.ReadFile(feedConfigPath(dataDir))
	if err != nil {
		return feedConfig{}
	}
	var cfg feedConfig
	if json.Unmarshal(data, &cfg) != nil {
		return feedConfig{}
	}
	cfg.Proxy = strings.TrimSpace(cfg.Proxy)
	cfg.BilibiliCookie = strings.TrimSpace(cfg.BilibiliCookie)
	return cfg
}

// saveFeedConfig 写入订阅相关配置，文件权限 0600
func saveFeedConfig(dataDir string, cfg feedConfig) error {
	b, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	return os.WriteFile(feedConfigPath(dataDir), b, 0600)
}

// GetProxy 返回当前订阅拉取使用的代理地址
func (s *FeedService) GetProxy() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.proxy
}

// SetProxy 设置订阅拉取使用的代理（形如 http://127.0.0.1:7890），传空字符串表示直连
func (s *FeedService) SetProxy(proxy string) string {
	proxy = strings.TrimSpace(proxy)
	if proxy != "" {
		if u, err := url.Parse(proxy); err != nil || u.Scheme == "" {
			b, _ := json.Marshal(feedActionResult{Error: "代理地址格式不正确，应形如 http://127.0.0.1:7890"})
			return string(b)
		}
	}
	s.mu.Lock()
	s.proxy = proxy
	cookie := s.biliUserCookie
	s.mu.Unlock()

	if err := saveFeedConfig(s.dataDir, feedConfig{Proxy: proxy, BilibiliCookie: cookie}); err != nil {
		b, _ := json.Marshal(feedActionResult{Error: "保存配置失败: " + err.Error()})
		return string(b)
	}
	out, _ := json.Marshal(feedActionResult{OK: true})
	return string(out)
}

// GetBilibiliCookie 返回用户配置的 B站 Cookie，未配置时为空
func (s *FeedService) GetBilibiliCookie() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.biliUserCookie
}

// SetBilibiliCookie 设置拉取 B站订阅源时携带的 Cookie，传空字符串表示清除。
// 带上登录态 Cookie（SESSDATA）可以显著降低 B站风控命中率。
func (s *FeedService) SetBilibiliCookie(cookie string) string {
	cookie = normalizeCookie(cookie)
	if cookie != "" && !strings.Contains(cookie, "=") {
		b, _ := json.Marshal(feedActionResult{Error: "Cookie 格式不正确，应形如 SESSDATA=xxx"})
		return string(b)
	}
	s.mu.Lock()
	s.biliUserCookie = cookie
	proxy := s.proxy
	s.mu.Unlock()

	if err := saveFeedConfig(s.dataDir, feedConfig{Proxy: proxy, BilibiliCookie: cookie}); err != nil {
		b, _ := json.Marshal(feedActionResult{Error: "保存配置失败: " + err.Error()})
		return string(b)
	}
	out, _ := json.Marshal(feedActionResult{OK: true})
	return string(out)
}

// normalizeCookie 去掉用户粘贴时可能带上的 "Cookie:" 前缀与多余换行
func normalizeCookie(cookie string) string {
	cookie = strings.TrimSpace(cookie)
	if len(cookie) >= 7 && strings.EqualFold(cookie[:7], "cookie:") {
		cookie = strings.TrimSpace(cookie[7:])
	}
	cookie = strings.ReplaceAll(cookie, "\r", "")
	cookie = strings.ReplaceAll(cookie, "\n", "")
	return strings.Join(strings.Fields(cookie), " ")
}

func (s *FeedService) httpClient() *http.Client {
	transport := &http.Transport{Proxy: http.ProxyFromEnvironment}
	s.mu.RLock()
	proxy := s.proxy
	s.mu.RUnlock()
	if proxy != "" {
		if u, err := url.Parse(proxy); err == nil {
			transport.Proxy = http.ProxyURL(u)
		}
	}
	return &http.Client{Timeout: 60 * time.Second, Transport: transport}
}

// HTTPClient 返回带用户代理配置的 HTTP 客户端，供其他服务（如 B 站取流）复用
func (s *FeedService) HTTPClient() *http.Client {
	return s.httpClient()
}

// --- 订阅源解析 ---

// parseRSS 用 gofeed 解析 RSS 2.0 / Atom 1.0，再映射成统一的 FeedEpisode。
// B 站等平台专属接口不经过这里。
func parseRSS(data []byte) (title, desc, image, siteURL string, episodes []FeedEpisode, err error) {
	feed, perr := gofeed.NewParser().ParseString(string(data))
	if perr != nil {
		return "", "", "", "", nil, fmt.Errorf("解析订阅源失败: %w", perr)
	}
	if strings.TrimSpace(feed.Title) == "" && len(feed.Items) == 0 {
		return "", "", "", "", nil, fmt.Errorf("不是有效的订阅源")
	}

	title = strings.TrimSpace(feed.Title)
	desc = stripHTML(feed.Description)
	if desc == "" && feed.ITunesExt != nil {
		desc = stripHTML(feed.ITunesExt.Summary)
	}
	siteURL = strings.TrimSpace(feed.Link)
	image = feedImageURL(feed)

	for _, it := range feed.Items {
		if it == nil {
			continue
		}
		group := mediaGroup(it)
		link := strings.TrimSpace(it.Link)
		// 播客源有 enclosure（音频直链），YouTube/B站 只有 link（视频页面），
		// 两种都要保留，后续根据 audioURL 是否为空决定走「下载」还是「在线精听」
		audioURL := episodeAudioURL(it, group)
		if audioURL == "" && link == "" {
			continue
		}
		guid := strings.TrimSpace(it.GUID)
		if guid == "" {
			if audioURL != "" {
				guid = audioURL
			} else {
				guid = link
			}
		}
		episodes = append(episodes, FeedEpisode{
			Title:       strings.TrimSpace(it.Title),
			Description: stripHTML(itemDescription(it, group)),
			AudioURL:    audioURL,
			Link:        link,
			Duration:    itemDuration(it),
			PublishedAt: itemPublishedAt(it),
			Image:       itemImageURL(it, group, image),
			GUID:        guid,
		})
	}
	return title, desc, image, siteURL, episodes, nil
}

// feedImageURL 取频道封面：标准 image 优先，其次 itunes:image，Atom 源用首条节目封面兜底
func feedImageURL(feed *gofeed.Feed) string {
	image := ""
	if feed.Image != nil {
		image = strings.TrimSpace(feed.Image.URL)
	}
	if image == "" && feed.ITunesExt != nil {
		image = strings.TrimSpace(feed.ITunesExt.Image)
	}
	if image == "" && len(feed.Items) > 0 && feed.Items[0] != nil {
		image = mediaAttr(mediaGroup(feed.Items[0]), "thumbnail", "url")
	}
	// 统一升级为 https，避免 WKWebView 混合内容策略阻止 http 图片加载
	if strings.HasPrefix(image, "http://") {
		image = "https://" + strings.TrimPrefix(image, "http://")
	}
	return image
}

// mediaGroup 取 media:group 节点（YouTube 的 Atom 源用它承载标题、简介、封面与播放地址）
func mediaGroup(it *gofeed.Item) *ext.Extension {
	groups := it.Extensions["media"]["group"]
	if len(groups) == 0 {
		return nil
	}
	return &groups[0]
}

// mediaAttr 读取 media:group 子元素的属性值，如 media:thumbnail 的 url
func mediaAttr(group *ext.Extension, name, attr string) string {
	if group == nil {
		return ""
	}
	nodes := group.Children[name]
	if len(nodes) == 0 {
		return ""
	}
	return strings.TrimSpace(nodes[0].Attrs[attr])
}

// mediaText 读取 media:group 子元素的文本，如 media:description
func mediaText(group *ext.Extension, name string) string {
	if group == nil {
		return ""
	}
	nodes := group.Children[name]
	if len(nodes) == 0 {
		return ""
	}
	return strings.TrimSpace(nodes[0].Value)
}

// extensionAttr 读取条目上扁平扩展节点的属性，如 RSS 的 media:thumbnail
func extensionAttr(it *gofeed.Item, ns, name, attr string) string {
	nodes := it.Extensions[ns][name]
	if len(nodes) == 0 {
		return ""
	}
	return strings.TrimSpace(nodes[0].Attrs[attr])
}

// episodeAudioURL 取音频直链：优先 enclosure，Atom 源退回 media:content
func episodeAudioURL(it *gofeed.Item, group *ext.Extension) string {
	for _, enc := range it.Enclosures {
		if enc == nil {
			continue
		}
		if u := strings.TrimSpace(enc.URL); u != "" {
			return u
		}
	}
	// YouTube 的 media:content 是视频播放页地址，直接下载只会拿到 HTML
	u := mediaAttr(group, "content", "url")
	if isVideoMediaURL(u, mediaAttr(group, "content", "type")) {
		return ""
	}
	return u
}

// itemDescription 按 media:group → description → content 的顺序取简介
func itemDescription(it *gofeed.Item, group *ext.Extension) string {
	if d := mediaText(group, "description"); d != "" {
		return d
	}
	if d := strings.TrimSpace(it.Description); d != "" {
		return d
	}
	return it.Content
}

// itemDuration 取 itunes:duration，兼容 "3600"、"12:34"、"01:02:03"
func itemDuration(it *gofeed.Item) int {
	if it.ITunesExt == nil {
		return 0
	}
	return parseDuration(it.ITunesExt.Duration)
}

// itemPublishedAt 统一成 RFC3339 便于排序，解析失败返回空串
func itemPublishedAt(it *gofeed.Item) string {
	if it.PublishedParsed != nil {
		return it.PublishedParsed.Format(time.RFC3339)
	}
	if it.UpdatedParsed != nil {
		return it.UpdatedParsed.Format(time.RFC3339)
	}
	if t := normalizePubDate(it.Published); t != "" {
		return t
	}
	return normalizePubDate(it.Updated)
}

// itemImageURL 取节目封面：条目自带封面优先，最后用频道封面兜底
func itemImageURL(it *gofeed.Item, group *ext.Extension, feedImage string) string {
	candidates := []string{
		mediaAttr(group, "thumbnail", "url"),
		extensionAttr(it, "media", "thumbnail", "url"),
	}
	if it.Image != nil {
		candidates = append(candidates, strings.TrimSpace(it.Image.URL))
	}
	if it.ITunesExt != nil {
		candidates = append(candidates, strings.TrimSpace(it.ITunesExt.Image))
	}
	candidates = append(candidates, feedImage)
	for _, c := range candidates {
		if c != "" {
			return c
		}
	}
	return ""
}

// stripHTML 粗暴去掉标签与多余空白，用于简介展示
func stripHTML(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	var b strings.Builder
	inTag := false
	for _, r := range s {
		switch {
		case r == '<':
			inTag = true
		case r == '>':
			inTag = false
		case !inTag:
			b.WriteRune(r)
		}
	}
	out := b.String()
	out = strings.ReplaceAll(out, "&nbsp;", " ")
	out = strings.ReplaceAll(out, "&amp;", "&")
	out = strings.ReplaceAll(out, "&lt;", "<")
	out = strings.ReplaceAll(out, "&gt;", ">")
	out = strings.ReplaceAll(out, "&quot;", "\"")
	out = strings.ReplaceAll(out, "&#39;", "'")
	return strings.Join(strings.Fields(out), " ")
}

// parseDuration 支持 "3600"、"12:34"、"01:02:03" 三种 itunes:duration 写法
func parseDuration(raw string) int {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	if n, err := strconv.Atoi(raw); err == nil {
		return n
	}
	parts := strings.Split(raw, ":")
	total := 0
	for _, p := range parts {
		n, err := strconv.Atoi(strings.TrimSpace(p))
		if err != nil {
			return 0
		}
		total = total*60 + n
	}
	return total
}

var pubDateLayouts = []string{
	time.RFC1123Z,
	time.RFC1123,
	time.RFC822Z,
	time.RFC822,
	"Mon, 2 Jan 2006 15:04:05 -0700",
	"Mon, 02 Jan 2006 15:04:05 MST",
	"2006-01-02T15:04:05Z07:00",
	"2006-01-02",
}

// normalizePubDate 统一成 RFC3339 便于排序，解析失败返回空串
func normalizePubDate(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	for _, layout := range pubDateLayouts {
		if t, err := time.Parse(layout, raw); err == nil {
			return t.Format(time.RFC3339)
		}
	}
	return ""
}

// --- 订阅 CRUD ---

func (s *FeedService) FeedList() string {
	rows, err := core.DB.Query(`
		SELECT f.id, f.url, f.title, f.description, f.image, f.site_url, f.last_fetched_at, f.last_error,
		       (SELECT COUNT(*) FROM feed_episodes e WHERE e.feed_id = f.id)
		FROM feeds f ORDER BY f.created_at DESC`)
	if err != nil {
		b, _ := json.Marshal(map[string]any{"feeds": []Feed{}, "error": err.Error()})
		return string(b)
	}
	defer rows.Close()

	feeds := []Feed{}
	for rows.Next() {
		var f Feed
		if err := rows.Scan(&f.ID, &f.URL, &f.Title, &f.Description, &f.Image, &f.SiteURL, &f.LastFetchedAt, &f.LastError, &f.EpisodeCount); err != nil {
			continue
		}
		feeds = append(feeds, f)
	}
	b, _ := json.Marshal(map[string]any{"feeds": feeds})
	return string(b)
}

// FeedAdd 订阅一个 RSS 地址，立即拉取一次并落库
func (s *FeedService) FeedAdd(feedURL string) string {
	feedURL = strings.TrimSpace(feedURL)
	if feedURL == "" {
		return feedResultJSON(feedActionResult{Error: "请填写订阅地址"})
	}
	if u, err := url.Parse(feedURL); err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return feedResultJSON(feedActionResult{Error: "订阅地址需以 http:// 或 https:// 开头"})
	}

	var exists int
	_ = core.DB.QueryRow(`SELECT COUNT(*) FROM feeds WHERE url = ?`, feedURL).Scan(&exists)
	if exists > 0 {
		return feedResultJSON(feedActionResult{Error: "该订阅源已存在"})
	}

	meta, err := s.fetchFeed(feedURL)
	if err != nil {
		return feedResultJSON(feedActionResult{Error: err.Error()})
	}

	res, err := core.DB.Exec(`
		INSERT INTO feeds (url, title, description, image, site_url, last_fetched_at)
		VALUES (?, ?, ?, ?, ?, ?)`,
		feedURL, meta.title, meta.desc, meta.image, meta.siteURL, time.Now().Format(time.RFC3339))
	if err != nil {
		return feedResultJSON(feedActionResult{Error: "保存订阅失败: " + err.Error()})
	}
	feedID, _ := res.LastInsertId()
	s.saveEpisodes(feedID, meta.episodes)

	return feedResultJSON(feedActionResult{
		OK:      true,
		Message: fmt.Sprintf("已订阅《%s》，共 %d 期节目", meta.title, len(meta.episodes)),
	})
}

// FeedRefresh 重新拉取指定订阅，id <= 0 时刷新全部
func (s *FeedService) FeedRefresh(feedID int64) string {
	if feedID <= 0 {
		return s.refreshAll()
	}
	if err := s.refreshOne(feedID); err != nil {
		return feedResultJSON(feedActionResult{Error: err.Error()})
	}
	return feedResultJSON(feedActionResult{OK: true, Message: "已更新"})
}

func (s *FeedService) refreshAll() string {
	rows, err := core.DB.Query(`SELECT id FROM feeds`)
	if err != nil {
		return feedResultJSON(feedActionResult{Error: err.Error()})
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()

	var failed int
	for _, id := range ids {
		if err := s.refreshOne(id); err != nil {
			failed++
		}
	}
	if failed > 0 {
		return feedResultJSON(feedActionResult{OK: true, Message: fmt.Sprintf("更新完成，%d 个订阅源失败", failed)})
	}
	return feedResultJSON(feedActionResult{OK: true, Message: fmt.Sprintf("已更新 %d 个订阅源", len(ids))})
}

func (s *FeedService) refreshOne(feedID int64) error {
	var feedURL string
	if err := core.DB.QueryRow(`SELECT url FROM feeds WHERE id = ?`, feedID).Scan(&feedURL); err != nil {
		return fmt.Errorf("订阅源不存在")
	}
	meta, err := s.fetchFeed(feedURL)
	if err != nil {
		_, _ = core.DB.Exec(`UPDATE feeds SET last_error = ? WHERE id = ?`, err.Error(), feedID)
		return err
	}
	_, _ = core.DB.Exec(`
		UPDATE feeds SET title = ?, description = ?, image = ?, site_url = ?, last_fetched_at = ?, last_error = ''
		WHERE id = ?`,
		meta.title, meta.desc, meta.image, meta.siteURL, time.Now().Format(time.RFC3339), feedID)
	s.saveEpisodes(feedID, meta.episodes)
	return nil
}

// FeedRemove 取消订阅并删除该订阅下的节目记录（不删除已下载的音频文件）
func (s *FeedService) FeedRemove(feedID int64) string {
	_, _ = core.DB.Exec(`DELETE FROM feed_episodes WHERE feed_id = ?`, feedID)
	res, err := core.DB.Exec(`DELETE FROM feeds WHERE id = ?`, feedID)
	if err != nil {
		return feedResultJSON(feedActionResult{Error: err.Error()})
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return feedResultJSON(feedActionResult{Error: "订阅源不存在"})
	}
	return feedResultJSON(feedActionResult{OK: true, Message: "已取消订阅"})
}

// FeedEpisodes 返回订阅源下的节目列表，limit <= 0 时默认 100 条
func (s *FeedService) FeedEpisodes(feedID int64, limit int) string {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := core.DB.Query(`
		SELECT id, feed_id, title, description, audio_url, link, duration, published_at, local_path, image
		FROM feed_episodes WHERE feed_id = ?
		ORDER BY CASE WHEN published_at = '' THEN 1 ELSE 0 END, published_at DESC
		LIMIT ?`, feedID, limit)
	if err != nil {
		b, _ := json.Marshal(map[string]any{"episodes": []FeedEpisode{}, "error": err.Error()})
		return string(b)
	}
	defer rows.Close()

	episodes := []FeedEpisode{}
	for rows.Next() {
		var e FeedEpisode
		if err := rows.Scan(&e.ID, &e.FeedID, &e.Title, &e.Description, &e.AudioURL, &e.Link, &e.Duration, &e.PublishedAt, &e.LocalPath, &e.Image); err != nil {
			continue
		}
		// 兼容历史数据：旧版本把 YouTube 播放页当成了音频地址，下载结果是网页；
		// 没有音频直链的在线节目同样不应展示"已下载"
		if isVideoMediaURL(e.AudioURL, "") || (e.Link != "" && e.AudioURL == "") {
			e.AudioURL = ""
			e.LocalPath = ""
		}
		episodes = append(episodes, e)
	}
	b, _ := json.Marshal(map[string]any{"episodes": episodes})
	return string(b)
}

type feedMeta struct {
	title    string
	desc     string
	image    string
	siteURL  string
	episodes []FeedEpisode
}

func (s *FeedService) fetchFeed(feedURL string) (*feedMeta, error) {
	// B站：不依赖 RSSHub（公共实例普遍 403），直接调官方 wbi 签名 API
	if mid := bilibiliMidFromURL(feedURL); mid != "" {
		return s.fetchBilibiliFeed(mid)
	}

	req, err := http.NewRequest(http.MethodGet, feedURL, nil)
	if err != nil {
		return nil, fmt.Errorf("订阅地址无效")
	}
	req.Header.Set("User-Agent", "Aling/1.0 (Podcast Subscriber)")
	req.Header.Set("Accept", "application/rss+xml, application/xml, text/xml, */*")

	resp, err := s.httpClient().Do(req)
	if err != nil {
		return nil, fmt.Errorf("拉取订阅源失败，请检查网络或在播客页配置代理: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("拉取订阅源失败: %s", downloadStatusError(resp.StatusCode, resp.Status))
	}

	// 部分播客（如 The Daily）单份 RSS 超过 10MB，历史上限过小会导致解析被截断
	data, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		return nil, fmt.Errorf("读取订阅源失败: %w", err)
	}
	title, desc, image, siteURL, episodes, err := parseRSS(data)
	if err != nil {
		return nil, err
	}
	return &feedMeta{title: title, desc: desc, image: image, siteURL: siteURL, episodes: episodes}, nil
}

// saveEpisodes 幂等写入节目列表：已存在则更新元信息，保留本地下载路径
func (s *FeedService) saveEpisodes(feedID int64, episodes []FeedEpisode) {
	stmt, err := core.DB.Prepare(`
		INSERT INTO feed_episodes (feed_id, guid, title, description, audio_url, link, duration, published_at, image)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(feed_id, guid) DO UPDATE SET
			title = excluded.title,
			description = excluded.description,
			audio_url = excluded.audio_url,
			link = excluded.link,
			duration = excluded.duration,
			published_at = excluded.published_at,
			image = excluded.image`)
	if err != nil {
		return
	}
	defer stmt.Close()

	for _, e := range episodes {
		_, _ = stmt.Exec(feedID, e.GUID, e.Title, e.Description, e.AudioURL, e.Link, e.Duration, e.PublishedAt, e.Image)
	}
}

// --- 下载 ---

// EpisodeDownload 下载指定节目音频到本地，并登记进媒体库
func (s *FeedService) EpisodeDownload(episodeID int64) string {
	var (
		feedID    int64
		title     string
		audioURL  string
		localPath string
	)
	err := core.DB.QueryRow(`
		SELECT feed_id, title, audio_url, local_path FROM feed_episodes WHERE id = ?`, episodeID).
		Scan(&feedID, &title, &audioURL, &localPath)
	if err != nil {
		return episodeResultJSON(episodeDownloadResult{Error: "节目不存在"})
	}
	if localPath != "" {
		if _, statErr := os.Stat(localPath); statErr == nil {
			return episodeResultJSON(episodeDownloadResult{OK: true, Path: localPath})
		}
	}
	if audioURL == "" {
		return episodeResultJSON(episodeDownloadResult{Error: "该节目没有可下载的音频地址"})
	}

	dir := filepath.Join(s.dataDir, "podcasts", strconv.FormatInt(feedID, 10))
	if err := os.MkdirAll(dir, 0755); err != nil {
		return episodeResultJSON(episodeDownloadResult{Error: "创建下载目录失败: " + err.Error()})
	}

	req, err := http.NewRequest(http.MethodGet, audioURL, nil)
	if err != nil {
		return episodeResultJSON(episodeDownloadResult{Error: "音频地址无效"})
	}
	req.Header.Set("User-Agent", "Aling/1.0 (Podcast Subscriber)")

	resp, err := s.httpClient().Do(req)
	if err != nil {
		// 网络层错误（超时、连接拒绝等），尝试将 http 升级为 https 重试一次
		if strings.HasPrefix(audioURL, "http://") {
			httpsURL := "https://" + strings.TrimPrefix(audioURL, "http://")
			if req2, e2 := http.NewRequest(http.MethodGet, httpsURL, nil); e2 == nil {
				req2.Header.Set("User-Agent", "Aling/1.0 (Podcast Subscriber)")
				if resp2, e3 := s.httpClient().Do(req2); e3 == nil {
					resp = resp2
					err = nil
					audioURL = httpsURL
				}
			}
		}
	}
	if err != nil {
		return episodeResultJSON(episodeDownloadResult{Error: "下载失败，请检查网络或配置代理: " + err.Error()})
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return episodeResultJSON(episodeDownloadResult{Error: downloadStatusError(resp.StatusCode, resp.Status)})
	}
	// 有些视频源返回 200 但内容其实是网页，直接落盘会得到一个打不开的假音频
	if isWebPageContentType(resp.Header.Get("Content-Type")) {
		return episodeResultJSON(episodeDownloadResult{
			Error: "该节目没有可直接下载的音频文件（服务器返回的是网页），请在浏览器中打开或使用在线精听",
		})
	}

	ext := audioExtFromURL(audioURL, resp.Header.Get("Content-Type"))
	name := sanitizeFileName(title)
	if name == "" {
		name = strconv.FormatInt(episodeID, 10)
	}
	dest := filepath.Join(dir, name+"."+ext)

	tmp := dest + ".part"
	out, err := os.Create(tmp)
	if err != nil {
		return episodeResultJSON(episodeDownloadResult{Error: "创建文件失败: " + err.Error()})
	}

	total := resp.ContentLength
	var written int64
	buf := make([]byte, 64*1024)
	lastPct := -1
	for {
		n, rerr := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := out.Write(buf[:n]); werr != nil {
				_ = out.Close()
				_ = os.Remove(tmp)
				return episodeResultJSON(episodeDownloadResult{Error: "写入失败: " + werr.Error()})
			}
			written += int64(n)
			if total > 0 {
				pct := int(written * 100 / total)
				if pct != lastPct {
					lastPct = pct
					s.app.Event.Emit("feed:download-progress", map[string]any{
						"episodeId": episodeID,
						"pct":       pct,
					})
				}
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			_ = out.Close()
			_ = os.Remove(tmp)
			return episodeResultJSON(episodeDownloadResult{Error: "下载中断: " + rerr.Error()})
		}
	}
	if err := out.Close(); err != nil {
		_ = os.Remove(tmp)
		return episodeResultJSON(episodeDownloadResult{Error: "保存文件失败: " + err.Error()})
	}
	if err := os.Rename(tmp, dest); err != nil {
		_ = os.Remove(tmp)
		return episodeResultJSON(episodeDownloadResult{Error: "保存文件失败: " + err.Error()})
	}

	_, _ = core.DB.Exec(`UPDATE feed_episodes SET local_path = ? WHERE id = ?`, dest, episodeID)
	if s.library != nil {
		s.library.ImportFiles([]string{dest}, "")
	}
	s.app.Event.Emit("feed:download-progress", map[string]any{"episodeId": episodeID, "pct": 100})

	return episodeResultJSON(episodeDownloadResult{OK: true, Path: dest})
}

// isVideoMediaURL 判断 media:content 指向的是视频播放页而非音频直链。
// YouTube/B站 的视频页需要走在线精听，下载下来只会得到 HTML。
func isVideoMediaURL(rawURL, mediaType string) bool {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return false
	}
	mt := strings.ToLower(strings.TrimSpace(mediaType))
	if strings.HasPrefix(mt, "video/") || strings.Contains(mt, "shockwave-flash") {
		return true
	}
	u, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	host := strings.ToLower(u.Hostname())
	for _, videoHost := range []string{"youtube.com", "youtu.be", "bilibili.com", "b23.tv"} {
		if host == videoHost || strings.HasSuffix(host, "."+videoHost) {
			return !audioExts[strings.TrimPrefix(strings.ToLower(filepath.Ext(u.Path)), ".")]
		}
	}
	return false
}

// isWebPageContentType 判断响应是否为网页而非音频文件
func isWebPageContentType(contentType string) bool {
	ct := strings.ToLower(strings.TrimSpace(contentType))
	if i := strings.Index(ct, ";"); i >= 0 {
		ct = strings.TrimSpace(ct[:i])
	}
	return strings.HasPrefix(ct, "text/") ||
		strings.Contains(ct, "html") ||
		strings.Contains(ct, "json") ||
		strings.Contains(ct, "xml")
}

// audioExtFromURL 依据 URL 后缀或 Content-Type 判断音频扩展名
func audioExtFromURL(rawURL, contentType string) string {
	ct := strings.ToLower(contentType)
	switch {
	case strings.Contains(ct, "mpeg"), strings.Contains(ct, "mp3"):
		return "mp3"
	case strings.Contains(ct, "mp4"), strings.Contains(ct, "m4a"), strings.Contains(ct, "x-m4a"):
		return "m4a"
	case strings.Contains(ct, "aac"):
		return "aac"
	case strings.Contains(ct, "ogg"), strings.Contains(ct, "opus"):
		return "ogg"
	case strings.Contains(ct, "wav"):
		return "wav"
	case strings.Contains(ct, "flac"):
		return "flac"
	}

	if u, err := url.Parse(rawURL); err == nil {
		ext := strings.TrimPrefix(strings.ToLower(filepath.Ext(u.Path)), ".")
		if audioExts[ext] {
			return ext
		}
	}
	return "mp3"
}

// sanitizeFileName 去掉路径分隔符等非法字符，限制长度避免超出文件系统限制
func sanitizeFileName(name string) string {
	replacer := strings.NewReplacer(
		"/", "_", "\\", "_", ":", "_", "*", "_", "?", "_",
		"\"", "_", "<", "_", ">", "_", "|", "_", "\n", " ", "\r", " ", "\t", " ",
	)
	cleaned := strings.TrimSpace(replacer.Replace(name))
	cleaned = strings.Join(strings.Fields(cleaned), " ")
	runes := []rune(cleaned)
	if len(runes) > 80 {
		cleaned = string(runes[:80])
	}
	return cleaned
}

func feedResultJSON(r feedActionResult) string {
	b, _ := json.Marshal(r)
	return string(b)
}

func episodeResultJSON(r episodeDownloadResult) string {
	b, _ := json.Marshal(r)
	return string(b)
}

// downloadStatusError 根据 HTTP 状态码生成更友好的错误提示，
// 帮助用户区分是源站问题、代理问题还是权限问题。
func downloadStatusError(code int, status string) string {
	switch {
	case code == http.StatusBadGateway || code == http.StatusServiceUnavailable || code == http.StatusGatewayTimeout:
		return "下载失败: HTTP " + status + "（无法连接到音频服务器，若使用了代理请尝试切换节点或调整代理规则）"
	case code == http.StatusForbidden:
		return "下载失败: HTTP " + status + "（服务器拒绝访问，该音频可能已下架或仅限特定地区）"
	case code == http.StatusNotFound:
		return "下载失败: HTTP " + status + "（音频文件不存在，节目可能已更新地址，请刷新订阅源后重试）"
	case code >= 500:
		return "下载失败: HTTP " + status + "（服务器内部错误，请稍后重试）"
	default:
		return "下载失败: HTTP " + status
	}
}

// --- B站：直接调官方 wbi 签名 API，不依赖 RSSHub ---

// bilibiliMidFromURL 从 RSSHub 风格的 B 站 URL 中提取 UP 主 mid
// 支持 https://rsshub.app/bilibili/user/video/12345 以及直接 https://space.bilibili.com/12345
var bilibiliUserVideoRe = regexp.MustCompile(`^(?:https?://)?[^/]+/bilibili/user/video/(\d+)(?:[?#].*)?$`)

func bilibiliMidFromURL(rawURL string) string {
	if m := bilibiliUserVideoRe.FindStringSubmatch(rawURL); len(m) == 2 {
		return m[1]
	}
	if m := bilibiliSpaceRe.FindStringSubmatch(rawURL); len(m) == 2 {
		return m[1]
	}
	return ""
}

// bilibiliCookie 返回请求 B站接口使用的 Cookie。
// 优先使用用户配置的登录态 Cookie，并保证带上 buvid3（缺失时追加匿名 buvid），
// 不带 buvid 的请求会被 B站直接判定为风控，返回 412。
func (s *FeedService) bilibiliCookie() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.biliCookie == "" {
		b := make([]byte, 16)
		_, _ = rand.Read(b)
		s.biliCookie = fmt.Sprintf("buvid3=%X-%X-%X-%X-%Xinfoc; b_nut=%d",
			b[0:4], b[4:6], b[6:8], b[8:10], b[10:16], time.Now().Unix())
	}
	if s.biliUserCookie == "" {
		return s.biliCookie
	}
	if strings.Contains(s.biliUserCookie, "buvid3=") {
		return s.biliUserCookie
	}
	return s.biliUserCookie + "; " + s.biliCookie
}

// biliDynamicResp 是 B站动态流接口的响应结构
type biliDynamicResp struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    struct {
		Offset  string `json:"offset"`
		HasMore bool   `json:"has_more"`
		Items   []struct {
			Type    string `json:"type"`
			Modules struct {
				ModuleAuthor struct {
					PubTS string `json:"pub_ts"`
				} `json:"module_author"`
				ModuleDynamic struct {
					Desc *struct {
						Text string `json:"text"`
					} `json:"desc"`
					Major struct {
						Archive *struct {
							BVID         string `json:"bvid"`
							Title        string `json:"title"`
							Desc         string `json:"desc"`
							Cover        string `json:"cover"`
							DurationText string `json:"duration_text"`
						} `json:"archive"`
					} `json:"major"`
				} `json:"module_dynamic"`
			} `json:"modules"`
		} `json:"items"`
	} `json:"data"`
}

// bilibiliMixinKeyEncTab 是 B站 WBI 签名固定的密钥打乱表
var bilibiliMixinKeyEncTab = []int{
	46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
	33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
	26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
	20, 34, 44, 52,
}

const bilibiliWebUA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

// biliArcSearchResp 是 B站空间投稿接口（x/space/wbi/arc/search）的响应结构
type biliArcSearchResp struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    struct {
		Page struct {
			Count int `json:"count"`
		} `json:"page"`
		List struct {
			VList []struct {
				BVID        string `json:"bvid"`
				Title       string `json:"title"`
				Description string `json:"description"`
				Pic         string `json:"pic"`
				Length      string `json:"length"`
				Created     int64  `json:"created"`
			} `json:"vlist"`
		} `json:"list"`
	} `json:"data"`
}

// fetchBilibiliFeed 获取 UP 主的视频投稿列表。
// 优先用 WBI 签名的空间投稿接口（直接返回 length/created，数据最准），
// 该接口被风控时回退到动态流接口（动态流必须带 features 参数，否则返回空列表）。
func (s *FeedService) fetchBilibiliFeed(mid string) (*feedMeta, error) {
	episodes, err := s.bilibiliVideosByWBI(mid)
	if err != nil || len(episodes) == 0 {
		wbiErr := err
		fallback, ferr := s.bilibiliVideosByDynamic(mid)
		switch {
		case ferr == nil && len(fallback) > 0:
			episodes, err = fallback, nil
		case ferr != nil:
			err = ferr
		case wbiErr != nil:
			err = wbiErr
		default:
			err = fmt.Errorf("该 UP 主近期没有视频投稿")
		}
	}
	if err != nil {
		return nil, err
	}

	return &feedMeta{
		title:    "Bilibili UP主 " + mid,
		desc:     "B站视频列表",
		image:    s.bilibiliUploaderFace(mid),
		siteURL:  "https://space.bilibili.com/" + mid,
		episodes: episodes,
	}, nil
}

// bilibiliUploaderFace 取 UP 主头像作为订阅列表封面，失败时返回空串（前端回退到通用图标）
func (s *FeedService) bilibiliUploaderFace(mid string) string {
	var out struct {
		Code int `json:"code"`
		Data struct {
			Card struct {
				Face string `json:"face"`
			} `json:"card"`
		} `json:"data"`
	}
	api := "https://api.bilibili.com/x/web-interface/card?mid=" + url.QueryEscape(mid)
	if err := fetchBiliJSON(s.httpClient(), s.bilibiliCookie(), api, &out); err != nil || out.Code != 0 {
		return ""
	}
	face := strings.TrimSpace(out.Data.Card.Face)
	if strings.HasPrefix(face, "http://") {
		face = "https://" + strings.TrimPrefix(face, "http://")
	}
	return face
}

// bilibiliRiskHint 生成风控相关提示：未配置登录 Cookie 时引导扫码登录
func (s *FeedService) bilibiliRiskHint() string {
	s.mu.RLock()
	hasUserCookie := s.biliUserCookie != ""
	s.mu.RUnlock()
	if hasUserCookie {
		return "，可能触发了 B站 风控，请稍后重试或重新扫码登录"
	}
	return "，可能触发了 B站 风控；匿名访问不稳定，建议先在播客页扫码登录 B站 后重试"
}

// bilibiliWbiMixinKey 获取 WBI 签名密钥并缓存 1 小时。
// 未登录时 nav 接口 code 为 -101，但 wbi_img 字段仍然可用。
func (s *FeedService) bilibiliWbiMixinKey() (string, error) {
	s.mu.RLock()
	key, expireAt := s.wbiMixinKey, s.wbiExpireAt
	s.mu.RUnlock()
	if key != "" && time.Now().Before(expireAt) {
		return key, nil
	}

	req, _ := http.NewRequest(http.MethodGet, "https://api.bilibili.com/x/web-interface/nav", nil)
	req.Header.Set("User-Agent", bilibiliWebUA)
	req.Header.Set("Referer", "https://www.bilibili.com")
	req.Header.Set("Cookie", s.bilibiliCookie())

	resp, err := s.httpClient().Do(req)
	if err != nil {
		return "", fmt.Errorf("获取B站签名密钥失败，请检查网络: %w", err)
	}
	defer resp.Body.Close()

	var nav struct {
		Data struct {
			WbiImg struct {
				ImgURL string `json:"img_url"`
				SubURL string `json:"sub_url"`
			} `json:"wbi_img"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&nav); err != nil {
		return "", fmt.Errorf("获取B站签名密钥失败%s", s.bilibiliRiskHint())
	}

	imgKey := biliFileNameKey(nav.Data.WbiImg.ImgURL)
	subKey := biliFileNameKey(nav.Data.WbiImg.SubURL)
	if imgKey == "" || subKey == "" {
		return "", fmt.Errorf("获取B站签名密钥失败，请稍后重试")
	}

	raw := imgKey + subKey
	var sb strings.Builder
	for _, idx := range bilibiliMixinKeyEncTab {
		if idx < len(raw) {
			sb.WriteByte(raw[idx])
		}
	}
	mixinKey := sb.String()
	if len(mixinKey) > 32 {
		mixinKey = mixinKey[:32]
	}

	s.mu.Lock()
	s.wbiMixinKey = mixinKey
	s.wbiExpireAt = time.Now().Add(time.Hour)
	s.mu.Unlock()
	return mixinKey, nil
}

// biliFileNameKey 从 wbi 图片地址中取出文件名（不含扩展名）
func biliFileNameKey(rawURL string) string {
	if rawURL == "" {
		return ""
	}
	name := rawURL[strings.LastIndex(rawURL, "/")+1:]
	if i := strings.Index(name, "."); i >= 0 {
		name = name[:i]
	}
	return name
}

// bilibiliSignWBI 按 WBI 规则对参数排序、过滤特殊字符并附加 wts 与 w_rid
func (s *FeedService) bilibiliSignWBI(params url.Values, mixinKey string) string {
	params.Set("wts", strconv.FormatInt(time.Now().Unix(), 10))

	keys := make([]string, 0, len(params))
	for k := range params {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var sb strings.Builder
	for _, k := range keys {
		v := strings.Map(func(r rune) rune {
			switch r {
			case '!', '\'', '(', ')', '*':
				return -1
			}
			return r
		}, params.Get(k))
		if sb.Len() > 0 {
			sb.WriteByte('&')
		}
		sb.WriteString(url.QueryEscape(k))
		sb.WriteByte('=')
		sb.WriteString(url.QueryEscape(v))
	}
	sum := md5.Sum([]byte(sb.String() + mixinKey))
	return sb.String() + "&w_rid=" + fmt.Sprintf("%x", sum)
}

// bilibiliVideosByWBI 通过 WBI 签名的空间投稿接口拉取视频列表
func (s *FeedService) bilibiliVideosByWBI(mid string) ([]FeedEpisode, error) {
	const maxEpisodes = 30

	mixinKey, err := s.bilibiliWbiMixinKey()
	if err != nil {
		return nil, err
	}

	params := url.Values{}
	params.Set("mid", mid)
	params.Set("ps", strconv.Itoa(maxEpisodes))
	params.Set("pn", "1")
	params.Set("order", "pubdate")
	params.Set("platform", "web")
	signed := s.bilibiliSignWBI(params, mixinKey)

	req, _ := http.NewRequest(http.MethodGet, "https://api.bilibili.com/x/space/wbi/arc/search?"+signed, nil)
	req.Header.Set("User-Agent", bilibiliWebUA)
	req.Header.Set("Referer", "https://space.bilibili.com/"+mid)
	req.Header.Set("Accept", "application/json, text/plain, */*")
	req.Header.Set("Cookie", s.bilibiliCookie())

	resp, err := s.httpClient().Do(req)
	if err != nil {
		return nil, fmt.Errorf("拉取B站视频列表失败，请检查网络: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("拉取B站视频列表失败：B站返回 HTTP %d%s", resp.StatusCode, s.bilibiliRiskHint())
	}

	var apiResp biliArcSearchResp
	if err := json.NewDecoder(resp.Body).Decode(&apiResp); err != nil {
		// 风控命中时返回 HTML 页面而不是 JSON
		return nil, fmt.Errorf("拉取B站视频列表失败：B站返回了网页而不是数据%s", s.bilibiliRiskHint())
	}
	if apiResp.Code != 0 {
		return nil, fmt.Errorf("拉取B站视频列表失败：B站接口返回 %d %s%s", apiResp.Code, apiResp.Message, s.bilibiliRiskHint())
	}

	episodes := make([]FeedEpisode, 0, maxEpisodes)
	for _, v := range apiResp.Data.List.VList {
		if v.BVID == "" {
			continue
		}
		episodes = append(episodes, FeedEpisode{
			Title:       strings.TrimSpace(v.Title),
			Description: stripHTML(v.Description),
			Link:        "https://www.bilibili.com/video/" + v.BVID,
			Duration:    parseBilibiliDuration(v.Length),
			PublishedAt: time.Unix(v.Created, 0).Format(time.RFC3339),
			Image:       normalizeBilibiliPic(v.Pic),
			GUID:        v.BVID,
		})
	}
	return episodes, nil
}

// bilibiliVideosByDynamic 通过动态流接口拉取视频列表。
// features 参数不能省略：省略后接口仍返回 code=0，但 items 为空。
func (s *FeedService) bilibiliVideosByDynamic(mid string) ([]FeedEpisode, error) {
	const (
		maxEpisodes = 30
		maxPages    = 3
	)

	episodes := make([]FeedEpisode, 0, maxEpisodes)
	offset := ""
	for page := 0; page < maxPages && len(episodes) < maxEpisodes; page++ {
		q := url.Values{}
		q.Set("host_mid", mid)
		q.Set("timezone_offset", "-480")
		q.Set("features", "itemOpusStyle,listOnlyfans,opusBigCover,onlyfansVote")
		if offset != "" {
			q.Set("offset", offset)
		}
		req, _ := http.NewRequest(http.MethodGet, "https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space?"+q.Encode(), nil)
		req.Header.Set("User-Agent", bilibiliWebUA)
		req.Header.Set("Referer", "https://space.bilibili.com/"+mid+"/dynamic")
		req.Header.Set("Accept", "application/json, text/plain, */*")
		req.Header.Set("Cookie", s.bilibiliCookie())

		resp, err := s.httpClient().Do(req)
		if err != nil {
			return nil, fmt.Errorf("拉取B站视频列表失败，请检查网络: %w", err)
		}
		var apiResp biliDynamicResp
		decodeErr := json.NewDecoder(resp.Body).Decode(&apiResp)
		_ = resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			// 匿名请求过多时 B站会直接返回 412 风控页
			return nil, fmt.Errorf("拉取B站视频列表失败：B站返回 HTTP %d%s", resp.StatusCode, s.bilibiliRiskHint())
		}
		if decodeErr != nil {
			return nil, fmt.Errorf("拉取B站视频列表失败：B站返回了网页而不是数据%s", s.bilibiliRiskHint())
		}
		if apiResp.Code != 0 {
			return nil, fmt.Errorf("拉取B站视频列表失败：B站接口返回 %d %s%s", apiResp.Code, apiResp.Message, s.bilibiliRiskHint())
		}

		for _, item := range apiResp.Data.Items {
			archive := item.Modules.ModuleDynamic.Major.Archive
			if item.Type != "DYNAMIC_TYPE_AV" || archive == nil || archive.BVID == "" {
				continue
			}
			desc := archive.Desc
			if desc == "" && item.Modules.ModuleDynamic.Desc != nil {
				desc = item.Modules.ModuleDynamic.Desc.Text
			}
			pubTS, _ := strconv.ParseInt(item.Modules.ModuleAuthor.PubTS, 10, 64)
			episodes = append(episodes, FeedEpisode{
				Title:       strings.TrimSpace(archive.Title),
				Description: stripHTML(desc),
				Link:        "https://www.bilibili.com/video/" + archive.BVID,
				Duration:    parseBilibiliDuration(archive.DurationText),
				PublishedAt: time.Unix(pubTS, 0).Format(time.RFC3339),
				Image:       normalizeBilibiliPic(archive.Cover),
				GUID:        archive.BVID,
			})
			if len(episodes) >= maxEpisodes {
				break
			}
		}

		if !apiResp.Data.HasMore || apiResp.Data.Offset == "" || apiResp.Data.Offset == offset {
			break
		}
		offset = apiResp.Data.Offset
	}
	return episodes, nil
}

// normalizeBilibiliPic 把 B站封面地址统一成 https 绝对地址
func normalizeBilibiliPic(pic string) string {
	pic = strings.TrimSpace(pic)
	if strings.HasPrefix(pic, "//") {
		return "https:" + pic
	}
	if strings.HasPrefix(pic, "http://") {
		return "https://" + strings.TrimPrefix(pic, "http://")
	}
	return pic
}

// --- B站扫码登录 ---

// biliQRLoginResult 是扫码登录接口返回给前端的结果
type biliQRLoginResult struct {
	OK      bool   `json:"ok"`
	URL     string `json:"url,omitempty"`
	Key     string `json:"key,omitempty"`
	Status  string `json:"status,omitempty"`
	Message string `json:"message,omitempty"`
	Error   string `json:"error,omitempty"`
}

func marshalBiliQR(v biliQRLoginResult) string {
	b, _ := json.Marshal(v)
	return string(b)
}

// bilibiliPassportRequest 请求 B站 passport 接口，复用订阅代理与当前 Cookie
func (s *FeedService) bilibiliPassportRequest(target string) (*http.Response, error) {
	req, _ := http.NewRequest(http.MethodGet, target, nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Referer", "https://www.bilibili.com/")
	req.Header.Set("Accept", "application/json, text/plain, */*")
	req.Header.Set("Cookie", s.bilibiliCookie())
	return s.httpClient().Do(req)
}

// StartBilibiliQRLogin 生成 B站 扫码登录的二维码内容
func (s *FeedService) StartBilibiliQRLogin() string {
	resp, err := s.bilibiliPassportRequest("https://passport.bilibili.com/x/passport-login/web/qrcode/generate")
	if err != nil {
		return marshalBiliQR(biliQRLoginResult{Error: "生成二维码失败，请检查网络或代理: " + err.Error()})
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return marshalBiliQR(biliQRLoginResult{Error: fmt.Sprintf("生成二维码失败：B站返回 HTTP %d", resp.StatusCode)})
	}
	var out struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Data    struct {
			URL       string `json:"url"`
			QRCodeKey string `json:"qrcode_key"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return marshalBiliQR(biliQRLoginResult{Error: "生成二维码失败：B站返回内容异常"})
	}
	if out.Code != 0 || out.Data.QRCodeKey == "" {
		msg := out.Message
		if msg == "" {
			msg = "未知错误"
		}
		return marshalBiliQR(biliQRLoginResult{Error: "生成二维码失败：" + msg})
	}
	return marshalBiliQR(biliQRLoginResult{OK: true, URL: out.Data.URL, Key: out.Data.QRCodeKey})
}

// PollBilibiliQRLogin 轮询扫码状态，登录成功后自动保存 Cookie
func (s *FeedService) PollBilibiliQRLogin(key string) string {
	key = strings.TrimSpace(key)
	if key == "" {
		return marshalBiliQR(biliQRLoginResult{Error: "二维码已失效，请刷新"})
	}
	resp, err := s.bilibiliPassportRequest("https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=" +
		url.QueryEscape(key) + "&source=main-mini")
	if err != nil {
		return marshalBiliQR(biliQRLoginResult{Error: "查询扫码状态失败，请检查网络或代理: " + err.Error()})
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return marshalBiliQR(biliQRLoginResult{Error: fmt.Sprintf("查询扫码状态失败：B站返回 HTTP %d", resp.StatusCode)})
	}

	var out struct {
		Data struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return marshalBiliQR(biliQRLoginResult{Error: "查询扫码状态失败：B站返回内容异常"})
	}

	switch out.Data.Code {
	case 0:
		cookie := bilibiliLoginCookie(resp.Cookies())
		if cookie == "" {
			return marshalBiliQR(biliQRLoginResult{Status: "failed", Error: "登录成功但未获取到 Cookie，请重试"})
		}
		var res feedActionResult
		_ = json.Unmarshal([]byte(s.SetBilibiliCookie(cookie)), &res)
		if !res.OK {
			return marshalBiliQR(biliQRLoginResult{Status: "failed", Error: "保存 Cookie 失败: " + res.Error})
		}
		return marshalBiliQR(biliQRLoginResult{OK: true, Status: "success", Message: "登录成功"})
	case 86101:
		return marshalBiliQR(biliQRLoginResult{OK: true, Status: "waiting", Message: "等待扫码"})
	case 86090:
		return marshalBiliQR(biliQRLoginResult{OK: true, Status: "scanned", Message: "已扫码，请在手机上确认"})
	case 86038:
		return marshalBiliQR(biliQRLoginResult{OK: true, Status: "expired", Message: "二维码已过期，请刷新"})
	default:
		return marshalBiliQR(biliQRLoginResult{OK: true, Status: "failed", Error: fmt.Sprintf("登录失败（%d）", out.Data.Code)})
	}
}

// bilibiliLoginCookie 从登录响应的 Set-Cookie 中提取需要的字段拼成 Cookie 串
func bilibiliLoginCookie(cookies []*http.Cookie) string {
	wanted := map[string]bool{
		"SESSDATA": true, "bili_jct": true, "DedeUserID": true,
		"DedeUserID__ckMd5": true, "sid": true, "buvid3": true, "buvid4": true,
	}
	parts := make([]string, 0, len(wanted))
	for _, c := range cookies {
		if wanted[c.Name] && c.Value != "" {
			parts = append(parts, c.Name+"="+c.Value)
		}
	}
	return strings.Join(parts, "; ")
}

// parseBilibiliDuration 把 B 站的 mm:ss 时长字符串转成秒数
func parseBilibiliDuration(s string) int {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	parts := strings.Split(s, ":")
	total := 0
	for _, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil {
			return 0
		}
		total = total*60 + n
	}
	return total
}
