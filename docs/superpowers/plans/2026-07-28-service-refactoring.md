# Service Refactoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split monolithic `App` struct into 7 independent Wails v3 services, keeping shared DB globals unchanged.

**Architecture:** Each service struct implements `application.Service`, receives `*application.App` and `dataDir` via constructor. DBs initialized in `main.go` before service registration. Shared helpers (`findFFmpeg`, `extractAudio`, `md5Hash`) remain package-level functions.

**Tech Stack:** Go 1.25, Wails v3, modernc/sqlite

## Global Constraints

- All existing frontend-callable method signatures (return types, param types) must be preserved
- Database globals (`var db *sql.DB` in `database.go`, etc.) remain package-level
- No new packages introduced — everything stays in `package main`
- Frontend bindings regenerate via `wails3 dev` — namespace changes propagate automatically
- All existing frontend `App.Xxx()` calls become `ServiceName.Xxx()` calls

---

### Task 1: Update types.go — add DictAddResult

**Files:**
- Modify: `types.go` — append `DictAddResult` struct

**Interfaces:**
- Produces: `type DictAddResult struct { Added int; Skipped int }` in `types.go`

- [ ] **Read current types.go**

- [ ] **Append `DictAddResult` to types.go**

After the last type in `types.go`, add:

```go
type DictAddResult struct {
	Added   int `json:"added"`
	Skipped int `json:"skipped"`
}
```

---

### Task 2: Refactor ffmpeg.go — convert (a *App) methods to package-level functions

**Files:**
- Modify: `ffmpeg.go` — remove receiver from `findFFmpeg` and `extractAudio`

**Interfaces:**
- Produces: `findFFmpeg(dataDir string, logger *slog.Logger) string`
- Produces: `extractAudio(dataDir string, logger *slog.Logger, filePath string) string`

- [ ] **Read current ffmpeg.go**

- [ ] **Remove `(a *App)` receiver from `findFFmpeg`**

Change `func (a *App) findFFmpeg() string` → `func findFFmpeg(dataDir string, logger *slog.Logger) string`.

Replace all `a.app.Logger` → `logger`, all `a.dataDir` → `dataDir`.

- [ ] **Remove `(a *App)` receiver from `extractAudio`**

Change `func (a *App) extractAudio(filePath string) string` → `func extractAudio(dataDir string, logger *slog.Logger, filePath string) string`.

Replace all `a.app.Logger` → `logger`, all `a.dataDir` → `dataDir`. Call `findFFmpeg(dataDir, logger)` instead of `a.findFFmpeg()`.

- [ ] **Keep `GetVideoThumbnail` in place** — will move to MediaService in Task 8. For now, keep the method temporarily (it references old `a.dataDir` etc. but deleting it will cause compile errors until services exist). Actually, just leave the whole file as-is for this task and handle the method moves in Task 8.

(Note: `GetVideoThumbnail` will be handled in Task 8 — it moves to MediaService. For this task, only refactor `findFFmpeg` and `extractAudio`.)

- [ ] **Add `import "log/slog"` to imports**

---

### Task 3: Create PlatformService

**Files:**
- Create: `platform_service.go`

**Interfaces:**
- Consumes: `*application.App`
- Produces: `PlatformService` struct with methods: `OpenFile`, `SaveFile`, `OpenSubtitle`, `GetPlatform`, `OpenExternal`, `ReadTextFile`, `WriteTextFile`

- [ ] **Create `platform_service.go`**

```go
package main

import (
	"os"
	"os/exec"
	goRuntime "runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type PlatformService struct {
	app *application.App
}

func NewPlatformService(app *application.App) *PlatformService {
	return &PlatformService{app: app}
}

func (s *PlatformService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error { return nil }
func (s *PlatformService) ServiceShutdown() error { return nil }

// --- Dialogs ---

func (s *PlatformService) OpenFile(filters string) string {
	dialog := s.app.Dialog.OpenFile().CanChooseFiles(true)
	if filters != "" {
		dialog.AddFilter("Files", filters)
	}
	file, err := dialog.PromptForSingleSelection()
	if err != nil {
		return ""
	}
	return file
}

func (s *PlatformService) SaveFile(defaultName string) string {
	file, err := s.app.Dialog.SaveFile().
		SetFilename(defaultName).
		PromptForSingleSelection()
	if err != nil {
		return ""
	}
	return file
}

func (s *PlatformService) OpenSubtitle() string {
	file, err := s.app.Dialog.OpenFile().
		CanChooseFiles(true).
		AddFilter("Subtitle Files", "*.srt").
		PromptForSingleSelection()
	if err != nil {
		return ""
	}
	return file
}

// --- Platform ---

func (s *PlatformService) OpenExternal(filePath string) {
	var cmd *exec.Cmd
	switch goRuntime.GOOS {
	case "darwin":
		cmd = exec.Command("open", "--", filePath)
	case "windows":
		cmd = exec.Command("cmd", "/c", "start", "", filePath)
	default:
		cmd = exec.Command("xdg-open", filePath)
	}
	cmd.Start()
}

func (s *PlatformService) GetPlatform() string {
	return goRuntime.GOOS
}

// --- File Ops ---

func (s *PlatformService) ReadTextFile(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return string(data)
}

func (s *PlatformService) WriteTextFile(path, content string) {
	os.WriteFile(path, []byte(content), 0644)
}
```

---

### Task 4: Create WordService

**Files:**
- Create: `word_service.go`

**Interfaces:**
- Consumes: `*application.App`
- Produces: `WordService` struct with all words/tags methods

- [ ] **Create `word_service.go`**

```go
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
```

---

### Task 5: Create ArticleService

**Files:**
- Create: `article_service.go`

**Interfaces:**
- Consumes: `*application.App`
- Produces: `ArticleService` struct with article/typing methods

- [ ] **Create `article_service.go`**

```go
package main

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

func (s *ArticleService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error { return nil }
func (s *ArticleService) ServiceShutdown() error { return nil }

// --- Articles ---

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

// --- Typing ---

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
```

Note: add `"encoding/json"` to imports.

---

### Task 6: Create DictService

**Files:**
- Create: `dict_service.go`

**Interfaces:**
- Consumes: `*application.App`
- Produces: `DictService` struct with dict methods

- [ ] **Create `dict_service.go`**

```go
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
```

---

### Task 7: Create LibraryService

**Files:**
- Create: `library_service.go`

**Interfaces:**
- Consumes: `*application.App`, `dataDir string`
- Produces: `LibraryService` struct with library, folder, recent, subtitle methods

- [ ] **Create `library_service.go`**

```go
package main

import (
	"context"
	"crypto/md5"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type LibraryService struct {
	app     *application.App
	dataDir string
}

func NewLibraryService(app *application.App, dataDir string) *LibraryService {
	return &LibraryService{app: app, dataDir: dataDir}
}

func (s *LibraryService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error { return nil }
func (s *LibraryService) ServiceShutdown() error { return nil }

// --- helpers ---

func (s *LibraryService) libraryPath() string {
	return filepath.Join(s.dataDir, "library.json")
}

func (s *LibraryService) readLibrary() LibraryData {
	var lib LibraryData
	data, err := os.ReadFile(s.libraryPath())
	if err == nil {
		json.Unmarshal(data, &lib)
	}
	if lib.Folders == nil {
		lib.Folders = []Folder{}
	}
	if lib.Files == nil {
		lib.Files = []LibraryFile{}
	}
	return lib
}

func (s *LibraryService) writeLibrary(lib LibraryData) {
	b, err := json.Marshal(lib)
	if err != nil {
		return
	}
	os.WriteFile(s.libraryPath(), b, 0644)
}

// --- Library ---

func (s *LibraryService) LibraryList() string {
	lib := s.readLibrary()
	b, _ := json.Marshal(lib)
	return string(b)
}

// (all library.go methods, with `(s *LibraryService)` receiver and s.app / s.dataDir)

// --- Recent ---

func (s *LibraryService) RecentList() string {
	lib := s.readLibrary()
	type recentEntry struct {
		Path string `json:"path"`
		Name string `json:"name"`
	}
	entries := make([]recentEntry, 0, len(lib.Files))
	for _, f := range lib.Files {
		entries = append(entries, recentEntry{Path: f.Path, Name: f.Name})
	}
	b, _ := json.Marshal(entries)
	return string(b)
}

// (recent.go methods with `(s *LibraryService)`)

// --- Subtitle cache ---

func (s *LibraryService) CacheSubtitles(filePath, subsJSON string) {
	cacheDir := filepath.Join(s.dataDir, "subtitle-cache")
	os.MkdirAll(cacheDir, 0755)
	cacheKey := md5Hash(filePath)
	cachePath := filepath.Join(cacheDir, cacheKey+".json")
	os.WriteFile(cachePath, []byte(subsJSON), 0644)
}

func (s *LibraryService) GetCachedSubtitles(filePath string) string {
	cacheDir := filepath.Join(s.dataDir, "subtitle-cache")
	cacheKey := md5Hash(filePath)
	cachePath := filepath.Join(cacheDir, cacheKey+".json")
	data, err := os.ReadFile(cachePath)
	if err != nil {
		return ""
	}
	return string(data)
}
```

The full file content includes all methods from `library.go` and `recent.go`, with receiver changed from `(a *App)` to `(s *LibraryService)`, `a.app` → `s.app`, `a.dataDir` → `s.dataDir`.

---

### Task 8: Create MediaService

**Files:**
- Create: `media_service.go`

**Interfaces:**
- Consumes: `*application.App`, `dataDir string`
- Produces: `MediaService` with HTTP server, thumbnail, waveform 

- [ ] **Create `media_service.go`**

Contains:
- `MediaService` struct with `app`, `dataDir`, `mediaPort`, `mediaListener`
- `ServiceStartup` → calls `startMediaServer()`
- `ServiceShutdown` → closes listener
- `GetMediaPort()`, `GetVideoThumbnail()`, `GetWaveformData()`
- `startMediaServer()`, `handleMediaStream()` internals
- `mimeTypes` var

Method implementations identical to current files but with `(s *MediaService)` receiver.

---

### Task 9: Create WhisperService

**Files:**
- Create: `whisper_service.go`

**Interfaces:**
- Consumes: `*application.App`, `dataDir string`
- Produces: `WhisperService` with transcribe, model management

- [ ] **Create `whisper_service.go`**

Contains all methods from `whisper.go` with receiver changed from `(a *App)` to `(s *WhisperService)`, `a.app` → `s.app`, `a.dataDir` → `s.dataDir`, `a.modelFile` → `s.modelFile`, etc.

The `Transcribe` method calls `extractAudio(s.dataDir, s.app.Logger, filePath)` instead of `a.extractAudio(filePath)`.

---

### Task 10: Update main.go

**Files:**
- Modify: `main.go`

- [ ] **Read current main.go**

- [ ] **Rewrite main.go**

```go
package main

import (
	"context"
	"embed"
	"fmt"
	"os"
	"path/filepath"

	"aling-go/internal/dict"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	configDir, err := os.UserConfigDir()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error getting config dir: %v\n", err)
		os.Exit(1)
	}
	dataDir := filepath.Join(configDir, "aling-go")

	if err := initDB(dataDir); err != nil {
		fmt.Fprintf(os.Stderr, "DB init failed: %v\n", err)
		os.Exit(1)
	}
	if err := openArticleDB(dataDir); err != nil {
		fmt.Fprintf(os.Stderr, "Article DB init failed: %v\n", err)
		os.Exit(1)
	}
	if err := dict.OpenDictDB(dataDir, db); err != nil {
		fmt.Fprintf(os.Stderr, "Dict DB init failed: %v\n", err)
		os.Exit(1)
	}
	migrateIfNeeded(dataDir)

	wailsApp := application.New(application.Options{
		Name: "语练",
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: false,
		},
	})

	wailsApp.RegisterService(application.NewService(NewWordService(wailsApp)))
	wailsApp.RegisterService(application.NewService(NewArticleService(wailsApp)))
	wailsApp.RegisterService(application.NewService(NewDictService(wailsApp)))
	wailsApp.RegisterService(application.NewService(NewLibraryService(wailsApp, dataDir)))
	wailsApp.RegisterService(application.NewService(NewMediaService(wailsApp, dataDir)))
	wailsApp.RegisterService(application.NewService(NewWhisperService(wailsApp, dataDir)))
	wailsApp.RegisterService(application.NewService(NewPlatformService(wailsApp)))

	win := wailsApp.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "语练",
		Width:            1200,
		Height:           720,
		MinWidth:         800,
		MinHeight:        500,
		BackgroundColour: application.RGBA{Red: 27, Green: 38, Blue: 54, Alpha: 255},
	})

	win.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
		win.Hide()
		event.Cancel()
	})

	if err := wailsApp.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
```

---

### Task 11: Update migrate.go

**Files:**
- Modify: `migrate.go` — change `migrateIfNeeded` receiver

- [ ] **Read current migrate.go**

- [ ] **Remove `(a *App)` receiver from `migrateIfNeeded`**

Change `func (a *App) migrateIfNeeded()` → `func migrateIfNeeded(dataDir string)`. Replace `a.dataDir` → `dataDir`.

`findOldDatabase` already takes no receiver state — keep as `(a *App) findOldDatabase()` for now, or remove receiver and keep as `func findOldDatabase() string` (it only uses `os.UserHomeDir()` and `goRuntime.GOOS`).

Actually since `migrateIfNeeded` is no longer on `App`, `findOldDatabase` also doesn't need the receiver. Change both.

```go
func findOldDatabase() string {
	home, _ := os.UserHomeDir()
	if goRuntime.GOOS == "darwin" {
		paths := []string{
			filepath.Join(home, "Library", "Application Support", "aling", "userData.db"),
			filepath.Join(home, "Library", "Application Support", "aling-go", "userData.db"),
		}
		for _, p := range paths {
			if _, err := os.Stat(p); err == nil {
				return p
			}
		}
	}
	return ""
}
```

---

### Task 12: Move GetVideoThumbnail to MediaService + remove GetVideoThumbnail from ffmpeg.go

**Files:**
- Modify: `ffmpeg.go` — delete `GetVideoThumbnail` method

- [ ] **Read `ffmpeg.go`, remove `GetVideoThumbnail` method**

Delete the `GetVideoThumbnail` method block (lines 12-35).

---

### Task 13: Delete old files

**Files:**
- Delete: `app.go`, `fileops.go`, `recent.go`, `waveform.go`

- [ ] **Delete `app.go`**

- [ ] **Delete `fileops.go`**

- [ ] **Delete `recent.go`**

- [ ] **Delete `waveform.go`**

- [ ] **Run `go vet ./...` to verify compilation**

---

### Task 14: Frontend update — regenerate bindings + replace App.xxx calls

**Files:**
- Modify: `frontend/src/**/*.{ts,tsx}` — find-and-replace

- [ ] **Regenerate bindings** by running `wails3 dev` or `wails3 build`

After regeneration, the generated binding files in `frontend/bindings/` and `frontend/wailsjs/` will contain the new service namespaces.

- [ ] **Map old→new namespaces**

| Old (App) | New |
|-----------|-----|
| App.DbWordsList() | WordService.DbWordsList() |
| App.DbWordsAdd() | WordService.DbWordsAdd() |
| App.DbWordsUpdate() | WordService.DbWordsUpdate() |
| App.DbWordsDelete() | WordService.DbWordsDelete() |
| App.DbWordsDeleteBatch() | WordService.DbWordsDeleteBatch() |
| App.DbWordsGetReview() | WordService.DbWordsGetReview() |
| App.DbWordsGetReviewCount() | WordService.DbWordsGetReviewCount() |
| App.DbWordsSearch() | WordService.DbWordsSearch() |
| App.DbTagsList() | WordService.DbTagsList() |
| App.DbTagsAdd() | WordService.DbTagsAdd() |
| App.DbTagsDelete() | WordService.DbTagsDelete() |
| App.DbExport() | WordService.DbExport() |
| App.DbImport() | WordService.DbImport() |
| App.DbClear() | WordService.DbClear() |
| App.AddWordsBatch() | WordService.AddWordsBatch() |
| App.GetCategories() | ArticleService.GetCategories() |
| App.GetArticles() | ArticleService.GetArticles() |
| App.GetArticle() | ArticleService.GetArticle() |
| App.GetTypingProgress() | ArticleService.GetTypingProgress() |
| App.SaveTypingProgress() | ArticleService.SaveTypingProgress() |
| App.GetTypingRecords() | ArticleService.GetTypingRecords() |
| App.SaveTypingRecord() | ArticleService.SaveTypingRecord() |
| App.GetAllTypingProgress() | ArticleService.GetAllTypingProgress() |
| App.DbDictTags() | DictService.DbDictTags() |
| App.DbDictWords() | DictService.DbDictWords() |
| App.DbDictSaveProgress() | DictService.DbDictSaveProgress() |
| App.DbDictGetProgress() | DictService.DbDictGetProgress() |
| App.DbDictAddToWordList() | DictService.DbDictAddToWordList() |
| App.LibraryList() | LibraryService.LibraryList() |
| App.LibraryImport() | LibraryService.LibraryImport() |
| App.LibraryRemove() | LibraryService.LibraryRemove() |
| App.LibraryRename() | LibraryService.LibraryRename() |
| App.LibraryMove() | LibraryService.LibraryMove() |
| App.FolderCreate() | LibraryService.FolderCreate() |
| App.FolderDelete() | LibraryService.FolderDelete() |
| App.FolderRename() | LibraryService.FolderRename() |
| App.RecentList() | LibraryService.RecentList() |
| App.RecentAdd() | LibraryService.RecentAdd() |
| App.CacheSubtitles() | LibraryService.CacheSubtitles() |
| App.GetCachedSubtitles() | LibraryService.GetCachedSubtitles() |
| App.GetMediaPort() | MediaService.GetMediaPort() |
| App.GetVideoThumbnail() | MediaService.GetVideoThumbnail() |
| App.GetWaveformData() | MediaService.GetWaveformData() |
| App.Transcribe() | WhisperService.Transcribe() |
| App.WhisperStatus() | WhisperService.WhisperStatus() |
| App.SetWhisperModel() | WhisperService.SetWhisperModel() |
| App.GetWhisperLang() | WhisperService.GetWhisperLang() |
| App.SetWhisperLang() | WhisperService.SetWhisperLang() |
| App.ListWhisperModels() | WhisperService.ListWhisperModels() |
| App.DownloadWhisperModel() | WhisperService.DownloadWhisperModel() |
| App.GetDownloadProgress() | WhisperService.GetDownloadProgress() |
| App.OpenFile() | PlatformService.OpenFile() |
| App.SaveFile() | PlatformService.SaveFile() |
| App.OpenSubtitle() | PlatformService.OpenSubtitle() |
| App.OpenExternal() | PlatformService.OpenExternal() |
| App.GetPlatform() | PlatformService.GetPlatform() |
| App.ReadTextFile() | PlatformService.ReadTextFile() |
| App.WriteTextFile() | PlatformService.WriteTextFile() |

- [ ] **Find-and-replace across all frontend/src/ files**

Use `sed` or grep to find all `App.` method calls and replace with the appropriate service namespace. Perform one service at a time to avoid mistakes.

- [ ] **Run frontend type check**

```bash
cd frontend && npx tsc --noEmit
```

---

### Task 15: Final verification

- [ ] **Go vet**

```bash
go vet ./...
```

- [ ] **Frontend type check**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Build**

```bash
wails3 build
```
