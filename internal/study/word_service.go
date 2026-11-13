package study

import (
	"context"
	"fmt"
	"os"

	"aling-go/internal/core"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type WordService struct {
	app *application.App
}

func NewWordService(app *application.App) *WordService {
	return &WordService{app: app}
}

func (s *WordService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	return nil
}
func (s *WordService) ServiceShutdown() error { return nil }

// --- Words ---

func (s *WordService) DbWordsList() []Word {
	return dbWordsList()
}

func (s *WordService) DbWordsAdd(word Word) int {
	return dbWordsAdd(word)
}

func (s *WordService) DbWordsUpdate(id int, data Word) {
	dbWordsUpdate(id, data)
}

func (s *WordService) DbWordsDelete(id int) {
	dbWordsDelete(id)
}

func (s *WordService) DbWordsDeleteBatch(ids []int) {
	dbWordsDeleteBatch(ids)
}

func (s *WordService) DbWordsGetReview() []Word {
	return dbWordsGetReview()
}

func (s *WordService) DbWordsGetReviewCount() int {
	return dbWordsGetReviewCount()
}

func (s *WordService) DbWordsSearch(query string) []Word {
	return dbWordsSearch(query)
}

// --- Review logs / stats ---

func (s *WordService) LogReview(wordID int, quality int) {
	dbReviewLogAdd(wordID, quality)
}

func (s *WordService) GetLearningStats() LearningStats {
	return dbLearningStats()
}

// GradeCount 表示某个复习评分出现的次数。
type GradeCount struct {
	Grade int `json:"grade"`
	Count int `json:"count"`
}

// LevelCount 表示某个掌握等级的生词数量。
type LevelCount struct {
	Level int `json:"level"`
	Count int `json:"count"`
}

// TypingDayStat 表示某一天的打字练习聚合数据。
type TypingDayStat struct {
	Date          string  `json:"date"`
	Count         int     `json:"count"`
	AvgAccuracy   float64 `json:"avgAccuracy"`
	AvgWPM        float64 `json:"avgWpm"`
	TotalDuration int     `json:"totalDuration"`
}

// ExtendedStats 是统计页的多维度扩展统计结果。
type ExtendedStats struct {
	GradeDistribution []GradeCount    `json:"gradeDistribution"`
	LevelDistribution []LevelCount    `json:"levelDistribution"`
	TypingDaily       []TypingDayStat `json:"typingDaily"`
}

// GetExtendedStats 返回统计页的多维度扩展统计：
// 复习评分分布、生词等级分布、最近 30 天打字练习趋势。
func (s *WordService) GetExtendedStats() ExtendedStats {
	return ExtendedStats{
		GradeDistribution: queryGradeDistribution(),
		LevelDistribution: queryLevelDistribution(),
		TypingDaily:       queryTypingDailyStats(),
	}
}

// queryGradeDistribution 按评分聚合 review_logs，返回各评分的复习次数。
func queryGradeDistribution() []GradeCount {
	result := make([]GradeCount, 0)
	rows, err := core.DB.Query("SELECT quality, COUNT(*) FROM review_logs GROUP BY quality ORDER BY quality")
	if err != nil {
		fmt.Fprintf(os.Stderr, "extendedStats grades: %v\n", err)
		return result
	}
	defer rows.Close()
	for rows.Next() {
		var g GradeCount
		if rows.Scan(&g.Grade, &g.Count) == nil {
			result = append(result, g)
		}
	}
	return result
}

// queryLevelDistribution 按等级聚合 words 表，返回各等级的生词数量。
func queryLevelDistribution() []LevelCount {
	result := make([]LevelCount, 0)
	rows, err := core.DB.Query("SELECT level, COUNT(*) FROM words GROUP BY level ORDER BY level")
	if err != nil {
		fmt.Fprintf(os.Stderr, "extendedStats levels: %v\n", err)
		return result
	}
	defer rows.Close()
	for rows.Next() {
		var l LevelCount
		if rows.Scan(&l.Level, &l.Count) == nil {
			result = append(result, l)
		}
	}
	return result
}

// queryTypingDailyStats 按天聚合最近 30 天打字记录（次数/平均正确率/平均 WPM/总时长）。
func queryTypingDailyStats() []TypingDayStat {
	result := make([]TypingDayStat, 0)
	rows, err := core.DB.Query(`SELECT substr(created_at, 1, 10) AS d,
		COUNT(*), COALESCE(AVG(accuracy), 0), COALESCE(AVG(wpm), 0), COALESCE(SUM(duration), 0)
		FROM typing_records
		WHERE substr(created_at, 1, 10) >= date('now','localtime','-29 days')
		GROUP BY d ORDER BY d`)
	if err != nil {
		fmt.Fprintf(os.Stderr, "extendedStats typing: %v\n", err)
		return result
	}
	defer rows.Close()
	for rows.Next() {
		var t TypingDayStat
		if rows.Scan(&t.Date, &t.Count, &t.AvgAccuracy, &t.AvgWPM, &t.TotalDuration) == nil {
			result = append(result, t)
		}
	}
	return result
}

// --- Tags ---

func (s *WordService) DbTagsList() []Tag {
	return dbTagsList()
}

func (s *WordService) DbTagsAdd(name, color string) int {
	return dbTagsAdd(name, color)
}

func (s *WordService) DbTagsDelete(id int) {
	dbTagsDelete(id)
}

// --- Export / Import ---

func (s *WordService) DbExport() string {
	return dbExport()
}

func (s *WordService) DbImport(jsonStr string) ImportResult {
	return dbImport(jsonStr)
}

func (s *WordService) DbClear() {
	dbClear()
}

// --- Batch ---

func (s *WordService) AddWordsBatch(words []Word) int {
	return dbAddWordsBatch(words)
}
