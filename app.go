package main

import (
	"context"
	"os"
	"path/filepath"
	goRuntime "runtime"
	"sync"

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

func (a *App) GetPlatform() string {
	return goRuntime.GOOS
}

// --- Media ---

func (a *App) GetMediaPort() int {
	return a.mediaPort
}
