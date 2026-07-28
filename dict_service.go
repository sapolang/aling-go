package main

import (
	"context"
	"encoding/json"

	"aling-go/internal/dict"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type DictService struct {
	app *application.App
}

func NewDictService(app *application.App) *DictService {
	return &DictService{app: app}
}

func (s *DictService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error { return nil }
func (s *DictService) ServiceShutdown() error { return nil }

func (s *DictService) DbDictTags() []dict.DictTag {
	tags, err := dict.GetTags()
	if err != nil {
		s.app.Logger.Error("DbDictTags failed", "error", err)
		return []dict.DictTag{}
	}
	return tags
}

func (s *DictService) DbDictWords(tag string) []dict.DictWord {
	words, err := dict.GetWordsByTag(tag)
	if err != nil {
		s.app.Logger.Error("DbDictWords failed", "error", err)
		return []dict.DictWord{}
	}
	return words
}

func (s *DictService) DbDictSaveProgress(tag string, index int) {
	if err := dict.SaveProgress(tag, index); err != nil {
		s.app.Logger.Error("DbDictSaveProgress failed", "error", err)
	}
}

func (s *DictService) DbDictGetProgress(tag string) int {
	index, err := dict.GetProgress(tag)
	if err != nil {
		s.app.Logger.Error("DbDictGetProgress failed", "error", err)
		return 0
	}
	return index
}

func (s *DictService) DbDictAddToWordList(jsonStr string) DictAddResult {
	var words []dict.DictWord
	if err := json.Unmarshal([]byte(jsonStr), &words); err != nil {
		return DictAddResult{}
	}
	added, skipped, err := dict.AddWordsToList(words)
	if err != nil {
		s.app.Logger.Error("DbDictAddToWordList failed", "error", err)
	}
	return DictAddResult{Added: added, Skipped: skipped}
}
