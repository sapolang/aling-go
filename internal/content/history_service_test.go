package content

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"aling-go/internal/core"
	"aling-go/internal/store"
	"aling-go/internal/store/userdb"
)

// setupHistoryDB 在临时目录创建用户库并注入 core.DB，供播放历史相关用例使用。
func setupHistoryDB(t *testing.T) {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "userData.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if _, err := db.Exec(store.Schema); err != nil {
		t.Fatalf("create schema: %v", err)
	}
	old := core.DB
	core.DB = db
	t.Cleanup(func() {
		core.DB = old
		_ = db.Close()
	})
}

func TestHistoryUpsertAccumulatesPlayCount(t *testing.T) {
	setupHistoryDB(t)
	s := &HistoryService{}
	ctx := context.Background()

	input := HistoryUpsertInput{
		MediaKey:  "bili:BV1xx",
		Kind:      HistoryKindBilibili,
		Title:     "第一集",
		SourceURL: "https://www.bilibili.com/video/BV1xx",
		Duration:  120,
	}

	first := s.Upsert(input)
	if first.PlayCount != 1 {
		t.Fatalf("首次播放 playCount = %d, want 1", first.PlayCount)
	}

	// 同一个媒体再次播放：playCount 必须继续累加
	second := s.Upsert(input)
	if second.PlayCount != 2 {
		t.Fatalf("重复播放 playCount = %d, want 2", second.PlayCount)
	}
	if second.SourceURL != input.SourceURL {
		t.Fatalf("sourceUrl = %q, want %q", second.SourceURL, input.SourceURL)
	}

	// 进度写入后再播放，不能被元信息上报重置
	if err := q().UpdateHistoryPosition(ctx, userdb.UpdateHistoryPositionParams{
		Position: 42,
		Duration: 120,
		MediaKey: input.MediaKey,
	}); err != nil {
		t.Fatalf("update position: %v", err)
	}
	third := s.Upsert(input)
	if third.PlayCount != 3 || third.Position != 42 {
		t.Fatalf("播放后 playCount=%d position=%v, want 3/42", third.PlayCount, third.Position)
	}
}

func TestTrimHistoryKeepsNewestEntries(t *testing.T) {
	setupHistoryDB(t)
	ctx := context.Background()

	base := time.Now().Add(-time.Duration(maxHistoryEntries+20) * time.Minute)
	for i := 0; i < maxHistoryEntries+20; i++ {
		stamp := base.Add(time.Duration(i) * time.Minute).Format("2006-01-02 15:04:05")
		if _, err := core.DB.Exec(
			`INSERT INTO play_history (media_key, kind, last_played_at) VALUES (?, 'local', ?)`,
			fmt.Sprintf("m-%03d", i), stamp,
		); err != nil {
			t.Fatalf("insert history %d: %v", i, err)
		}
	}

	if err := q().TrimHistory(ctx, maxHistoryEntries); err != nil {
		t.Fatalf("trim history: %v", err)
	}

	var count int
	if err := core.DB.QueryRow(`SELECT COUNT(*) FROM play_history`).Scan(&count); err != nil {
		t.Fatalf("count history: %v", err)
	}
	if count != maxHistoryEntries {
		t.Fatalf("裁剪后条数 = %d, want %d", count, maxHistoryEntries)
	}

	s := &HistoryService{}
	if got := s.Get("m-000"); got.MediaKey != "" {
		t.Fatalf("最旧条目应被裁掉，实际保留: %+v", got)
	}
	if got := s.Get(fmt.Sprintf("m-%03d", maxHistoryEntries+19)); got.MediaKey == "" {
		t.Fatal("最新条目不应被裁掉")
	}
}

func TestHistoryTrimOnlyRunsPeriodically(t *testing.T) {
	s := &HistoryService{}
	runs := 0
	for i := 0; i < historyTrimInterval*2; i++ {
		if s.trimDue() {
			runs++
		}
	}
	if runs != 2 {
		t.Fatalf("trim 次数 = %d, want 2", runs)
	}
}
