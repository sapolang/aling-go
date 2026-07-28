package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

var articleDB *sql.DB

func openArticleDB(dataDir string) error {
	paths := []string{
		filepath.Join(dataDir, "articles.db"),
		"articles.db",
	}
	if cwd, err := os.Getwd(); err == nil {
		paths = append(paths, filepath.Join(cwd, "articles.db"))
	}
	exe, _ := os.Executable()
	if exe != "" {
		exeDir := filepath.Dir(exe)
		paths = append(paths, filepath.Join(exeDir, "articles.db"))
		paths = append(paths, filepath.Join(exeDir, "..", "Resources", "articles.db"))
	}
	var dbPath string
	for _, p := range paths {
		if _, err := os.Stat(p); err == nil {
			dbPath = p
			break
		}
	}
	if dbPath == "" {
		return fmt.Errorf("articles.db not found in any search path")
	}
	var err error
	articleDB, err = sql.Open("sqlite", dbPath)
	if err != nil {
		return err
	}
	return articleDB.Ping()
}

func dbGetCategories() []ArticleCategory {
	rows, err := articleDB.Query("SELECT id, en_name, name, description, cover, length FROM categories ORDER BY id")
	if err != nil {
		return []ArticleCategory{}
	}
	defer rows.Close()
	var cats []ArticleCategory
	for rows.Next() {
		var c ArticleCategory
		if err := rows.Scan(&c.ID, &c.EnName, &c.Name, &c.Description, &c.Cover, &c.Length); err != nil {
			continue
		}
		cats = append(cats, c)
	}
	return cats
}

func dbGetArticles(categoryEnName string) []ArticleItem {
	rows, err := articleDB.Query(
		`SELECT id, category_en_name, title, title_translate, text, text_translate,
		        audio_src, lrc_position, question_json, index_order
		 FROM articles WHERE category_en_name=? ORDER BY index_order`,
		categoryEnName,
	)
	if err != nil {
		return []ArticleItem{}
	}
	defer rows.Close()
	var items []ArticleItem
	for rows.Next() {
		var a ArticleItem
		if err := rows.Scan(&a.ID, &a.CategoryEnName, &a.Title, &a.TitleTranslate,
			&a.Text, &a.TextTranslate, &a.AudioSrc, &a.LrcPosition, &a.QuestionJSON, &a.IndexOrder); err != nil {
			continue
		}
		items = append(items, a)
	}
	return items
}

func dbGetArticle(id int) *ArticleItem {
	var a ArticleItem
	err := articleDB.QueryRow(
		`SELECT id, category_en_name, title, title_translate, text, text_translate,
		        audio_src, lrc_position, question_json, index_order
		 FROM articles WHERE id=?`, id,
	).Scan(&a.ID, &a.CategoryEnName, &a.Title, &a.TitleTranslate,
		&a.Text, &a.TextTranslate, &a.AudioSrc, &a.LrcPosition, &a.QuestionJSON, &a.IndexOrder)
	if err != nil {
		return nil
	}
	return &a
}

func dbGetTypingProgress(articleID int, mode string) string {
	var p TypingProgress
	err := db.QueryRow(
		`SELECT article_id, mode, position, completed, best_accuracy, best_wpm, updated_at
		 FROM typing_progress WHERE article_id=? AND mode=?`,
		articleID, mode,
	).Scan(&p.ArticleID, &p.Mode, &p.Position, &p.Completed, &p.BestAccuracy, &p.BestWPM, &p.UpdatedAt)
	if err != nil {
		return ""
	}
	b, _ := json.Marshal(p)
	return string(b)
}

func dbSaveTypingProgress(progressJSON string) {
	var p TypingProgress
	if err := json.Unmarshal([]byte(progressJSON), &p); err != nil {
		return
	}
	_, _ = db.Exec(
		`INSERT OR REPLACE INTO typing_progress (article_id, mode, position, completed, best_accuracy, best_wpm, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'))`,
		p.ArticleID, p.Mode, p.Position, boolToInt(p.Completed), p.BestAccuracy, p.BestWPM,
	)
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func dbGetTypingRecords(articleID int) string {
	rows, err := db.Query(
		`SELECT id, article_id, mode, accuracy, wpm, duration, mistakes, created_at
		 FROM typing_records WHERE article_id=? ORDER BY created_at DESC`,
		articleID,
	)
	if err != nil {
		return "[]"
	}
	defer rows.Close()
	var records []TypingRecord
	for rows.Next() {
		var r TypingRecord
		if err := rows.Scan(&r.ID, &r.ArticleID, &r.Mode, &r.Accuracy, &r.WPM, &r.Duration, &r.Mistakes, &r.CreatedAt); err != nil {
			continue
		}
		records = append(records, r)
	}
	b, _ := json.Marshal(records)
	return string(b)
}

func dbSaveTypingRecord(recordJSON string) {
	var r TypingRecord
	if err := json.Unmarshal([]byte(recordJSON), &r); err != nil {
		return
	}
	_, _ = db.Exec(
		`INSERT INTO typing_records (article_id, mode, accuracy, wpm, duration, mistakes) VALUES (?, ?, ?, ?, ?, ?)`,
		r.ArticleID, r.Mode, r.Accuracy, r.WPM, r.Duration, r.Mistakes,
	)
}

func dbGetAllTypingProgress() string {
	rows, err := db.Query(`SELECT article_id, mode, position, completed, best_accuracy, best_wpm, updated_at FROM typing_progress`)
	if err != nil {
		return "[]"
	}
	defer rows.Close()
	var results []TypingProgress
	for rows.Next() {
		var p TypingProgress
		if err := rows.Scan(&p.ArticleID, &p.Mode, &p.Position, &p.Completed, &p.BestAccuracy, &p.BestWPM, &p.UpdatedAt); err != nil {
			continue
		}
		results = append(results, p)
	}
	b, _ := json.Marshal(results)
	return string(b)
}

func dbAddWordsBatch(wordsJSON string) int {
	var words []Word
	if err := json.Unmarshal([]byte(wordsJSON), &words); err != nil {
		return 0
	}
	count := 0
	for _, w := range words {
		res, err := db.Exec(
			"INSERT OR IGNORE INTO words (word, definition, phonetic) VALUES (?, ?, ?)",
			w.Word, w.Definition, w.Phonetic,
		)
		if err != nil {
			continue
		}
		n, _ := res.RowsAffected()
		if n > 0 {
			count++
		}
	}
	return count
}
