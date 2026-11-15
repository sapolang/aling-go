package content

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"aling-go/internal/config"
	"aling-go/internal/core"
	"aling-go/internal/store/userdb"

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

type ActionResult struct {
	OK      bool   `json:"ok"`
	Error   string `json:"error"`
	Message string `json:"message"`
}

type EpisodeDownloadResult struct {
	OK    bool   `json:"ok"`
	Error string `json:"error"`
	Path  string `json:"path"`
}

type FeedListResult struct {
	Feeds []Feed `json:"feeds"`
	Error string `json:"error"`
}

type FeedEpisodesResult struct {
	Episodes []FeedEpisode `json:"episodes"`
	Error    string        `json:"error"`
}

// FeedService 负责播客 RSS 订阅：拉取订阅源、解析节目列表、按需下载音频到本地。
// 下载完成的音频会写入媒体库，走现有播放器 + whisper 链路。
type FeedService struct {
	app     *application.App
	dataDir string
	library *LibraryService
	store   *config.Store

	mu    sync.RWMutex
	proxy string
	// client 复用 HTTP 连接；代理配置变化时置空，下次使用时按新代理重建
	client *http.Client

	// biliCookie 是匿名请求 B站接口所需的 buvid Cookie，首次使用时生成
	biliCookie string
	// biliUserCookie 是用户在播客页配置的 B站登录态 Cookie，优先使用
	biliUserCookie string
	// wbiMixinKey 是 WBI 签名密钥，接口侧约按小时轮换，这里缓存 1 小时
	wbiMixinKey string
	wbiExpireAt time.Time
}

func NewFeedService(app *application.App, dataDir string, library *LibraryService, store *config.Store) *FeedService {
	st := store.Settings()
	secrets := store.Secrets()
	return &FeedService{
		app:     app,
		dataDir: dataDir,
		library: library,
		store:   store,
		proxy:   st.FeedProxy,

		biliUserCookie: secrets.BilibiliCookie,
	}
}

func (s *FeedService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	// 建表由 core 统一执行 store.Schema 完成，这里只补齐老版本缺失的列。
	_, _ = core.DB.Exec(`ALTER TABLE feed_episodes ADD COLUMN link TEXT DEFAULT ''`)
	_, _ = core.DB.Exec(`ALTER TABLE feed_episodes ADD COLUMN image TEXT DEFAULT ''`)
	return nil
}

func (s *FeedService) ServiceShutdown() error { return nil }

// --- 网络配置 ---

// GetProxy 返回当前订阅拉取使用的代理地址
func (s *FeedService) GetProxy() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.proxy
}

// SetProxy 设置订阅拉取使用的代理（形如 http://127.0.0.1:7890），传空字符串表示直连
func (s *FeedService) SetProxy(proxy string) ActionResult {
	proxy = strings.TrimSpace(proxy)
	if proxy != "" {
		if u, err := url.Parse(proxy); err != nil || u.Scheme == "" {
			return ActionResult{Error: "代理地址格式不正确，应形如 http://127.0.0.1:7890"}
		}
	}
	s.mu.Lock()
	s.proxy = proxy
	oldClient := s.client
	s.client = nil
	s.mu.Unlock()
	if oldClient != nil {
		oldClient.CloseIdleConnections()
	}

	if err := s.store.UpdateSettings(func(st *config.Settings) {
		st.FeedProxy = proxy
	}); err != nil {
		return ActionResult{Error: "保存配置失败: " + err.Error()}
	}
	return ActionResult{OK: true}
}

// GetBilibiliCookie 返回用户配置的 B站 Cookie，未配置时为空
func (s *FeedService) GetBilibiliCookie() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.biliUserCookie
}

// SetBilibiliCookie 设置拉取 B站订阅源时携带的 Cookie，传空字符串表示清除。
// 带上登录态 Cookie（SESSDATA）可以显著降低 B站风控命中率。
func (s *FeedService) SetBilibiliCookie(cookie string) ActionResult {
	cookie = normalizeCookie(cookie)
	if cookie != "" && !strings.Contains(cookie, "=") {
		return ActionResult{Error: "Cookie 格式不正确，应形如 SESSDATA=xxx"}
	}
	s.mu.Lock()
	s.biliUserCookie = cookie
	s.mu.Unlock()

	if err := s.store.UpdateSecrets(func(sc *config.Secrets) {
		sc.BilibiliCookie = cookie
	}); err != nil {
		return ActionResult{Error: "保存配置失败: " + err.Error()}
	}
	return ActionResult{OK: true}
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
	s.mu.RLock()
	client := s.client
	s.mu.RUnlock()
	if client != nil {
		return client
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	// 双重检查：并发首次调用时只创建一个 client
	if s.client != nil {
		return s.client
	}
	transport := &http.Transport{
		Proxy:               http.ProxyFromEnvironment,
		MaxIdleConns:        100,
		MaxIdleConnsPerHost: 8,
		IdleConnTimeout:     90 * time.Second,
		TLSHandshakeTimeout: 15 * time.Second,
	}
	if s.proxy != "" {
		if u, err := url.Parse(s.proxy); err == nil {
			transport.Proxy = http.ProxyURL(u)
		}
	}
	s.client = &http.Client{Timeout: 60 * time.Second, Transport: transport}
	return s.client
}

// HTTPClient 返回带用户代理配置的 HTTP 客户端，供其他服务（如 B 站取流）复用
func (s *FeedService) HTTPClient() *http.Client {
	return s.httpClient()
}

// --- 订阅 CRUD ---

func (s *FeedService) FeedList() FeedListResult {
	rows, err := q().ListFeeds(context.Background())
	if err != nil {
		return FeedListResult{Feeds: []Feed{}, Error: err.Error()}
	}
	feeds := make([]Feed, 0, len(rows))
	for _, row := range rows {
		feeds = append(feeds, Feed{
			ID:            row.ID,
			URL:           row.Url,
			Title:         row.Title,
			Description:   row.Description,
			Image:         row.Image,
			SiteURL:       row.SiteUrl,
			LastFetchedAt: row.LastFetchedAt,
			LastError:     row.LastError,
			EpisodeCount:  int(row.EpisodeCount),
		})
	}
	return FeedListResult{Feeds: feeds}
}

// FeedAdd 订阅一个 RSS 地址，立即拉取一次并落库
func (s *FeedService) FeedAdd(feedURL string) ActionResult {
	feedURL = strings.TrimSpace(feedURL)
	if feedURL == "" {
		return ActionResult{Error: "请填写订阅地址"}
	}
	if u, err := url.Parse(feedURL); err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return ActionResult{Error: "订阅地址需以 http:// 或 https:// 开头"}
	}

	exists, _ := q().CountFeedByURL(context.Background(), feedURL)
	if exists > 0 {
		return ActionResult{Error: "该订阅源已存在"}
	}

	meta, err := s.fetchFeed(feedURL)
	if err != nil {
		return ActionResult{Error: err.Error()}
	}

	feedID, err := q().AddFeed(context.Background(), userdb.AddFeedParams{
		Url:           feedURL,
		Title:         meta.title,
		Description:   meta.desc,
		Image:         meta.image,
		SiteUrl:       meta.siteURL,
		LastFetchedAt: time.Now().Format(time.RFC3339),
	})
	if err != nil {
		return ActionResult{Error: "保存订阅失败: " + err.Error()}
	}
	s.saveEpisodes(feedID, meta.episodes)

	return ActionResult{
		OK:      true,
		Message: fmt.Sprintf("已订阅《%s》，共 %d 期节目", meta.title, len(meta.episodes)),
	}
}

// FeedRefresh 重新拉取指定订阅，id <= 0 时刷新全部
func (s *FeedService) FeedRefresh(feedID int64) ActionResult {
	if feedID <= 0 {
		return s.refreshAll()
	}
	if err := s.refreshOne(feedID); err != nil {
		return ActionResult{Error: err.Error()}
	}
	return ActionResult{OK: true, Message: "已更新"}
}

func (s *FeedService) refreshAll() ActionResult {
	ids, err := q().ListFeedIDs(context.Background())
	if err != nil {
		return ActionResult{Error: err.Error()}
	}

	var failed int
	for _, id := range ids {
		if err := s.refreshOne(id); err != nil {
			failed++
		}
	}
	if failed > 0 {
		return ActionResult{OK: true, Message: fmt.Sprintf("更新完成，%d 个订阅源失败", failed)}
	}
	return ActionResult{OK: true, Message: fmt.Sprintf("已更新 %d 个订阅源", len(ids))}
}

func (s *FeedService) refreshOne(feedID int64) error {
	ctx := context.Background()
	feedURL, err := q().GetFeedURL(ctx, feedID)
	if err != nil {
		return fmt.Errorf("订阅源不存在")
	}
	meta, err := s.fetchFeed(feedURL)
	if err != nil {
		_ = q().SetFeedError(ctx, userdb.SetFeedErrorParams{LastError: err.Error(), ID: feedID})
		return err
	}
	_ = q().UpdateFeedMeta(ctx, userdb.UpdateFeedMetaParams{
		Title:         meta.title,
		Description:   meta.desc,
		Image:         meta.image,
		SiteUrl:       meta.siteURL,
		LastFetchedAt: time.Now().Format(time.RFC3339),
		ID:            feedID,
	})
	s.saveEpisodes(feedID, meta.episodes)
	return nil
}

// FeedRemove 取消订阅并删除该订阅下的节目记录（不删除已下载的音频文件）
func (s *FeedService) FeedRemove(feedID int64) ActionResult {
	ctx := context.Background()
	_ = q().DeleteFeedEpisodes(ctx, feedID)
	n, err := q().DeleteFeed(ctx, feedID)
	if err != nil {
		return ActionResult{Error: err.Error()}
	}
	if n == 0 {
		return ActionResult{Error: "订阅源不存在"}
	}
	return ActionResult{OK: true, Message: "已取消订阅"}
}

// FeedEpisodes 返回订阅源下的节目列表，limit <= 0 时默认 100 条
func (s *FeedService) FeedEpisodes(feedID int64, limit int) FeedEpisodesResult {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := q().ListFeedEpisodes(context.Background(), userdb.ListFeedEpisodesParams{
		FeedID: feedID,
		Limit:  int64(limit),
	})
	if err != nil {
		return FeedEpisodesResult{Episodes: []FeedEpisode{}, Error: err.Error()}
	}

	episodes := make([]FeedEpisode, 0, len(rows))
	for _, row := range rows {
		e := FeedEpisode{
			ID:          row.ID,
			FeedID:      row.FeedID,
			Title:       row.Title,
			Description: row.Description,
			AudioURL:    row.AudioUrl,
			Link:        row.Link,
			Duration:    row.Duration,
			PublishedAt: row.PublishedAt,
			LocalPath:   row.LocalPath,
			Image:       row.Image,
		}
		// 兼容历史数据：旧版本把 YouTube 播放页当成了音频地址，下载结果是网页；
		// 没有音频直链的在线节目同样不应展示"已下载"
		if isVideoMediaURL(e.AudioURL, "") || (e.Link != "" && e.AudioURL == "") {
			e.AudioURL = ""
			e.LocalPath = ""
		}
		episodes = append(episodes, e)
	}
	return FeedEpisodesResult{Episodes: episodes}
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
	ctx := context.Background()
	tx, err := core.DB.Begin()
	if err != nil {
		return
	}
	qtx := userdb.New(tx)
	for _, e := range episodes {
		if err := qtx.UpsertFeedEpisode(ctx, userdb.UpsertFeedEpisodeParams{
			FeedID:      feedID,
			Guid:        e.GUID,
			Title:       e.Title,
			Description: e.Description,
			AudioUrl:    e.AudioURL,
			Link:        e.Link,
			Duration:    e.Duration,
			PublishedAt: e.PublishedAt,
			Image:       e.Image,
		}); err != nil {
			_ = tx.Rollback()
			return
		}
	}
	_ = tx.Commit()
}
