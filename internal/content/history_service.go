package content

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"sync"

	"aling-go/internal/core"
	"aling-go/internal/store/userdb"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// 历史条目来源类型
const (
	HistoryKindLocal    = "local"
	HistoryKindPodcast  = "podcast"
	HistoryKindBilibili = "bilibili"
	HistoryKindYouTube  = "youtube"
	maxHistoryEntries   = 500
	// 每写入这么多条历史才裁剪一次，避免每次打开媒体都做全表排序删除
	historyTrimInterval  = 20
	defaultHistoryLimit  = 50
	defaultContinueLimit = 5
)

// HistoryEntry 是一条播放记录。MediaKey 与播放器 store 的 filePath 一致：
// 本地文件为绝对路径，在线音频为原始 URL，YouTube 为 yt:<videoId>，B站为 bili:<bvid>。
type HistoryEntry struct {
	MediaKey string `json:"mediaKey"`
	Kind     string `json:"kind"`
	// MediaKind 记录播放时的媒体形态（audio/video），恢复播放时不必再按地址后缀推断
	MediaKind string `json:"mediaKind"`
	// PreferProxy 表示该条目必须经本地代理播放（如订阅源视频直链）
	PreferProxy bool    `json:"preferProxy"`
	Title       string  `json:"title"`
	Cover       string  `json:"cover"`
	SourceURL   string  `json:"sourceUrl"`
	EpisodeID   int64   `json:"episodeId"`
	Position    float64 `json:"position"`
	Duration    float64 `json:"duration"`
	PlayCount   int     `json:"playCount"`
	LastPlayed  string  `json:"lastPlayedAt"`
}

// HistoryUpsertInput 是记录一次播放开始所需的写模型：
// 播放次数与最后播放时间由后端维护，前端不需要也不能伪造。
type HistoryUpsertInput struct {
	MediaKey    string  `json:"mediaKey"`
	Kind        string  `json:"kind"`
	MediaKind   string  `json:"mediaKind"`
	PreferProxy bool    `json:"preferProxy"`
	Title       string  `json:"title"`
	Cover       string  `json:"cover"`
	SourceURL   string  `json:"sourceUrl"`
	EpisodeID   int64   `json:"episodeId"`
	Position    float64 `json:"position"`
	Duration    float64 `json:"duration"`
}

// HistoryService 负责跨来源的统一播放记录，与媒体库（library.json）相互独立。
type HistoryService struct {
	app *application.App

	mu              sync.Mutex
	writesSinceTrim int
}

func NewHistoryService(app *application.App) *HistoryService {
	return &HistoryService{app: app}
}

func (s *HistoryService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	// 建表由 core 统一执行 store.Schema 完成，这里只补齐老版本缺失的列
	_, _ = core.DB.Exec(`ALTER TABLE play_history ADD COLUMN media_kind TEXT NOT NULL DEFAULT ''`)
	_, _ = core.DB.Exec(`ALTER TABLE play_history ADD COLUMN prefer_proxy INTEGER NOT NULL DEFAULT 0`)
	// 低频路径补一次裁剪：上次退出后累积的条目也要回落到上限内
	if err := q().TrimHistory(ctx, maxHistoryEntries); err != nil {
		s.logger().Warn("history trim on startup", "error", err)
	}
	return nil
}
func (s *HistoryService) ServiceShutdown() error { return nil }

func (s *HistoryService) logger() *slog.Logger {
	return loggerOf(s.app)
}

// Upsert 记录一次播放开始：写入元信息并累加播放次数，播放位置保持不变。
// RETURNING 让写入和返回在同一语句内完成，无需再查一次。
func (s *HistoryService) Upsert(in HistoryUpsertInput) HistoryEntry {
	if in.MediaKey == "" {
		return HistoryEntry{}
	}
	ctx := context.Background()
	kind := in.Kind
	if kind == "" {
		kind = HistoryKindLocal
	}
	row, err := q().UpsertHistory(ctx, userdb.UpsertHistoryParams{
		MediaKey:    in.MediaKey,
		Kind:        kind,
		MediaKind:   in.MediaKind,
		PreferProxy: boolToInt(in.PreferProxy),
		Title:       in.Title,
		Cover:       in.Cover,
		SourceUrl:   in.SourceURL,
		EpisodeID:   in.EpisodeID,
		Position:    in.Position,
		Duration:    in.Duration,
	})
	if err != nil {
		s.logger().Error("history upsert", "mediaKey", in.MediaKey, "error", err)
		return HistoryEntry{}
	}
	if s.trimDue() {
		if err := q().TrimHistory(ctx, maxHistoryEntries); err != nil {
			s.logger().Warn("history trim", "error", err)
		}
	}
	return toHistoryEntry(row)
}

// trimDue 统计写入次数，每 historyTrimInterval 次返回一次 true，
// 把裁剪从每次播放一次降到低频执行。
func (s *HistoryService) trimDue() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.writesSinceTrim++
	if s.writesSinceTrim < historyTrimInterval {
		return false
	}
	s.writesSinceTrim = 0
	return true
}

// UpdatePosition 保存播放进度，前端需节流调用（建议 5 秒一次）。
func (s *HistoryService) UpdatePosition(mediaKey string, position, duration float64) {
	if mediaKey == "" {
		return
	}
	if position < 0 {
		position = 0
	}
	err := q().UpdateHistoryPosition(context.Background(), userdb.UpdateHistoryPositionParams{
		Position: position,
		Duration: duration,
		MediaKey: mediaKey,
	})
	if err != nil {
		s.logger().Error("history update position", "mediaKey", mediaKey, "error", err)
	}
}

// List 按最后播放时间倒序返回历史，kind 为空表示全部来源。
func (s *HistoryService) List(kind string, limit, offset int) []HistoryEntry {
	if limit <= 0 {
		limit = defaultHistoryLimit
	}
	if limit > maxHistoryEntries {
		limit = maxHistoryEntries
	}
	if offset < 0 {
		offset = 0
	}
	rows, err := q().ListHistory(context.Background(), userdb.ListHistoryParams{
		Kind: kind,
		Lim:  int64(limit),
		Off:  int64(offset),
	})
	if err != nil {
		s.logger().Error("history list", "kind", kind, "error", err)
		return []HistoryEntry{}
	}
	return toHistoryEntries(rows)
}

// ContinueLearning 返回尚未看完、可继续播放的条目。
func (s *HistoryService) ContinueLearning(limit int) []HistoryEntry {
	if limit <= 0 {
		limit = defaultContinueLimit
	}
	rows, err := q().ListContinueLearning(context.Background(), int64(limit))
	if err != nil {
		s.logger().Error("history continue learning", "error", err)
		return []HistoryEntry{}
	}
	return toHistoryEntries(rows)
}

// Get 返回单条历史，不存在时返回空结构。
func (s *HistoryService) Get(mediaKey string) HistoryEntry {
	row, err := q().GetHistory(context.Background(), mediaKey)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			s.logger().Error("history get", "mediaKey", mediaKey, "error", err)
		}
		return HistoryEntry{}
	}
	return toHistoryEntry(row)
}

func (s *HistoryService) Delete(mediaKey string) {
	if err := q().DeleteHistory(context.Background(), mediaKey); err != nil {
		s.logger().Error("history delete", "mediaKey", mediaKey, "error", err)
	}
}

func (s *HistoryService) Clear() {
	if err := q().ClearHistory(context.Background()); err != nil {
		s.logger().Error("history clear", "error", err)
	}
}

func toHistoryEntry(r userdb.PlayHistory) HistoryEntry {
	return HistoryEntry{
		MediaKey:    r.MediaKey,
		Kind:        r.Kind,
		MediaKind:   r.MediaKind,
		PreferProxy: r.PreferProxy != 0,
		Title:       r.Title,
		Cover:       r.Cover,
		SourceURL:   r.SourceUrl,
		EpisodeID:   r.EpisodeID,
		Position:    r.Position,
		Duration:    r.Duration,
		PlayCount:   int(r.PlayCount),
		LastPlayed:  r.LastPlayedAt,
	}
}

func toHistoryEntries(rows []userdb.PlayHistory) []HistoryEntry {
	out := make([]HistoryEntry, 0, len(rows))
	for _, r := range rows {
		out = append(out, toHistoryEntry(r))
	}
	return out
}
