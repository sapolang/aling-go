package content

import (
	"context"

	"aling-go/internal/core"
	"aling-go/internal/store/userdb"
)

// q 返回基于当前用户库句柄的类型安全查询集合。
func q() *userdb.Queries {
	return userdb.New(core.DB)
}

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
	row, err := q().GetTypingProgress(context.Background(), userdb.GetTypingProgressParams{
		ArticleID: articleID,
		Mode:      mode,
	})
	if err != nil {
		return nil
	}
	return &TypingProgress{
		ArticleID:    row.ArticleID,
		Mode:         row.Mode,
		Position:     row.Position,
		Completed:    row.Completed != 0,
		BestAccuracy: row.BestAccuracy,
		BestWPM:      row.BestWpm,
		UpdatedAt:    row.UpdatedAt,
	}
}

func dbSaveTypingProgress(p TypingProgress) {
	_ = q().SaveTypingProgress(context.Background(), userdb.SaveTypingProgressParams{
		ArticleID:    p.ArticleID,
		Mode:         p.Mode,
		Position:     p.Position,
		Completed:    boolToInt(p.Completed),
		BestAccuracy: p.BestAccuracy,
		BestWpm:      p.BestWPM,
	})
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func dbGetTypingRecords(articleID int) []TypingRecord {
	rows, err := q().ListTypingRecords(context.Background(), articleID)
	if err != nil {
		return []TypingRecord{}
	}
	records := make([]TypingRecord, 0, len(rows))
	for _, row := range rows {
		records = append(records, TypingRecord{
			ID:        row.ID,
			ArticleID: row.ArticleID,
			Mode:      row.Mode,
			Accuracy:  row.Accuracy,
			WPM:       row.Wpm,
			Duration:  row.Duration,
			Mistakes:  row.Mistakes,
			CreatedAt: row.CreatedAt,
		})
	}
	return records
}

func dbSaveTypingRecord(r TypingRecord) {
	_ = q().AddTypingRecord(context.Background(), userdb.AddTypingRecordParams{
		ArticleID: r.ArticleID,
		Mode:      r.Mode,
		Accuracy:  r.Accuracy,
		Wpm:       r.WPM,
		Duration:  r.Duration,
		Mistakes:  r.Mistakes,
	})
}

func dbGetAllTypingProgress() []TypingProgress {
	rows, err := q().ListAllTypingProgress(context.Background())
	if err != nil {
		return []TypingProgress{}
	}
	results := make([]TypingProgress, 0, len(rows))
	for _, row := range rows {
		results = append(results, TypingProgress{
			ArticleID:    row.ArticleID,
			Mode:         row.Mode,
			Position:     row.Position,
			Completed:    row.Completed != 0,
			BestAccuracy: row.BestAccuracy,
			BestWPM:      row.BestWpm,
			UpdatedAt:    row.UpdatedAt,
		})
	}
	return results
}
