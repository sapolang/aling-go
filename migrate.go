package main

import (
	"database/sql"
	"os"
	"path/filepath"
	goRuntime "runtime"
)

func (a *App) migrateIfNeeded() {
	migrateFlag := filepath.Join(a.dataDir, ".migrated")
	if _, err := os.Stat(migrateFlag); err == nil {
		return
	}

	oldDBPath := a.findOldDatabase()
	if oldDBPath == "" {
		os.WriteFile(migrateFlag, []byte("skipped"), 0644)
		return
	}

	oldDB, err := sql.Open("sqlite", oldDBPath)
	if err != nil {
		return
	}
	defer oldDB.Close()

	rows, err := oldDB.Query("SELECT * FROM words")
	if err == nil {
		for rows.Next() {
			var w Word
			rows.Scan(&w.ID, &w.Word, &w.Definition, &w.Phonetic, &w.Example,
				&w.Tags, &w.Level, &w.NextReview, &w.CreatedAt, &w.UpdatedAt)
			db.Exec(
				"INSERT OR IGNORE INTO words (word, definition, phonetic, example, tags, level, next_review, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
				w.Word, w.Definition, w.Phonetic, w.Example, w.Tags, w.Level, w.NextReview, w.CreatedAt, w.UpdatedAt,
			)
		}
		rows.Close()
	}

	rows, err = oldDB.Query("SELECT * FROM tags")
	if err == nil {
		for rows.Next() {
			var t Tag
			rows.Scan(&t.ID, &t.Name, &t.Color)
			db.Exec("INSERT OR IGNORE INTO tags (name, color) VALUES (?,?)", t.Name, t.Color)
		}
		rows.Close()
	}

	oldDB.Close()
	os.WriteFile(migrateFlag, []byte("done"), 0644)
}

func (a *App) findOldDatabase() string {
	home, _ := os.UserHomeDir()
	if goRuntime.GOOS == "darwin" {
		paths := []string{
			filepath.Join(home, "Library", "Application Support", "aling", "userData.db"),
			filepath.Join(home, "Library", "Application Support", "aling-go", "userData.db"),
		}
		for _, p := range paths {
			if _, err := os.Stat(p); err == nil {
				return p
			}
		}
	}
	return ""
}
