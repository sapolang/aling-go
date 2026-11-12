package content

import (
	"context"
	"crypto/md5"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
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

var videoExts = map[string]bool{"mp4": true, "mkv": true, "avi": true, "mov": true, "webm": true, "flv": true, "wmv": true}
var audioExts = map[string]bool{"mp3": true, "wav": true, "m4a": true, "ogg": true, "flac": true, "aac": true, "wma": true}
var pdfExts = map[string]bool{"pdf": true}

func detectFileType(name string) string {
	ext := strings.TrimPrefix(strings.ToLower(filepath.Ext(name)), ".")
	if videoExts[ext] {
		return "video"
	}
	if audioExts[ext] {
		return "audio"
	}
	if pdfExts[ext] {
		return "pdf"
	}
	return ""
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
}

func NewLibraryService(app *application.App, dataDir string) *LibraryService {
	return &LibraryService{app: app, dataDir: dataDir}
}

func (s *LibraryService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	return nil
}
func (s *LibraryService) ServiceShutdown() error { return nil }

func (s *LibraryService) libraryPath() string {
	return filepath.Join(s.dataDir, "library.json")
}

func (s *LibraryService) readLibrary() LibraryData {
	var lib LibraryData
	data, err := os.ReadFile(s.libraryPath())
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
		fmt.Fprintf(os.Stderr, "writeLibrary: marshal error: %v\n", err)
		return
	}
	if err := os.WriteFile(s.libraryPath(), b, 0644); err != nil {
		fmt.Fprintf(os.Stderr, "writeLibrary: write error: %v\n", err)
	}
}

// --- Library CRUD ---

func (s *LibraryService) LibraryList() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	lib := s.readLibrary()
	b, _ := json.Marshal(lib)
	return string(b)
}

func (s *LibraryService) LibraryImport(category, folderID string) string {
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
		b, _ := json.Marshal(LibraryImportResult{Files: []LibraryFile{}})
		return string(b)
	}
	result := s.ImportFiles(files, folderID)
	b, _ := json.Marshal(result)
	return string(b)
}

// LibraryImportPaths 直接按绝对路径导入文件（拖拽导入等场景），不走文件选择弹窗。
func (s *LibraryService) LibraryImportPaths(pathsJSON, folderID string) string {
	var files []string
	if err := json.Unmarshal([]byte(pathsJSON), &files); err != nil {
		fmt.Fprintf(os.Stderr, "LibraryImportPaths: unmarshal error: %v\n", err)
		b, _ := json.Marshal(LibraryImportResult{Files: []LibraryFile{}})
		return string(b)
	}
	result := s.ImportFiles(files, folderID)
	b, _ := json.Marshal(result)
	return string(b)
}

// ImportFiles 是 importFiles 的公开加锁版本，供其他服务（如 FeedService）调用。
func (s *LibraryService) ImportFiles(files []string, folderID string) LibraryImportResult {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.importFiles(files, folderID)
}

func (s *LibraryService) importFiles(files []string, folderID string) LibraryImportResult {
	lib := s.readLibrary()
	var imported, skipped, dropped int
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
	}
	s.writeLibrary(lib)
	return LibraryImportResult{Files: lib.Files, Imported: imported, Skipped: skipped, Dropped: dropped}
}

func (s *LibraryService) LibraryRemove(pathsJSON string) string {
	var paths []string
	if err := json.Unmarshal([]byte(pathsJSON), &paths); err != nil {
		fmt.Fprintf(os.Stderr, "LibraryRemove: unmarshal error: %v\n", err)
		return "[]"
	}
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
		}
	}
	lib.Files = filtered
	s.writeLibrary(lib)
	b, _ := json.Marshal(lib.Files)
	return string(b)
}

func (s *LibraryService) LibraryRename(path, newName string) string {
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
	b, _ := json.Marshal(lib)
	return string(b)
}

func (s *LibraryService) LibraryMove(pathsJSON, folderID string) string {
	var paths []string
	if err := json.Unmarshal([]byte(pathsJSON), &paths); err != nil {
		fmt.Fprintf(os.Stderr, "LibraryMove: unmarshal error: %v\n", err)
	}
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
	b, _ := json.Marshal(lib.Files)
	return string(b)
}

// --- Folders ---

func (s *LibraryService) FolderCreate(name, parentID string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	lib := s.readLibrary()
	if len(lib.Folders) >= 50 {
		b, _ := json.Marshal(lib.Folders)
		return string(b)
	}
	lib.Folders = append(lib.Folders, Folder{
		ID:        uuid.New().String(),
		Name:      name,
		ParentID:  parentID,
		CreatedAt: time.Now().Format(time.RFC3339),
	})
	s.writeLibrary(lib)
	b, _ := json.Marshal(lib.Folders)
	return string(b)
}

func (s *LibraryService) FolderDelete(id string) string {
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
	b, _ := json.Marshal(lib.Folders)
	return string(b)
}

func (s *LibraryService) FolderRename(id, name string) string {
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
	b, _ := json.Marshal(lib.Folders)
	return string(b)
}

// --- Recent ---

func (s *LibraryService) RecentList() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	lib := s.readLibrary()
	type recentEntry struct {
		Path         string  `json:"path"`
		Name         string  `json:"name"`
		Type         string  `json:"type"`
		LastPosition float64 `json:"lastPosition,omitempty"`
	}
	entries := make([]recentEntry, 0, len(lib.Files))
	for _, f := range lib.Files {
		entries = append(entries, recentEntry{
			Path:         f.Path,
			Name:         f.Name,
			Type:         f.Type,
			LastPosition: f.LastPosition,
		})
	}
	b, _ := json.Marshal(entries)
	return string(b)
}

// RecentGetPosition 返回文件上次播放位置（秒），无记录时返回 "0"
func (s *LibraryService) RecentGetPosition(filePath string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	lib := s.readLibrary()
	for _, f := range lib.Files {
		if f.Path == filePath {
			b, _ := json.Marshal(f.LastPosition)
			return string(b)
		}
	}
	return "0"
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

func (s *LibraryService) RecentAdd(filePath string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	lib := s.readLibrary()
	found := false
	for i, f := range lib.Files {
		if f.Path == filePath {
			lib.Files = append([]LibraryFile{lib.Files[i]}, append(lib.Files[:i], lib.Files[i+1:]...)...)
			found = true
			break
		}
	}
	if !found {
		now := time.Now().Format(time.RFC3339)
		ftype := detectFileType(filePath)
		if ftype != "" {
			if len(lib.Files) >= 200 {
				lib.Files = lib.Files[:199]
			}
			lib.Files = append([]LibraryFile{{
				Path:     filePath,
				Name:     filepath.Base(filePath),
				Type:     ftype,
				FolderID: "",
				AddedAt:  now,
			}}, lib.Files...)
		} else {
			if len(lib.Files) >= 200 {
				lib.Files = lib.Files[:199]
			}
			lib.Files = append([]LibraryFile{{
				Path:     filePath,
				Name:     filepath.Base(filePath),
				Type:     "",
				FolderID: "",
				AddedAt:  now,
			}}, lib.Files...)
		}
	}
	s.writeLibrary(lib)
	// 直接构建返回值，避免调用 RecentList 导致死锁
	type recentEntry struct {
		Path         string  `json:"path"`
		Name         string  `json:"name"`
		Type         string  `json:"type"`
		LastPosition float64 `json:"lastPosition,omitempty"`
	}
	entries := make([]recentEntry, 0, len(lib.Files))
	for _, f := range lib.Files {
		entries = append(entries, recentEntry{
			Path:         f.Path,
			Name:         f.Name,
			Type:         f.Type,
			LastPosition: f.LastPosition,
		})
	}
	b, _ := json.Marshal(entries)
	return string(b)
}

// --- Subtitle cache ---

func (s *LibraryService) CacheSubtitles(filePath, subsJSON string) {
	cacheDir := filepath.Join(s.dataDir, "subtitle-cache")
	_ = os.MkdirAll(cacheDir, 0755)
	cacheKey := md5Hash(filePath)
	cachePath := filepath.Join(cacheDir, cacheKey+".json")
	_ = os.WriteFile(cachePath, []byte(subsJSON), 0644)
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
