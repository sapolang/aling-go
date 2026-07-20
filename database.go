package main

import (
	"database/sql"
	"encoding/json"
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
			updated_at TEXT DEFAULT (datetime('now','localtime'))
		);
		CREATE TABLE IF NOT EXISTS tags (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL UNIQUE,
			color TEXT NOT NULL DEFAULT '#3b82f6'
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
		"INSERT INTO words (word, definition, phonetic, example, tags, level, next_review) VALUES (?,?,?,?,?,?,?)",
		w.Word, w.Definition, w.Phonetic, w.Example, w.Tags, w.Level, w.NextReview,
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
	db.Exec(
		"UPDATE words SET word=?, definition=?, phonetic=?, example=?, tags=?, level=?, next_review=?, updated_at=datetime('now','localtime') WHERE id=?",
		data["word"], data["definition"], data["phonetic"], data["example"],
		data["tags"], data["level"], data["next_review"], id,
	)
}

func dbWordsDelete(id int) {
	db.Exec("DELETE FROM words WHERE id=?", id)
}

func dbWordsDeleteBatch(ids []int) {
	for _, id := range ids {
		db.Exec("DELETE FROM words WHERE id=?", id)
	}
}

func dbWordsGetReview() []Word {
	today := time.Now().Format("2006-01-02")
	rows, err := db.Query("SELECT * FROM words WHERE next_review <= ? ORDER BY next_review ASC LIMIT 20", today)
	if err != nil {
		return []Word{}
	}
	defer rows.Close()
	return scanWords(rows)
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
	db.Exec("DELETE FROM tags WHERE id=?", id)
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
	json.Unmarshal([]byte(jsonStr), &data)
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
			"INSERT OR IGNORE INTO words (word, definition, phonetic, example, tags, level, next_review) VALUES (?,?,?,?,?,?,?)",
			w.Word, w.Definition, w.Phonetic, w.Example, w.Tags, w.Level, w.NextReview,
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
	db.Exec("DELETE FROM words")
	db.Exec("DELETE FROM tags")
}

// --- Helpers ---

func scanWords(rows *sql.Rows) []Word {
	words := make([]Word, 0)
	for rows.Next() {
		var w Word
		rows.Scan(&w.ID, &w.Word, &w.Definition, &w.Phonetic, &w.Example,
			&w.Tags, &w.Level, &w.NextReview, &w.CreatedAt, &w.UpdatedAt)
		words = append(words, w)
	}
	return words
}

func scanTags(rows *sql.Rows) []Tag {
	tags := make([]Tag, 0)
	for rows.Next() {
		var t Tag
		rows.Scan(&t.ID, &t.Name, &t.Color)
		tags = append(tags, t)
	}
	return tags
}
