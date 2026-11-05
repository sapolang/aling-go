package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

var db *sql.DB

func initDB(dataDir string) error {
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return err
	}
	dbPath := filepath.Join(dataDir, "userData.db")
	var err error
	db, err = sql.Open("sqlite", dbPath)
	if err != nil {
		return err
	}
	return createTables()
}

func createTables() error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS words (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			word TEXT NOT NULL,
			definition TEXT DEFAULT '',
			phonetic TEXT DEFAULT '',
			example TEXT DEFAULT '',
			tags TEXT DEFAULT '',
			level INTEGER DEFAULT 1,
			next_review TEXT DEFAULT (date('now')),
			created_at TEXT DEFAULT (datetime('now','localtime')),
			updated_at TEXT DEFAULT (datetime('now','localtime')),
			repetitions INTEGER DEFAULT 0,
			efactor REAL DEFAULT 2.5,
			interval INTEGER DEFAULT 0
		);
		CREATE TABLE IF NOT EXISTS tags (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL UNIQUE,
			color TEXT NOT NULL DEFAULT '#3b82f6'
		);
		CREATE TABLE IF NOT EXISTS typing_records (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			article_id INTEGER NOT NULL,
			mode TEXT NOT NULL,
			accuracy REAL DEFAULT 0,
			wpm REAL DEFAULT 0,
			duration INTEGER DEFAULT 0,
			mistakes TEXT DEFAULT '[]',
			created_at TEXT DEFAULT (datetime('now','localtime'))
		);
		CREATE TABLE IF NOT EXISTS typing_progress (
			article_id INTEGER NOT NULL,
			mode TEXT NOT NULL,
			position INTEGER DEFAULT 0,
			completed INTEGER DEFAULT 0,
			best_accuracy REAL DEFAULT 0,
			best_wpm REAL DEFAULT 0,
			updated_at TEXT DEFAULT (datetime('now','localtime')),
			PRIMARY KEY (article_id, mode)
		);
		CREATE TABLE IF NOT EXISTS review_logs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			word_id INTEGER NOT NULL,
			quality INTEGER NOT NULL,
			reviewed_at TEXT DEFAULT (datetime('now','localtime'))
		);
		CREATE INDEX IF NOT EXISTS idx_review_logs_reviewed_at ON review_logs(reviewed_at);
	`)
	return err
}

// --- Words CRUD ---

func dbWordsList() []Word {
	rows, err := db.Query("SELECT * FROM words ORDER BY created_at DESC")
	if err != nil {
		return []Word{}
	}
	defer rows.Close()
	return scanWords(rows)
}

func dbWordsAdd(wordJSON string) int {
	var w Word
	if err := json.Unmarshal([]byte(wordJSON), &w); err != nil {
		return 0
	}
	res, err := db.Exec(
		"INSERT INTO words (word, definition, phonetic, example, tags, level, next_review, repetitions, efactor, interval) VALUES (?,?,?,?,?,?,?,?,?,?)",
		w.Word, w.Definition, w.Phonetic, w.Example, w.Tags, w.Level, w.NextReview, w.Repetitions, w.EFactor, w.Interval,
	)
	if err != nil {
		return 0
	}
	id, _ := res.LastInsertId()
	return int(id)
}

func dbWordsUpdate(id int, dataJSON string) {
	var data map[string]interface{}
	if err := json.Unmarshal([]byte(dataJSON), &data); err != nil {
		return
	}
	if _, err := db.Exec(
		"UPDATE words SET word=?, definition=?, phonetic=?, example=?, tags=?, level=?, next_review=?, repetitions=?, efactor=?, interval=?, updated_at=datetime('now','localtime') WHERE id=?",
		data["word"], data["definition"], data["phonetic"], data["example"],
		data["tags"], data["level"], data["next_review"],
		data["repetitions"], data["efactor"], data["interval"], id,
	); err != nil {
		fmt.Fprintf(os.Stderr, "dbWordsUpdate: %v\n", err)
	}
}

func dbWordsDelete(id int) {
	if _, err := db.Exec("DELETE FROM words WHERE id=?", id); err != nil {
		fmt.Fprintf(os.Stderr, "dbWordsDelete: %v\n", err)
	}
}

func dbWordsDeleteBatch(ids []int) {
	for _, id := range ids {
		if _, err := db.Exec("DELETE FROM words WHERE id=?", id); err != nil {
			fmt.Fprintf(os.Stderr, "dbWordsDeleteBatch id=%d: %v\n", id, err)
		}
	}
}

func dbWordsGetReview() []Word {
	today := time.Now().Format("2006-01-02")
	rows, err := db.Query("SELECT * FROM words WHERE next_review <= ? ORDER BY next_review ASC", today)
	if err != nil {
		return []Word{}
	}
	defer rows.Close()
	return scanWords(rows)
}

func dbWordsGetReviewCount() int {
	today := time.Now().Format("2006-01-02")
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM words WHERE next_review <= ?", today).Scan(&count); err != nil {
		return 0
	}
	return count
}

func dbWordsSearch(query string) []Word {
	like := "%" + query + "%"
	rows, err := db.Query("SELECT * FROM words WHERE word LIKE ? OR definition LIKE ? ORDER BY word ASC", like, like)
	if err != nil {
		return []Word{}
	}
	defer rows.Close()
	return scanWords(rows)
}

// --- Tags CRUD ---

func dbTagsList() []Tag {
	rows, err := db.Query("SELECT * FROM tags ORDER BY name ASC")
	if err != nil {
		return []Tag{}
	}
	defer rows.Close()
	return scanTags(rows)
}

func dbTagsAdd(name, color string) int {
	res, err := db.Exec("INSERT INTO tags (name, color) VALUES (?,?)", name, color)
	if err != nil {
		return 0
	}
	id, _ := res.LastInsertId()
	return int(id)
}

func dbTagsDelete(id int) {
	if _, err := db.Exec("DELETE FROM tags WHERE id=?", id); err != nil {
		fmt.Fprintf(os.Stderr, "dbTagsDelete: %v\n", err)
	}
}

// --- Export / Import / Clear ---

func dbExport() string {
	words := dbWordsList()
	tags := dbTagsList()
	data := map[string]interface{}{"words": words, "tags": tags}
	b, _ := json.Marshal(data)
	return string(b)
}

func dbImport(jsonStr string) ImportResult {
	var data struct {
		Words []Word `json:"words"`
		Tags  []Tag  `json:"tags"`
	}
	if err := json.Unmarshal([]byte(jsonStr), &data); err != nil {
		fmt.Fprintf(os.Stderr, "dbImport: unmarshal error: %v\n", err)
		return ImportResult{}
	}
	result := ImportResult{}
	for _, t := range data.Tags {
		_, err := db.Exec("INSERT OR IGNORE INTO tags (name, color) VALUES (?,?)", t.Name, t.Color)
		if err == nil {
			result.Imported++
		} else {
			result.Skipped++
		}
	}
	for _, w := range data.Words {
		_, err := db.Exec(
			"INSERT OR IGNORE INTO words (word, definition, phonetic, example, tags, level, next_review, repetitions, efactor, interval) VALUES (?,?,?,?,?,?,?,?,?,?)",
			w.Word, w.Definition, w.Phonetic, w.Example, w.Tags, w.Level, w.NextReview, w.Repetitions, w.EFactor, w.Interval,
		)
		if err == nil {
			result.Imported++
		} else {
			result.Skipped++
		}
	}
	return result
}

func dbClear() {
	if _, err := db.Exec("DELETE FROM words"); err != nil {
		fmt.Fprintf(os.Stderr, "dbClear words: %v\n", err)
	}
	if _, err := db.Exec("DELETE FROM tags"); err != nil {
		fmt.Fprintf(os.Stderr, "dbClear tags: %v\n", err)
	}
}

// --- Review logs ---

func dbReviewLogAdd(wordID, quality int) {
	if _, err := db.Exec("INSERT INTO review_logs (word_id, quality) VALUES (?, ?)", wordID, quality); err != nil {
		fmt.Fprintf(os.Stderr, "dbReviewLogAdd: %v\n", err)
	}
}

func dbLearningStats() string {
	stats := LearningStats{Daily: make([]DailyReview, 0, 30)}
	if err := db.QueryRow("SELECT COUNT(*) FROM review_logs").Scan(&stats.TotalReviews); err != nil {
		fmt.Fprintf(os.Stderr, "learningStats total: %v\n", err)
	}
	if err := db.QueryRow("SELECT COUNT(*) FROM review_logs WHERE substr(reviewed_at, 1, 10) = date('now','localtime')").Scan(&stats.TodayReviews); err != nil {
		fmt.Fprintf(os.Stderr, "learningStats today: %v\n", err)
	}
	if err := db.QueryRow("SELECT COUNT(*) FROM words").Scan(&stats.TotalWords); err != nil {
		fmt.Fprintf(os.Stderr, "learningStats words: %v\n", err)
	}
	if err := db.QueryRow("SELECT COUNT(*) FROM words WHERE repetitions >= 3").Scan(&stats.Mastered); err != nil {
		fmt.Fprintf(os.Stderr, "learningStats mastered: %v\n", err)
	}

	counts := make(map[string]int)
	rows, err := db.Query("SELECT substr(reviewed_at, 1, 10) AS d, COUNT(*) FROM review_logs WHERE substr(reviewed_at, 1, 10) >= date('now','localtime','-29 days') GROUP BY d")
	if err != nil {
		fmt.Fprintf(os.Stderr, "learningStats daily: %v\n", err)
	} else {
		defer rows.Close()
		for rows.Next() {
			var date string
			var count int
			if rows.Scan(&date, &count) == nil {
				counts[date] = count
			}
		}
	}

	// 连续天数不受 30 天图表窗口限制，单独统计全部复习日期
	streakDays := make(map[string]bool)
	srows, sErr := db.Query("SELECT DISTINCT substr(reviewed_at, 1, 10) FROM review_logs")
	if sErr != nil {
		fmt.Fprintf(os.Stderr, "learningStats streak: %v\n", sErr)
	} else {
		defer srows.Close()
		for srows.Next() {
			var date string
			if srows.Scan(&date) == nil {
				streakDays[date] = true
			}
		}
	}

	now := time.Now()
	today := now.Format("2006-01-02")
	start := 0
	if !streakDays[today] {
		start = 1
	}
	for i := start; ; i++ {
		if !streakDays[now.AddDate(0, 0, -i).Format("2006-01-02")] {
			break
		}
		stats.Streak++
	}

	for i := 29; i >= 0; i-- {
		date := now.AddDate(0, 0, -i).Format("2006-01-02")
		stats.Daily = append(stats.Daily, DailyReview{Date: date, Count: counts[date]})
	}

	data, err := json.Marshal(stats)
	if err != nil {
		fmt.Fprintf(os.Stderr, "learningStats marshal: %v\n", err)
		return "{}"
	}
	return string(data)
}

// --- Helpers ---

func scanWords(rows *sql.Rows) []Word {
	words := make([]Word, 0)
	for rows.Next() {
		var w Word
		if err := rows.Scan(&w.ID, &w.Word, &w.Definition, &w.Phonetic, &w.Example,
			&w.Tags, &w.Level, &w.NextReview, &w.CreatedAt, &w.UpdatedAt,
			&w.Repetitions, &w.EFactor, &w.Interval); err != nil {
			continue
		}
		words = append(words, w)
	}
	return words
}

func scanTags(rows *sql.Rows) []Tag {
	tags := make([]Tag, 0)
	for rows.Next() {
		var t Tag
		if err := rows.Scan(&t.ID, &t.Name, &t.Color); err != nil {
			continue
		}
		tags = append(tags, t)
	}
	return tags
}
