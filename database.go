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
