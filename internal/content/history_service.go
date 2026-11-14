package content

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"

	"aling-go/internal/store/userdb"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// 历史条目来源类型
const (
	HistoryKindLocal     = "local"
	HistoryKindPodcast   = "podcast"
	HistoryKindBilibili  = "bilibili"
	HistoryKindYouTube   = "youtube"
	maxHistoryEntries    = 500
	defaultHistoryLimit  = 50
	defaultContinueLimit = 5
)

// HistoryEntry 是一条播放记录。MediaKey 与播放器 store 的 filePath 一致：
// 本地文件为绝对路径，在线音频为原始 URL，YouTube 为 yt:<videoId>，B站为代理播放地址。
type HistoryEntry struct {
	MediaKey   string  `json:"mediaKey"`
	Kind       string  `json:"kind"`
	Title      string  `json:"title"`
	Cover      string  `json:"cover"`
	SourceURL  string  `json:"sourceUrl"`
	EpisodeID  int64   `json:"episodeId"`
	Position   float64 `json:"position"`
	Duration   float64 `json:"duration"`
	PlayCount  int     `json:"playCount"`
	LastPlayed string  `json:"lastPlayedAt"`
}

// HistoryService 负责跨来源的统一播放记录，与媒体库（library.json）相互独立。
type HistoryService struct {
	app *application.App
}

func NewHistoryService(app *application.App) *HistoryService {
	return &HistoryService{app: app}
}

func (s *HistoryService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	return nil
}
func (s *HistoryService) ServiceShutdown() error { return nil }

// Upsert 记录一次播放开始：写入元信息并累加播放次数，播放位置保持不变。
func (s *HistoryService) Upsert(e HistoryEntry) HistoryEntry {
	if e.MediaKey == "" {
		return HistoryEntry{}
	}
	ctx := context.Background()
	kind := e.Kind
	if kind == "" {
		kind = HistoryKindLocal
	}
	err := q().UpsertHistory(ctx, userdb.UpsertHistoryParams{
		MediaKey:  e.MediaKey,
		Kind:      kind,
		Title:     e.Title,
		Cover:     e.Cover,
		SourceUrl: e.SourceURL,
		EpisodeID: e.EpisodeID,
		Position:  e.Position,
		Duration:  e.Duration,
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "HistoryUpsert: %v\n", err)
		return HistoryEntry{}
	}
	_ = q().TrimHistory(ctx, maxHistoryEntries)
	row, err := q().GetHistory(ctx, e.MediaKey)
	if err != nil {
		return e
	}
	return toHistoryEntry(row)
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
		fmt.Fprintf(os.Stderr, "HistoryUpdatePosition: %v\n", err)
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
		fmt.Fprintf(os.Stderr, "HistoryList: %v\n", err)
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
		fmt.Fprintf(os.Stderr, "HistoryContinueLearning: %v\n", err)
		return []HistoryEntry{}
	}
	return toHistoryEntries(rows)
}

// Get 返回单条历史，不存在时返回空结构。
func (s *HistoryService) Get(mediaKey string) HistoryEntry {
	row, err := q().GetHistory(context.Background(), mediaKey)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			fmt.Fprintf(os.Stderr, "HistoryGet: %v\n", err)
		}
		return HistoryEntry{}
	}
	return toHistoryEntry(row)
}

func (s *HistoryService) Delete(mediaKey string) {
	if err := q().DeleteHistory(context.Background(), mediaKey); err != nil {
		fmt.Fprintf(os.Stderr, "HistoryDelete: %v\n", err)
	}
}

func (s *HistoryService) Clear() {
	if err := q().ClearHistory(context.Background()); err != nil {
		fmt.Fprintf(os.Stderr, "HistoryClear: %v\n", err)
	}
}

func toHistoryEntry(r userdb.PlayHistory) HistoryEntry {
	return HistoryEntry{
		MediaKey:   r.MediaKey,
		Kind:       r.Kind,
		Title:      r.Title,
		Cover:      r.Cover,
		SourceURL:  r.SourceUrl,
		EpisodeID:  r.EpisodeID,
		Position:   r.Position,
		Duration:   r.Duration,
		PlayCount:  int(r.PlayCount),
		LastPlayed: r.LastPlayedAt,
	}
}

func toHistoryEntries(rows []userdb.PlayHistory) []HistoryEntry {
	out := make([]HistoryEntry, 0, len(rows))
	for _, r := range rows {
		out = append(out, toHistoryEntry(r))
	}
	return out
}
