package study

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"
	"time"

	"aling-go/internal/core"
)

// setupTestDB 在临时目录创建用户库并注入 core.DB，验证 sqlc 试点模块的读写行为。
func setupTestDB(t *testing.T) {
	t.Helper()
	schema, err := os.ReadFile("../core/schema.sql")
	if err != nil {
		t.Fatalf("read schema: %v", err)
	}
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "userData.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if _, err := db.Exec(string(schema)); err != nil {
		t.Fatalf("create schema: %v", err)
	}
	old := core.DB
	core.DB = db
	t.Cleanup(func() {
		core.DB = old
		_ = db.Close()
	})
}

func TestWordsCRUD(t *testing.T) {
	setupTestDB(t)

	id := dbWordsAdd(Word{Word: "ephemeral", Definition: "短暂的", Phonetic: "/ɪˈfemərəl/", EFactor: 2.5})
	if id == 0 {
		t.Fatal("dbWordsAdd returned 0")
	}

	words := dbWordsList()
	if len(words) != 1 || words[0].Word != "ephemeral" {
		t.Fatalf("dbWordsList = %+v", words)
	}
	if words[0].CreatedAt == "" || words[0].EFactor != 2.5 {
		t.Fatalf("db defaults not applied: %+v", words[0])
	}

	dbWordsUpdate(id, Word{Word: "ephemeral", Definition: "转瞬即逝的", Level: 3, EFactor: 2.6, NextReview: "2026-01-01"})
	words = dbWordsList()
	if words[0].Definition != "转瞬即逝的" || words[0].Level != 3 || words[0].EFactor != 2.6 {
		t.Fatalf("update not persisted: %+v", words[0])
	}

	if got := dbWordsSearch("转瞬"); len(got) != 1 {
		t.Fatalf("dbWordsSearch = %+v", got)
	}

	dbWordsDelete(id)
	if got := dbWordsList(); len(got) != 0 {
		t.Fatalf("dbWordsDelete failed: %+v", got)
	}
}

func TestWordsReviewAndBatchDelete(t *testing.T) {
	setupTestDB(t)

	today := time.Now().Format("2006-01-02")
	tomorrow := time.Now().AddDate(0, 0, 1).Format("2006-01-02")
	dueID := dbWordsAdd(Word{Word: "due", NextReview: today, EFactor: 2.5})
	futureID := dbWordsAdd(Word{Word: "future", NextReview: tomorrow, EFactor: 2.5})

	if got := dbWordsGetReviewCount(); got != 1 {
		t.Fatalf("dbWordsGetReviewCount = %d, want 1", got)
	}
	review := dbWordsGetReview()
	if len(review) != 1 || review[0].Word != "due" {
		t.Fatalf("dbWordsGetReview = %+v", review)
	}

	dbWordsDeleteBatch([]int{dueID, futureID})
	if got := dbWordsList(); len(got) != 0 {
		t.Fatalf("dbWordsDeleteBatch failed: %+v", got)
	}
}

func TestTagsAndImportExport(t *testing.T) {
	setupTestDB(t)

	tagID := dbTagsAdd("CET4", "#3b82f6")
	if tagID == 0 {
		t.Fatal("dbTagsAdd returned 0")
	}
	tags := dbTagsList()
	if len(tags) != 1 || tags[0].Name != "CET4" {
		t.Fatalf("dbTagsList = %+v", tags)
	}

	dbWordsAdd(Word{Word: "abandon", Definition: "放弃", Tags: "CET4", EFactor: 2.5})
	exported := dbExport()
	if exported == "" {
		t.Fatal("dbExport returned empty")
	}

	dbClear()
	if len(dbWordsList()) != 0 || len(dbTagsList()) != 0 {
		t.Fatal("dbClear did not empty tables")
	}

	result := dbImport(exported)
	if result.Imported == 0 {
		t.Fatalf("dbImport = %+v", result)
	}
	if got := dbWordsList(); len(got) != 1 || got[0].Word != "abandon" || got[0].Definition != "放弃" {
		t.Fatalf("import roundtrip = %+v", got)
	}
	if got := dbTagsList(); len(got) != 1 || got[0].Name != "CET4" {
		t.Fatalf("import tags = %+v", got)
	}
}

func TestLearningStats(t *testing.T) {
	setupTestDB(t)

	wordID := dbWordsAdd(Word{Word: "persist", EFactor: 2.5})
	dbWordsAdd(Word{Word: "mastered", Repetitions: 3, EFactor: 2.5})
	dbReviewLogAdd(wordID, 4)
	dbReviewLogAdd(wordID, 5)

	stats := dbLearningStats()
	if stats.TotalReviews != 2 || stats.TodayReviews != 2 {
		t.Fatalf("review counts = %+v", stats)
	}
	if stats.TotalWords != 2 || stats.Mastered != 1 {
		t.Fatalf("word counts = %+v", stats)
	}
	if stats.Streak != 1 {
		t.Fatalf("streak = %d, want 1", stats.Streak)
	}
	if len(stats.Daily) != 30 {
		t.Fatalf("daily len = %d, want 30", len(stats.Daily))
	}
	last := stats.Daily[len(stats.Daily)-1]
	if last.Date != time.Now().Format("2006-01-02") || last.Count != 2 {
		t.Fatalf("today daily = %+v", last)
	}
}

func TestAddWordsBatch(t *testing.T) {
	setupTestDB(t)

	added := dbAddWordsBatch([]Word{
		{Word: "alpha", Definition: "第一个"},
		{Word: "beta", Phonetic: "/ˈbiːtə/"},
	})
	if added != 2 {
		t.Fatalf("dbAddWordsBatch = %d, want 2", added)
	}
	if got := dbWordsList(); len(got) != 2 {
		t.Fatalf("dbWordsList len = %d, want 2", len(got))
	}
}
