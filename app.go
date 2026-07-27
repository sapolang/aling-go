package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	goRuntime "runtime"
	"sync"

	"aling-go/internal/dict"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx         context.Context
	mediaPort   int
	dataDir     string
	modelFile   string
	whisperLang string
	dlMu        sync.Mutex
	dlActive    bool
	dlProgress  int
	dlModel     string
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	configDir, _ := os.UserConfigDir()
	a.dataDir = filepath.Join(configDir, "aling-go")
	a.modelFile = "ggml-tiny.bin"
	a.whisperLang = "auto"
	a.dlProgress = -1
	a.loadWhisperLang()
	a.loadWhisperModel()
	if err := initDB(a.dataDir); err != nil {
		println("DB init error:", err.Error())
	}
	if err := dict.OpenDictDB(a.dataDir, db); err != nil {
		println("Dict DB init error:", err.Error())
	}
	if err := openArticleDB(a.dataDir); err != nil {
		println("Article DB init error:", err.Error())
	}
	a.migrateIfNeeded()
	a.startMediaServer()
}

// --- Dialogs ---

func (a *App) OpenFile(filters string) string {
	opts := wailsRuntime.OpenDialogOptions{}
	if filters != "" {
		opts.Filters = []wailsRuntime.FileFilter{{DisplayName: "Files", Pattern: filters}}
	}
	file, _ := wailsRuntime.OpenFileDialog(a.ctx, opts)
	return file
}

func (a *App) SaveFile(defaultName string) string {
	file, _ := wailsRuntime.SaveFileDialog(a.ctx, wailsRuntime.SaveDialogOptions{
		DefaultFilename: defaultName,
	})
	return file
}

func (a *App) OpenSubtitle() string {
	file, _ := wailsRuntime.OpenFileDialog(a.ctx, wailsRuntime.OpenDialogOptions{
		Filters: []wailsRuntime.FileFilter{
			{DisplayName: "Subtitle Files", Pattern: "*.srt"},
		},
	})
	return file
}

// --- Database: Words ---

func (a *App) DbWordsList() []Word {
	return dbWordsList()
}

func (a *App) DbWordsAdd(word string) int {
	return dbWordsAdd(word)
}

func (a *App) DbWordsUpdate(id int, data string) {
	dbWordsUpdate(id, data)
}

func (a *App) DbWordsDelete(id int) {
	dbWordsDelete(id)
}

func (a *App) DbWordsDeleteBatch(ids []int) {
	dbWordsDeleteBatch(ids)
}

func (a *App) DbWordsGetReview() []Word {
	return dbWordsGetReview()
}

func (a *App) DbWordsGetReviewCount() int {
	return dbWordsGetReviewCount()
}

func (a *App) DbWordsSearch(query string) []Word {
	return dbWordsSearch(query)
}

// --- Database: Tags ---

func (a *App) DbTagsList() []Tag {
	return dbTagsList()
}

func (a *App) DbTagsAdd(name, color string) int {
	return dbTagsAdd(name, color)
}

func (a *App) DbTagsDelete(id int) {
	dbTagsDelete(id)
}

// --- Database: Export/Import ---

func (a *App) DbExport() string {
	return dbExport()
}

func (a *App) DbImport(jsonStr string) ImportResult {
	return dbImport(jsonStr)
}

func (a *App) DbClear() {
	dbClear()
}

// --- Platform ---

func (a *App) OpenExternal(filePath string) {
	var cmd *exec.Cmd
	switch goRuntime.GOOS {
	case "darwin":
		cmd = exec.Command("open", "--", filePath)
	case "windows":
		cmd = exec.Command("cmd", "/c", "start", "", filePath)
	default:
		cmd = exec.Command("xdg-open", filePath)
	}
	if err := cmd.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "OpenExternal: start error: %v\n", err)
	}
}

func (a *App) GetPlatform() string {
	return goRuntime.GOOS
}

// --- Media ---

func (a *App) GetMediaPort() int {
	return a.mediaPort
}

// --- Dictionary ---

func (a *App) DbDictTags() []dict.DictTag {
	tags, err := dict.GetTags()
	if err != nil {
		println("DbDictTags error:", err.Error())
		return []dict.DictTag{}
	}
	return tags
}

func (a *App) DbDictWords(tag string) []dict.DictWord {
	words, err := dict.GetWordsByTag(tag)
	if err != nil {
		println("DbDictWords error:", err.Error())
		return []dict.DictWord{}
	}
	return words
}

type DictAddResult struct {
	Added   int `json:"added"`
	Skipped int `json:"skipped"`
}

func (a *App) DbDictSaveProgress(tag string, index int) {
	if err := dict.SaveProgress(tag, index); err != nil {
		println("DbDictSaveProgress error:", err.Error())
	}
}

func (a *App) DbDictGetProgress(tag string) int {
	index, err := dict.GetProgress(tag)
	if err != nil {
		println("DbDictGetProgress error:", err.Error())
		return 0
	}
	return index
}

func (a *App) DbDictAddToWordList(jsonStr string) DictAddResult {
	var words []dict.DictWord
	if err := json.Unmarshal([]byte(jsonStr), &words); err != nil {
		return DictAddResult{}
	}
	added, skipped, err := dict.AddWordsToList(words)
	if err != nil {
		println("DbDictAddToWordList error:", err.Error())
	}
	return DictAddResult{Added: added, Skipped: skipped}
}

// --- Articles ---

func (a *App) GetCategories() []ArticleCategory {
	return dbGetCategories()
}

func (a *App) GetArticles(categoryEnName string) []ArticleItem {
	return dbGetArticles(categoryEnName)
}

func (a *App) GetArticle(id int) string {
	item := dbGetArticle(id)
	if item == nil {
		return ""
	}
	b, _ := json.Marshal(item)
	return string(b)
}

func (a *App) GetTypingProgress(articleID int, mode string) string {
	return dbGetTypingProgress(articleID, mode)
}

func (a *App) SaveTypingProgress(progressJSON string) {
	dbSaveTypingProgress(progressJSON)
}

func (a *App) GetTypingRecords(articleID int) string {
	return dbGetTypingRecords(articleID)
}

func (a *App) SaveTypingRecord(recordJSON string) {
	dbSaveTypingRecord(recordJSON)
}

func (a *App) GetAllTypingProgress() string {
	return dbGetAllTypingProgress()
}

func (a *App) AddWordsBatch(wordsJSON string) int {
	return dbAddWordsBatch(wordsJSON)
}
