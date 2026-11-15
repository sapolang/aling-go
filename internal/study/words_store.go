package study

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"aling-go/internal/core"
	"aling-go/internal/store/userdb"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// logger 由各服务构造时注入应用日志器；测试等未注入场景退回默认日志器，
// 避免包级存储函数直接写 os.Stderr。
var logger = slog.Default()

func injectLogger(app *application.App) {
	if app != nil && app.Logger != nil {
		logger = app.Logger
	}
}

// queries 返回基于当前用户库句柄的类型安全查询集合。
// sqlc 生成代码只依赖 DBTX 接口，因此可以直接复用 core.DB。
func queries() *userdb.Queries {
	return userdb.New(core.DB)
}

// --- Words CRUD ---

func dbWordsList() []Word {
	rows, err := queries().ListWords(context.Background())
	if err != nil {
		return []Word{}
	}
	return toWords(rows)
}

func dbWordsAdd(w Word) int {
	id, err := queries().AddWord(context.Background(), userdb.AddWordParams{
		Word:        w.Word,
		Definition:  w.Definition,
		Phonetic:    w.Phonetic,
		Example:     w.Example,
		Tags:        w.Tags,
		Level:       w.Level,
		NextReview:  w.NextReview,
		Repetitions: w.Repetitions,
		Efactor:     w.EFactor,
		Interval:    w.Interval,
	})
	if err != nil {
		return 0
	}
	return id
}

func dbWordsUpdate(id int, w Word) {
	if err := queries().UpdateWord(context.Background(), userdb.UpdateWordParams{
		Word:        w.Word,
		Definition:  w.Definition,
		Phonetic:    w.Phonetic,
		Example:     w.Example,
		Tags:        w.Tags,
		Level:       w.Level,
		NextReview:  w.NextReview,
		Repetitions: w.Repetitions,
		Efactor:     w.EFactor,
		Interval:    w.Interval,
		ID:          id,
	}); err != nil {
		logger.Error("dbWordsUpdate", "id", id, "error", err)
	}
}

func dbWordsDelete(id int) {
	if err := queries().DeleteWord(context.Background(), id); err != nil {
		logger.Error("dbWordsDelete", "id", id, "error", err)
	}
}

func dbWordsDeleteBatch(ids []int) {
	if err := queries().DeleteWords(context.Background(), ids); err != nil {
		logger.Error("dbWordsDeleteBatch", "count", len(ids), "error", err)
	}
}

func dbWordsGetReview() []Word {
	today := time.Now().Format("2006-01-02")
	rows, err := queries().ListReviewWords(context.Background(), today)
	if err != nil {
		return []Word{}
	}
	return toWords(rows)
}

func dbWordsGetReviewCount() int {
	today := time.Now().Format("2006-01-02")
	count, err := queries().CountReviewWords(context.Background(), today)
	if err != nil {
		return 0
	}
	return int(count)
}

func dbWordsSearch(query string) []Word {
	like := "%" + query + "%"
	rows, err := queries().SearchWords(context.Background(), userdb.SearchWordsParams{
		Word:       like,
		Definition: like,
	})
	if err != nil {
		return []Word{}
	}
	return toWords(rows)
}

// --- Tags CRUD ---

func dbTagsList() []Tag {
	rows, err := queries().ListTags(context.Background())
	if err != nil {
		return []Tag{}
	}
	tags := make([]Tag, 0, len(rows))
	for _, t := range rows {
		tags = append(tags, Tag{ID: t.ID, Name: t.Name, Color: t.Color})
	}
	return tags
}

func dbTagsAdd(name, color string) int {
	id, err := queries().AddTag(context.Background(), userdb.AddTagParams{Name: name, Color: color})
	if err != nil {
		return 0
	}
	return id
}

func dbTagsDelete(id int) {
	if err := queries().DeleteTag(context.Background(), id); err != nil {
		logger.Error("dbTagsDelete", "id", id, "error", err)
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
		logger.Error("dbImport: unmarshal", "error", err)
		return ImportResult{}
	}
	result := ImportResult{}
	for _, t := range data.Tags {
		err := queries().ImportTag(context.Background(), userdb.ImportTagParams{Name: t.Name, Color: t.Color})
		if err == nil {
			result.Imported++
		} else {
			result.Skipped++
		}
	}
	for _, w := range data.Words {
		err := queries().ImportWord(context.Background(), userdb.ImportWordParams{
			Word:        w.Word,
			Definition:  w.Definition,
			Phonetic:    w.Phonetic,
			Example:     w.Example,
			Tags:        w.Tags,
			Level:       w.Level,
			NextReview:  w.NextReview,
			Repetitions: w.Repetitions,
			Efactor:     w.EFactor,
			Interval:    w.Interval,
		})
		if err == nil {
			result.Imported++
		} else {
			result.Skipped++
		}
	}
	return result
}

func dbClear() {
	if err := queries().ClearWords(context.Background()); err != nil {
		logger.Error("dbClear words", "error", err)
	}
	if err := queries().ClearTags(context.Background()); err != nil {
		logger.Error("dbClear tags", "error", err)
	}
}

// --- Review logs ---

func dbReviewLogAdd(wordID, quality int) {
	if err := queries().AddReviewLog(context.Background(), userdb.AddReviewLogParams{
		WordID:  int64(wordID),
		Quality: int64(quality),
	}); err != nil {
		logger.Error("dbReviewLogAdd", "wordId", wordID, "error", err)
	}
}

func dbLearningStats() LearningStats {
	stats := LearningStats{Daily: make([]DailyReview, 0, 30)}
	q := queries()
	bg := context.Background()

	if total, err := q.CountReviews(bg); err == nil {
		stats.TotalReviews = int(total)
	} else {
		logger.Error("learningStats total", "error", err)
	}
	if today, err := q.CountTodayReviews(bg); err == nil {
		stats.TodayReviews = int(today)
	} else {
		logger.Error("learningStats today", "error", err)
	}
	if total, err := q.CountWords(bg); err == nil {
		stats.TotalWords = int(total)
	} else {
		logger.Error("learningStats words", "error", err)
	}
	if mastered, err := q.CountMasteredWords(bg); err == nil {
		stats.Mastered = int(mastered)
	} else {
		logger.Error("learningStats mastered", "error", err)
	}

	counts := make(map[string]int)
	if rows, err := q.DailyReviewCounts(bg); err != nil {
		logger.Error("learningStats daily", "error", err)
	} else {
		for _, r := range rows {
			counts[r.ReviewDate] = int(r.Count)
		}
	}

	// 连续天数不受 30 天图表窗口限制，单独统计全部复习日期
	streakDays := make(map[string]bool)
	if dates, err := q.ListReviewDates(bg); err != nil {
		logger.Error("learningStats streak", "error", err)
	} else {
		for _, d := range dates {
			streakDays[d] = true
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

	return stats
}

// dbAddWordsBatch 供文章页等场景批量快速加入生词（只写词/释义/音标）。
func dbAddWordsBatch(words []Word) int {
	count := 0
	for _, w := range words {
		n, err := queries().AddWordsBatch(context.Background(), userdb.AddWordsBatchParams{
			Word:       w.Word,
			Definition: w.Definition,
			Phonetic:   w.Phonetic,
		})
		if err != nil {
			continue
		}
		count += int(n)
	}
	return count
}

// --- Helpers ---

func toWords(rows []userdb.Word) []Word {
	words := make([]Word, 0, len(rows))
	for _, w := range rows {
		words = append(words, Word{
			ID:          w.ID,
			Word:        w.Word,
			Definition:  w.Definition,
			Phonetic:    w.Phonetic,
			Example:     w.Example,
			Tags:        w.Tags,
			Level:       w.Level,
			NextReview:  w.NextReview,
			CreatedAt:   w.CreatedAt,
			UpdatedAt:   w.UpdatedAt,
			Repetitions: w.Repetitions,
			EFactor:     w.Efactor,
			Interval:    w.Interval,
		})
	}
	return words
}
