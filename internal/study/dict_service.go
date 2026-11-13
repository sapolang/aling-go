package study

import (
	"context"

	"aling-go/internal/dict"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type DictService struct {
	app *application.App
}

func NewDictService(app *application.App) *DictService {
	return &DictService{app: app}
}

func (s *DictService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	return nil
}
func (s *DictService) ServiceShutdown() error { return nil }

// DbDictLookup 查询单个单词的词典释义，未命中返回 nil
func (s *DictService) DbDictLookup(word string) *dict.DictWord {
	return dict.Lookup(word)
}

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

// DbDictSearch 全局搜索词条，limit <= 0 时默认 50
func (s *DictService) DbDictSearch(query string, limit int) []dict.DictWord {
	words, err := dict.SearchEntries(query, limit)
	if err != nil {
		s.app.Logger.Error("DbDictSearch failed", "error", err)
		return []dict.DictWord{}
	}
	if words == nil {
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

func (s *DictService) DbDictAddToWordList(words []dict.DictWord) DictAddResult {
	added, skipped, err := dict.AddWordsToList(words)
	if err != nil {
		s.app.Logger.Error("DbDictAddToWordList failed", "error", err)
	}
	return DictAddResult{Added: added, Skipped: skipped}
}
