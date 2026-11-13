package content

import (
	"aling-go/internal/core"
)

func dbGetCategories() []ArticleCategory {
	rows, err := core.ArticleDB.Query("SELECT id, en_name, name, description, cover, length FROM categories ORDER BY id")
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
	rows, err := core.ArticleDB.Query(
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
	err := core.ArticleDB.QueryRow(
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

func dbGetTypingProgress(articleID int, mode string) *TypingProgress {
	var p TypingProgress
	err := core.DB.QueryRow(
		`SELECT article_id, mode, position, completed, best_accuracy, best_wpm, updated_at
		 FROM typing_progress WHERE article_id=? AND mode=?`,
		articleID, mode,
	).Scan(&p.ArticleID, &p.Mode, &p.Position, &p.Completed, &p.BestAccuracy, &p.BestWPM, &p.UpdatedAt)
	if err != nil {
		return nil
	}
	return &p
}

func dbSaveTypingProgress(p TypingProgress) {
	_, _ = core.DB.Exec(
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

func dbGetTypingRecords(articleID int) []TypingRecord {
	rows, err := core.DB.Query(
		`SELECT id, article_id, mode, accuracy, wpm, duration, mistakes, created_at
		 FROM typing_records WHERE article_id=? ORDER BY created_at DESC`,
		articleID,
	)
	if err != nil {
		return []TypingRecord{}
	}
	defer rows.Close()
	records := make([]TypingRecord, 0)
	for rows.Next() {
		var r TypingRecord
		if err := rows.Scan(&r.ID, &r.ArticleID, &r.Mode, &r.Accuracy, &r.WPM, &r.Duration, &r.Mistakes, &r.CreatedAt); err != nil {
			continue
		}
		records = append(records, r)
	}
	return records
}

func dbSaveTypingRecord(r TypingRecord) {
	_, _ = core.DB.Exec(
		`INSERT INTO typing_records (article_id, mode, accuracy, wpm, duration, mistakes) VALUES (?, ?, ?, ?, ?, ?)`,
		r.ArticleID, r.Mode, r.Accuracy, r.WPM, r.Duration, r.Mistakes,
	)
}

func dbGetAllTypingProgress() []TypingProgress {
	rows, err := core.DB.Query(`SELECT article_id, mode, position, completed, best_accuracy, best_wpm, updated_at FROM typing_progress`)
	if err != nil {
		return []TypingProgress{}
	}
	defer rows.Close()
	results := make([]TypingProgress, 0)
	for rows.Next() {
		var p TypingProgress
		if err := rows.Scan(&p.ArticleID, &p.Mode, &p.Position, &p.Completed, &p.BestAccuracy, &p.BestWPM, &p.UpdatedAt); err != nil {
			continue
		}
		results = append(results, p)
	}
	return results
}
