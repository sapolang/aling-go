package content

import (
	"context"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type ArticleService struct {
	app *application.App
}

func NewArticleService(app *application.App) *ArticleService {
	return &ArticleService{app: app}
}

func (s *ArticleService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	return nil
}
func (s *ArticleService) ServiceShutdown() error { return nil }

func (s *ArticleService) GetCategories() []ArticleCategory {
	return dbGetCategories()
}

func (s *ArticleService) GetArticles(categoryEnName string) []ArticleItem {
	return dbGetArticles(categoryEnName)
}

func (s *ArticleService) GetArticle(id int) *ArticleItem {
	return dbGetArticle(id)
}

func (s *ArticleService) GetTypingProgress(articleID int, mode string) *TypingProgress {
	return dbGetTypingProgress(articleID, mode)
}

func (s *ArticleService) SaveTypingProgress(progress TypingProgress) {
	dbSaveTypingProgress(progress)
}

func (s *ArticleService) GetTypingRecords(articleID int) []TypingRecord {
	return dbGetTypingRecords(articleID)
}

func (s *ArticleService) SaveTypingRecord(record TypingRecord) {
	dbSaveTypingRecord(record)
}

func (s *ArticleService) GetAllTypingProgress() []TypingProgress {
	return dbGetAllTypingProgress()
}
