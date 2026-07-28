package main

import (
	"context"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type WordService struct {
	app *application.App
}

func NewWordService(app *application.App) *WordService {
	return &WordService{app: app}
}

func (s *WordService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error { return nil }
func (s *WordService) ServiceShutdown() error { return nil }

// --- Words ---

func (s *WordService) DbWordsList() []Word {
	return dbWordsList()
}

func (s *WordService) DbWordsAdd(word string) int {
	return dbWordsAdd(word)
}

func (s *WordService) DbWordsUpdate(id int, data string) {
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

func (s *WordService) AddWordsBatch(wordsJSON string) int {
	return dbAddWordsBatch(wordsJSON)
}
