package content

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"aling-go/internal/core"

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
	Duration    int    `json:"duration"`
	PublishedAt string `json:"publishedAt"`
	LocalPath   string `json:"localPath"`
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
}

func NewFeedService(app *application.App, dataDir string, library *LibraryService) *FeedService {
	return &FeedService{
		app:     app,
		dataDir: dataDir,
		library: library,
		proxy:   loadFeedProxy(dataDir),
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
			duration INTEGER DEFAULT 0,
			published_at TEXT DEFAULT '',
			local_path TEXT DEFAULT '',
			created_at TEXT DEFAULT (datetime('now','localtime')),
			UNIQUE(feed_id, guid)
		);
		CREATE INDEX IF NOT EXISTS idx_feed_episodes_feed ON feed_episodes(feed_id, published_at);
	`)
	return err
}

// --- 网络配置 ---

func feedConfigPath(dataDir string) string {
	return filepath.Join(dataDir, "feed-config.json")
}

type feedConfig struct {
	Proxy string `json:"proxy"`
}

func loadFeedProxy(dataDir string) string {
	data, err := os.ReadFile(feedConfigPath(dataDir))
	if err != nil {
		return ""
	}
	var cfg feedConfig
	if json.Unmarshal(data, &cfg) != nil {
		return ""
	}
	return strings.TrimSpace(cfg.Proxy)
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
	s.mu.Unlock()

	b, _ := json.Marshal(feedConfig{Proxy: proxy})
	_ = os.WriteFile(feedConfigPath(s.dataDir), b, 0600)
	out, _ := json.Marshal(feedActionResult{OK: true})
	return string(out)
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

// --- RSS 解析 ---

type rssDocument struct {
	Channel struct {
		Title       string `xml:"title"`
		Description string `xml:"description"`
		Link        string `xml:"link"`
		Image       struct {
			URL string `xml:"url"`
		} `xml:"image"`
		ItunesImage struct {
			Href string `xml:"href,attr"`
		} `xml:"http://www.itunes.com/dtds/podcast-1.0.dtd image"`
		Items []rssItem `xml:"item"`
	} `xml:"channel"`
}

type rssItem struct {
	Title          string     `xml:"title"`
	Description    string     `xml:"description"`
	GUID           string     `xml:"guid"`
	PubDate        string     `xml:"pubDate"`
	Enclosure      rssEnclose `xml:"enclosure"`
	ItunesDuration string     `xml:"http://www.itunes.com/dtds/podcast-1.0.dtd duration"`
}

type rssEnclose struct {
	URL string `xml:"url,attr"`
}

// parseRSS 解析 RSS 2.0 文档，返回订阅元信息与节目列表
func parseRSS(data []byte) (title, desc, image, siteURL string, episodes []FeedEpisode, err error) {
	var doc rssDocument
	if uerr := xml.Unmarshal(data, &doc); uerr != nil {
		return "", "", "", "", nil, fmt.Errorf("解析订阅源失败: %w", uerr)
	}
	ch := doc.Channel
	if ch.Title == "" && len(ch.Items) == 0 {
		return "", "", "", "", nil, fmt.Errorf("不是有效的 RSS 订阅源")
	}

	title = strings.TrimSpace(ch.Title)
	desc = stripHTML(ch.Description)
	siteURL = strings.TrimSpace(ch.Link)
	image = strings.TrimSpace(ch.Image.URL)
	if image == "" {
		image = strings.TrimSpace(ch.ItunesImage.Href)
	}

	for _, it := range ch.Items {
		audioURL := strings.TrimSpace(it.Enclosure.URL)
		if audioURL == "" {
			continue
		}
		guid := strings.TrimSpace(it.GUID)
		if guid == "" {
			guid = audioURL
		}
		episodes = append(episodes, FeedEpisode{
			Title:       strings.TrimSpace(it.Title),
			Description: stripHTML(it.Description),
			AudioURL:    audioURL,
			Duration:    parseDuration(it.ItunesDuration),
			PublishedAt: normalizePubDate(it.PubDate),
			GUID:        guid,
		})
	}
	return title, desc, image, siteURL, episodes, nil
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
		SELECT id, feed_id, title, description, audio_url, duration, published_at, local_path
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
		if err := rows.Scan(&e.ID, &e.FeedID, &e.Title, &e.Description, &e.AudioURL, &e.Duration, &e.PublishedAt, &e.LocalPath); err != nil {
			continue
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
		return nil, fmt.Errorf("拉取订阅源失败: HTTP %s", resp.Status)
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
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
		INSERT INTO feed_episodes (feed_id, guid, title, description, audio_url, duration, published_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(feed_id, guid) DO UPDATE SET
			title = excluded.title,
			description = excluded.description,
			audio_url = excluded.audio_url,
			duration = excluded.duration,
			published_at = excluded.published_at`)
	if err != nil {
		return
	}
	defer stmt.Close()

	for _, e := range episodes {
		_, _ = stmt.Exec(feedID, e.GUID, e.Title, e.Description, e.AudioURL, e.Duration, e.PublishedAt)
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
		return episodeResultJSON(episodeDownloadResult{Error: "下载失败，请检查网络或代理设置: " + err.Error()})
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return episodeResultJSON(episodeDownloadResult{Error: "下载失败: HTTP " + resp.Status})
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
		s.library.importFiles([]string{dest}, "")
	}
	s.app.Event.Emit("feed:download-progress", map[string]any{"episodeId": episodeID, "pct": 100})

	return episodeResultJSON(episodeDownloadResult{OK: true, Path: dest})
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
