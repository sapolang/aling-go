package main

import (
	"context"
	"encoding/json"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type ArticleService struct {
	app *application.App
}

func NewArticleService(app *application.App) *ArticleService {
	return &ArticleService{app: app}
}

func (s *ArticleService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error { return nil }
func (s *ArticleService) ServiceShutdown() error { return nil }

func (s *ArticleService) GetCategories() []ArticleCategory {
	return dbGetCategories()
}

func (s *ArticleService) GetArticles(categoryEnName string) []ArticleItem {
	return dbGetArticles(categoryEnName)
}

func (s *ArticleService) GetArticle(id int) string {
	item := dbGetArticle(id)
	if item == nil {
		return ""
	}
	b, _ := json.Marshal(item)
	return string(b)
}

func (s *ArticleService) GetTypingProgress(articleID int, mode string) string {
	return dbGetTypingProgress(articleID, mode)
}

func (s *ArticleService) SaveTypingProgress(progressJSON string) {
	dbSaveTypingProgress(progressJSON)
}

func (s *ArticleService) GetTypingRecords(articleID int) string {
	return dbGetTypingRecords(articleID)
}

func (s *ArticleService) SaveTypingRecord(recordJSON string) {
	dbSaveTypingRecord(recordJSON)
}

func (s *ArticleService) GetAllTypingProgress() string {
	return dbGetAllTypingProgress()
}
