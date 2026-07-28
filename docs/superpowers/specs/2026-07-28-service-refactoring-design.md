# Service Refactoring: Monolith to Multiple Wails v3 Services

## Goal

Refactor the single monolithic `App` struct into multiple independent Wails v3 services, each with a clear domain boundary, while maintaining all existing functionality and updating the frontend to use namespace-qualified bindings.

## Approach

**Independent services + shared globals.** Database access remains package-level global variables (`db`, `articleDB`) used by all services. Each service receives `*application.App` (for Logger, Events, Dialogs) and `dataDir` through constructor injection. DB initialization and migration happen in `main.go` before `application.New()`.

## Service Breakdown

### 1. `PlatformService` — `platform_service.go`

Lifecycle: empty startup/shutdown.

| Method | Source | Notes |
|--------|--------|-------|
| `OpenFile(filters string) string` | `app.go` | uses `a.app.Dialog` |
| `SaveFile(defaultName string) string` | `app.go` | uses `a.app.Dialog` |
| `OpenSubtitle() string` | `app.go` | uses `a.app.Dialog` |
| `GetPlatform() string` | `app.go` | `goRuntime.GOOS` |
| `OpenExternal(filePath string)` | `app.go` | exec |
| `ReadTextFile(path string) string` | `fileops.go` | |
| `WriteTextFile(path, content string)` | `fileops.go` | |

Field: `app *application.App`

### 2. `WordService` — `word_service.go`

Lifecycle: empty startup/shutdown.

| Method | Source | Notes |
|--------|--------|-------|
| `DbWordsList() []Word` | `app.go` | delegates to `database.go` |
| `DbWordsAdd(word string) int` | `app.go` | |
| `DbWordsUpdate(id int, data string)` | `app.go` | |
| `DbWordsDelete(id int)` | `app.go` | |
| `DbWordsDeleteBatch(ids []int)` | `app.go` | |
| `DbWordsGetReview() []Word` | `app.go` | |
| `DbWordsGetReviewCount() int` | `app.go` | |
| `DbWordsSearch(query string) []Word` | `app.go` | |
| `DbTagsList() []Tag` | `app.go` | |
| `DbTagsAdd(name, color string) int` | `app.go` | |
| `DbTagsDelete(id int)` | `app.go` | |
| `DbExport() string` | `app.go` | |
| `DbImport(jsonStr string) ImportResult` | `app.go` | |
| `DbClear()` | `app.go` | |
| `AddWordsBatch(wordsJSON string) int` | `app.go` | |

Field: `app *application.App` (for logging)

### 3. `ArticleService` — `article_service.go`

Lifecycle: empty startup/shutdown.

| Method | Source | Notes |
|--------|--------|-------|
| `GetCategories() []ArticleCategory` | `app.go` | |
| `GetArticles(categoryEnName string) []ArticleItem` | `app.go` | |
| `GetArticle(id int) string` | `app.go` | |
| `GetTypingProgress(articleID int, mode string) string` | `app.go` | uses global `db` |
| `SaveTypingProgress(progressJSON string)` | `app.go` | |
| `GetTypingRecords(articleID int) string` | `app.go` | |
| `SaveTypingRecord(recordJSON string)` | `app.go` | |
| `GetAllTypingProgress() string` | `app.go` | |

Field: `app *application.App`

### 4. `DictService` — `dict_service.go`

Lifecycle: empty startup/shutdown.

| Method | Source | Notes |
|--------|--------|-------|
| `DbDictTags() []dict.DictTag` | `app.go` | |
| `DbDictWords(tag string) []dict.DictWord` | `app.go` | |
| `DbDictSaveProgress(tag string, index int)` | `app.go` | |
| `DbDictGetProgress(tag string) int` | `app.go` | |
| `DbDictAddToWordList(jsonStr string) DictAddResult` | `app.go` | |

Field: `app *application.App`

### 5. `LibraryService` — `library_service.go`

Source files to merge: `library.go`, `recent.go`.

Lifecycle: empty startup/shutdown.

| Method | Source |
|--------|--------|
| `LibraryList() string` | `library.go` |
| `LibraryImport(category, folderID string) string` | `library.go` |
| `LibraryRemove(pathsJSON string) string` | `library.go` |
| `LibraryRename(path, newName string) string` | `library.go` |
| `LibraryMove(pathsJSON, folderID string) string` | `library.go` |
| `FolderCreate(name, parentID string) string` | `library.go` |
| `FolderDelete(id string) string` | `library.go` |
| `FolderRename(id, name string) string` | `library.go` |
| `RecentList() string` | `recent.go` |
| `RecentAdd(filePath string) string` | `recent.go` |
| `CacheSubtitles(filePath, subsJSON string)` | `recent.go` |
| `GetCachedSubtitles(filePath string) string` | `recent.go` |

Internal helpers: `libraryPath()`, `readLibrary()`, `writeLibrary()`, `containsFile()`, `detectFileType()`, `md5Hash()`.

Fields: `app *application.App`, `dataDir string`

### 6. `MediaService` — `media_service.go`

Source files to merge: `media.go`, parts of `ffmpeg.go`, `waveform.go`.

Lifecycle: `ServiceStartup` starts HTTP media server; `ServiceShutdown` closes the listener.

| Method | Source |
|--------|--------|
| `GetMediaPort() int` | `media.go` |
| `GetVideoThumbnail(filePath string) string` | `ffmpeg.go` |
| `GetWaveformData(filePath string) []float64` | `waveform.go` |

Internal: `startMediaServer()`, `handleMediaStream()`.

Fields: `app *application.App`, `dataDir string`, `mediaPort int`, `mediaListener net.Listener`

### 7. `WhisperService` — `whisper_service.go`

Source file: `whisper.go`. Also uses `extractAudio` and `findFFmpeg` from ffmpeg.

Lifecycle: `ServiceStartup` loads model/lang config; `ServiceShutdown` cleanup.

| Method | Source |
|--------|--------|
| `Transcribe(filePath string) string` | `whisper.go` |
| `WhisperStatus() WhisperStatus` | `whisper.go` |
| `SetWhisperModel(name string)` | `whisper.go` |
| `GetWhisperLang() string` | `whisper.go` |
| `SetWhisperLang(lang string)` | `whisper.go` |
| `ListWhisperModels() string` | `whisper.go` |
| `DownloadWhisperModel(mirrorURL, modelName string) error` | `whisper.go` |
| `GetDownloadProgress() string` | `whisper.go` |

Internal helpers: `modelPath()`, `modelFileFor()`, `findWhisperSidecar()`, `bundleResources()`, `loadWhisperModel()`, `loadWhisperLang()`.

Fields: `app *application.App`, `dataDir string`, `modelFile string`, `whisperLang string`, `dlMu sync.Mutex`, `dlActive bool`, `dlProgress int`, `dlModel string`

## Shared State

### Database globals

Unchanged. Remain package-level `var db *sql.DB` in `database.go`, `var articleDB *sql.DB` in `articles_db.go`, and `var dictDB *sql.DB`/`var userDB *sql.DB` in `internal/dict/dict.go`.

### FFmpeg utilities

`findFFmpeg()` and `extractAudio()` become package-level functions (not on any service). They accept necessary parameters (`dataDir string`, `logger *slog.Logger`) instead of using `a.app` / `a.dataDir`.

`extractAudio()` is called by both `WhisperService.Transcribe()` and `MediaService.GetWaveformData()`.

### Migration

`migrateIfNeeded()` stays as a standalone function called from `main.go` after DB initialization. `findOldDatabase()` remains a helper.

## `main.go` Changes

```go
func main() {
    configDir, _ := os.UserConfigDir()
    dataDir := filepath.Join(configDir, "aling-go")

    // Bootstrap: DB init + migration
    if err := initDB(dataDir); err != nil { log.Fatal(err) }
    if err := openArticleDB(dataDir); err != nil { log.Fatal(err) }
    if err := dict.OpenDictDB(dataDir, db); err != nil { log.Fatal(err) }
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

    wailsApp.RegisterService(application.NewService(NewPlatformService(wailsApp)))
    wailsApp.RegisterService(application.NewService(NewWordService(wailsApp)))
    wailsApp.RegisterService(application.NewService(NewArticleService(wailsApp)))
    wailsApp.RegisterService(application.NewService(NewDictService(wailsApp)))
    wailsApp.RegisterService(application.NewService(NewLibraryService(wailsApp, dataDir)))
    wailsApp.RegisterService(application.NewService(NewMediaService(wailsApp, dataDir)))
    wailsApp.RegisterService(application.NewService(NewWhisperService(wailsApp, dataDir)))

    // window + hooks (unchanged)
    ...
    wailsApp.Run()
}
```

## Files to Create

1. `platform_service.go` — from `app.go` (dialogs, platform) + `fileops.go`
2. `word_service.go` — from `app.go` (words, tags, export/import)
3. `article_service.go` — from `app.go` (articles, typing)
4. `dict_service.go` — from `app.go` (dictionary)
5. `library_service.go` — from `library.go` + `recent.go`
6. `media_service.go` — from `media.go` + `ffmpeg.go` + `waveform.go`
7. `whisper_service.go` — from `whisper.go`

## Files to Modify

- `main.go` — bootstrap DBs upfront, register all services, remove `&App{}`
- `ffmpeg.go` — convert `(a *App)` methods to package-level functions
- `types.go` — add `DictAddResult` (moved from `app.go`)

## Files to Delete

- `app.go` — `App` struct and all shim methods moved out
- `waveform.go` — merged into `media_service.go`
- `recent.go` — merged into `library_service.go`
- `fileops.go` — merged into `platform_service.go`

## Frontend Changes

Each service's exported methods generate bindings under a namespace matching the Go struct name. The Go struct name determines the JS namespace.

For a service `WordService`, the frontend calls `WordService.DbWordsList()`. Current calls like `App.DbWordsList()` need to be updated.

Example mapping:
| Before (Go struct) | After (Go struct) | JS namespace |
|---|---|---|
| `App` | `PlatformService` | `PlatformService` |
| `App` | `WordService` | `WordService` |
| `App` | `ArticleService` | `ArticleService` |
| `App` | `DictService` | `DictService` |
| `App` | `LibraryService` | `LibraryService` |
| `App` | `MediaService` | `MediaService` |
| `App` | `WhisperService` | `WhisperService` |

A systematic find-and-replace across `frontend/src/` will update all references.

## Migration Path

1. Create each service file with its methods and constructor
2. Convert `ffmpeg.go` functions to package-level
3. Update `main.go` entry point
4. Delete unnecessary files (`app.go`, `recent.go`, `fileops.go`)
5. Run backend build to verify (`go vet ./...`, `wails3 build`)
6. Update frontend bindings (`wails3 dev` or build to regenerate)
7. Find-and-replace frontend `App.Xxx()` → `ServiceName.Xxx()` across `frontend/src/`
8. Run frontend type check (`npx tsc --noEmit`)
9. Test end-to-end with `wails3 dev`

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Service startup order matters | Only DB init order matters; all done in main before service creation |
| `migrateIfNeeded` uses `a.dataDir` | Pass `dataDir` as function parameter |
| Frontend bindings namespace changed | Systematic find-and-replace; verify with TypeScript compiler |
| `extractAudio` shared between services | Convert to package-level function with parameters |
| `WhisperService.DownloadWhisperModel` emits `whisper:download-progress` event | `WhisperService` holds `*application.App` reference for `s.app.Event.Emit` |
