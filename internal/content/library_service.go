package content

import (
	"context"
	"crypto/md5"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func md5Hash(s string) string {
	h := md5.New()
	h.Write([]byte(s))
	return fmt.Sprintf("%x", h.Sum(nil))
}

func containsFile(files []LibraryFile, path string) bool {
	for _, f := range files {
		if f.Path == path {
			return true
		}
	}
	return false
}

type LibraryService struct {
	app     *application.App
	dataDir string
	mu      sync.Mutex
	// pdfSvc 在 bootstrap 中注入，避免 LibraryService → PDFService 循环依赖。
	// 为 nil 时 PDF 相关的联动操作会静默跳过（纯 JSON 读写不受影响）。
	pdfSvc *PDFService
}

func NewLibraryService(app *application.App, dataDir string) *LibraryService {
	return &LibraryService{app: app, dataDir: dataDir}
}

// SetPDFService 在 bootstrap 中注册 PDFService 后调用，注入 PDF 索引联动能力。
// 故意不用构造注入——PDFService 注册晚于 LibraryService，且 feedSvc/mediaSvc/whisperSvc 等下游依赖
// 也提前构造了 LibraryService 的实例，改构造函数签名会牵扯一串调用方。
func (s *LibraryService) SetPDFService(svc *PDFService) {
	s.pdfSvc = svc
}

func (s *LibraryService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	return nil
}
func (s *LibraryService) ServiceShutdown() error { return nil }

func (s *LibraryService) libraryPath() string {
	return filepath.Join(s.dataDir, "library.json")
}

func (s *LibraryService) readLibrary() LibraryData {
	return loadLibrary(s.dataDir)
}

// loadLibrary 读取媒体库并对历史并发写入产生的重复条目去重。
// 没有 LibraryService 实例的调用方（如媒体代理的白名单校验）也可直接复用。
func loadLibrary(dataDir string) LibraryData {
	var lib LibraryData
	data, err := os.ReadFile(filepath.Join(dataDir, "library.json"))
	if err == nil {
		_ = json.Unmarshal(data, &lib)
	}
	if lib.Folders == nil {
		lib.Folders = []Folder{}
	}
	if lib.Files == nil {
		lib.Files = []LibraryFile{}
	}
	// 按 Path 去重，保留首次出现的条目（修复历史并发写入导致的重复数据）
	seen := make(map[string]bool, len(lib.Files))
	deduped := make([]LibraryFile, 0, len(lib.Files))
	for _, f := range lib.Files {
		if seen[f.Path] {
			continue
		}
		seen[f.Path] = true
		deduped = append(deduped, f)
	}
	lib.Files = deduped
	return lib
}

func (s *LibraryService) writeLibrary(lib LibraryData) {
	b, err := json.Marshal(lib)
	if err != nil {
		loggerOf(s.app).Error("write library: marshal", "error", err)
		return
	}
	if err := os.WriteFile(s.libraryPath(), b, 0644); err != nil {
		loggerOf(s.app).Error("write library: write", "error", err)
	}
}

// --- Library CRUD ---

func (s *LibraryService) LibraryList() LibraryData {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.readLibrary()
}

func (s *LibraryService) LibraryImport(category, folderID string) LibraryImportResult {
	dialog := s.app.Dialog.OpenFile().CanChooseFiles(true)
	switch category {
	case "video":
		dialog.AddFilter("视频文件", "*.mp4;*.mkv;*.avi;*.mov;*.webm;*.flv;*.wmv")
	case "audio":
		dialog.AddFilter("音频文件", "*.mp3;*.wav;*.m4a;*.ogg;*.flac;*.aac;*.wma")
	case "pdf":
		dialog.AddFilter("PDF文件", "*.pdf")
	default:
		dialog.AddFilter("媒体文件", "*.mp4;*.mkv;*.avi;*.mov;*.webm;*.flv;*.wmv;*.mp3;*.wav;*.m4a;*.ogg;*.flac;*.aac;*.wma;*.pdf")
	}
	files, err := dialog.PromptForMultipleSelection()
	if err != nil || len(files) == 0 {
		return LibraryImportResult{Files: []LibraryFile{}}
	}
	return s.ImportFiles(files, folderID)
}

// LibraryImportPaths 直接按绝对路径导入文件（拖拽导入等场景），不走文件选择弹窗。
func (s *LibraryService) LibraryImportPaths(paths []string, folderID string) LibraryImportResult {
	return s.ImportFiles(paths, folderID)
}

// ImportFiles 是 importFiles 的公开加锁版本，供其他服务（如 FeedService）调用。
// PDF 索引在锁外执行，避免解析/落库长时间占用 library.json 写锁，影响媒体库其它读写。
func (s *LibraryService) ImportFiles(files []string, folderID string) LibraryImportResult {
	var result LibraryImportResult
	var pdfPaths []string
	func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		result, pdfPaths = s.importFiles(files, folderID)
	}()
	// 锁外：逐个索引 PDF。importPDFFile 内部自己有 pdfIndexMu 串行化，
	// 不与 s.mu 交叉，不会产生锁反转。
	for _, file := range pdfPaths {
		if _, err := importPDFFile(s.dataDir, file); err != nil {
			loggerOf(s.app).Warn("pdf index on import", "path", file, "error", err)
		}
	}
	return result
}

// importFiles 只做 library.json 读写 + PDF 路径收集，不碰 PDF 解析/DB。
func (s *LibraryService) importFiles(files []string, folderID string) (LibraryImportResult, []string) {
	lib := s.readLibrary()
	var imported, skipped, dropped int
	var pdfPaths []string
	for _, file := range files {
		if containsFile(lib.Files, file) {
			skipped++
			continue
		}
		if len(lib.Files) >= 200 {
			dropped++
			continue
		}
		ftype := detectFileType(file)
		if ftype == "" {
			skipped++
			continue
		}
		if _, err := os.Stat(file); err != nil {
			skipped++
			continue
		}
		lib.Files = append(lib.Files, LibraryFile{
			Path:     file,
			Name:     filepath.Base(file),
			Type:     ftype,
			FolderID: folderID,
			AddedAt:  time.Now().Format(time.RFC3339),
		})
		imported++
		if ftype == "pdf" {
			pdfPaths = append(pdfPaths, file)
		}
	}
	s.writeLibrary(lib)
	return LibraryImportResult{Files: lib.Files, Imported: imported, Skipped: skipped, Dropped: dropped}, pdfPaths
}

// LibraryRemove 从媒体库移除文件。被移除的 PDF 会联动清理句子索引，
// 保持 pdf_documents / pdf_sentences 与媒体库条目一致。
// PDF 清理在锁外执行，避免 DB 操作长时间占用 library.json 写锁。
func (s *LibraryService) LibraryRemove(paths []string) []LibraryFile {
	var result []LibraryFile
	var pdfToRemove []string
	func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		pathSet := make(map[string]bool, len(paths))
		for _, p := range paths {
			pathSet[p] = true
		}
		lib := s.readLibrary()
		filtered := make([]LibraryFile, 0, len(lib.Files))
		for _, f := range lib.Files {
			if !pathSet[f.Path] {
				filtered = append(filtered, f)
			} else if f.Type == "pdf" {
				pdfToRemove = append(pdfToRemove, f.Path)
			}
		}
		lib.Files = filtered
		s.writeLibrary(lib)
		result = lib.Files
	}()
	// 锁外：清理 PDF 索引。pdfSvc 为 nil（启动早期顺序问题）时静默跳过。
	if s.pdfSvc != nil {
		for _, path := range pdfToRemove {
			s.pdfSvc.PDFRemove(path)
		}
	}
	return result
}

func (s *LibraryService) LibraryRename(path, newName string) LibraryData {
	s.mu.Lock()
	defer s.mu.Unlock()
	lib := s.readLibrary()
	for i := range lib.Files {
		if lib.Files[i].Path == path {
			lib.Files[i].Name = newName
			break
		}
	}
	for i := range lib.Folders {
		if lib.Folders[i].ID == path {
			lib.Folders[i].Name = newName
			break
		}
	}
	s.writeLibrary(lib)
	return lib
}

func (s *LibraryService) LibraryMove(paths []string, folderID string) []LibraryFile {
	s.mu.Lock()
	defer s.mu.Unlock()
	pathSet := make(map[string]bool, len(paths))
	for _, p := range paths {
		pathSet[p] = true
	}
	lib := s.readLibrary()
	for i := range lib.Files {
		if pathSet[lib.Files[i].Path] {
			lib.Files[i].FolderID = folderID
		}
	}
	for i := range lib.Folders {
		if pathSet[lib.Folders[i].ID] {
			lib.Folders[i].ParentID = folderID
		}
	}
	s.writeLibrary(lib)
	return lib.Files
}

// --- Folders ---

func (s *LibraryService) FolderCreate(name, parentID string) []Folder {
	s.mu.Lock()
	defer s.mu.Unlock()
	lib := s.readLibrary()
	if len(lib.Folders) >= 50 {
		return lib.Folders
	}
	lib.Folders = append(lib.Folders, Folder{
		ID:        uuid.New().String(),
		Name:      name,
		ParentID:  parentID,
		CreatedAt: time.Now().Format(time.RFC3339),
	})
	s.writeLibrary(lib)
	return lib.Folders
}

func (s *LibraryService) FolderDelete(id string) []Folder {
	s.mu.Lock()
	defer s.mu.Unlock()
	lib := s.readLibrary()
	filtered := make([]Folder, 0, len(lib.Folders))
	for _, f := range lib.Folders {
		if f.ID != id {
			filtered = append(filtered, f)
		}
	}
	lib.Folders = filtered
	for i := range lib.Files {
		if lib.Files[i].FolderID == id {
			lib.Files[i].FolderID = ""
		}
	}
	s.writeLibrary(lib)
	return lib.Folders
}

func (s *LibraryService) FolderRename(id, name string) []Folder {
	s.mu.Lock()
	defer s.mu.Unlock()
	lib := s.readLibrary()
	for i := range lib.Folders {
		if lib.Folders[i].ID == id {
			lib.Folders[i].Name = name
			break
		}
	}
	s.writeLibrary(lib)
	return lib.Folders
}

// --- Recent ---

func toRecentEntries(files []LibraryFile) []RecentEntry {
	entries := make([]RecentEntry, 0, len(files))
	for _, f := range files {
		entries = append(entries, RecentEntry{
			Path:         f.Path,
			Name:         f.Name,
			Type:         f.Type,
			LastPosition: f.LastPosition,
		})
	}
	return entries
}

func (s *LibraryService) RecentList() []RecentEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	return toRecentEntries(s.readLibrary().Files)
}

// RecentGetPosition 返回文件上次播放位置（秒），无记录时返回 0
func (s *LibraryService) RecentGetPosition(filePath string) float64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, f := range s.readLibrary().Files {
		if f.Path == filePath {
			return f.LastPosition
		}
	}
	return 0
}

// RecentUpdatePosition 保存文件播放位置（秒）
func (s *LibraryService) RecentUpdatePosition(filePath string, position float64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	lib := s.readLibrary()
	for i := range lib.Files {
		if lib.Files[i].Path == filePath {
			lib.Files[i].LastPosition = position
			s.writeLibrary(lib)
			return
		}
	}
}

func (s *LibraryService) RecentAdd(filePath string) []RecentEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	lib := s.readLibrary()
	found := false
	for i, f := range lib.Files {
		if f.Path == filePath {
			// 先把命中项单独取出，再基于原切片重新拼一份，避免原地 append 改写底层数组：
			// 原地写法会先覆盖 lib.Files[i]，导致该项丢失、后一项被复制成两份。
			moved := make([]LibraryFile, 0, len(lib.Files))
			moved = append(moved, f)
			moved = append(moved, lib.Files[:i]...)
			moved = append(moved, lib.Files[i+1:]...)
			lib.Files = moved
			found = true
			break
		}
	}
	if !found {
		// 未知类型也保留记录（type 为空），仅用于最近打开列表展示
		if len(lib.Files) >= 200 {
			lib.Files = lib.Files[:199]
		}
		lib.Files = append([]LibraryFile{{
			Path:     filePath,
			Name:     filepath.Base(filePath),
			Type:     detectFileType(filePath),
			FolderID: "",
			AddedAt:  time.Now().Format(time.RFC3339),
		}}, lib.Files...)
	}
	s.writeLibrary(lib)
	return toRecentEntries(lib.Files)
}

// --- Subtitle cache ---

func (s *LibraryService) CacheSubtitles(filePath string, subs []SubtitleItem) {
	cacheDir := filepath.Join(s.dataDir, "subtitle-cache")
	_ = os.MkdirAll(cacheDir, 0755)
	cacheKey := md5Hash(filePath)
	cachePath := filepath.Join(cacheDir, cacheKey+".json")
	b, err := json.Marshal(subs)
	if err != nil {
		loggerOf(s.app).Error("cache subtitles: marshal", "filePath", filePath, "error", err)
		return
	}
	_ = os.WriteFile(cachePath, b, 0644)
}

// GetCachedSubtitles 返回字幕缓存，未命中时返回 nil。
func (s *LibraryService) GetCachedSubtitles(filePath string) []SubtitleItem {
	cacheDir := filepath.Join(s.dataDir, "subtitle-cache")
	cacheKey := md5Hash(filePath)
	cachePath := filepath.Join(cacheDir, cacheKey+".json")
	data, err := os.ReadFile(cachePath)
	if err != nil {
		return nil
	}
	var subs []SubtitleItem
	if err := json.Unmarshal(data, &subs); err != nil {
		return nil
	}
	return subs
}
