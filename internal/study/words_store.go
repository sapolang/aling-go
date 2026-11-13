package study

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"aling-go/internal/core"
	"aling-go/internal/store/userdb"
)

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
		fmt.Fprintf(os.Stderr, "dbWordsUpdate: %v\n", err)
	}
}

func dbWordsDelete(id int) {
	if err := queries().DeleteWord(context.Background(), id); err != nil {
		fmt.Fprintf(os.Stderr, "dbWordsDelete: %v\n", err)
	}
}

func dbWordsDeleteBatch(ids []int) {
	if err := queries().DeleteWords(context.Background(), ids); err != nil {
		fmt.Fprintf(os.Stderr, "dbWordsDeleteBatch: %v\n", err)
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
		fmt.Fprintf(os.Stderr, "dbClear words: %v\n", err)
	}
	if err := queries().ClearTags(context.Background()); err != nil {
		fmt.Fprintf(os.Stderr, "dbClear tags: %v\n", err)
	}
}

// --- Review logs ---

func dbReviewLogAdd(wordID, quality int) {
	if err := queries().AddReviewLog(context.Background(), userdb.AddReviewLogParams{
		WordID:  int64(wordID),
		Quality: int64(quality),
	}); err != nil {
		fmt.Fprintf(os.Stderr, "dbReviewLogAdd: %v\n", err)
	}
}

func dbLearningStats() LearningStats {
	stats := LearningStats{Daily: make([]DailyReview, 0, 30)}
	q := queries()
	bg := context.Background()

	if total, err := q.CountReviews(bg); err == nil {
		stats.TotalReviews = int(total)
	} else {
		fmt.Fprintf(os.Stderr, "learningStats total: %v\n", err)
	}
	if today, err := q.CountTodayReviews(bg); err == nil {
		stats.TodayReviews = int(today)
	} else {
		fmt.Fprintf(os.Stderr, "learningStats today: %v\n", err)
	}
	if total, err := q.CountWords(bg); err == nil {
		stats.TotalWords = int(total)
	} else {
		fmt.Fprintf(os.Stderr, "learningStats words: %v\n", err)
	}
	if mastered, err := q.CountMasteredWords(bg); err == nil {
		stats.Mastered = int(mastered)
	} else {
		fmt.Fprintf(os.Stderr, "learningStats mastered: %v\n", err)
	}

	counts := make(map[string]int)
	if rows, err := q.DailyReviewCounts(bg); err != nil {
		fmt.Fprintf(os.Stderr, "learningStats daily: %v\n", err)
	} else {
		for _, r := range rows {
			counts[r.ReviewDate] = int(r.Count)
		}
	}

	// 连续天数不受 30 天图表窗口限制，单独统计全部复习日期
	streakDays := make(map[string]bool)
	if dates, err := q.ListReviewDates(bg); err != nil {
		fmt.Fprintf(os.Stderr, "learningStats streak: %v\n", err)
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
