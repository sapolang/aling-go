package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

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

func (a *App) libraryPath() string {
	return filepath.Join(a.dataDir, "library.json")
}

func (a *App) readLibrary() LibraryData {
	var lib LibraryData
	data, err := os.ReadFile(a.libraryPath())
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

func (a *App) writeLibrary(lib LibraryData) {
	b, err := json.Marshal(lib)
	if err != nil {
		fmt.Fprintf(os.Stderr, "writeLibrary: marshal error: %v\n", err)
		return
	}
	if err := os.WriteFile(a.libraryPath(), b, 0644); err != nil {
		fmt.Fprintf(os.Stderr, "writeLibrary: write error: %v\n", err)
	}
}

func (a *App) LibraryList() string {
	lib := a.readLibrary()
	b, _ := json.Marshal(lib)
	return string(b)
}

func (a *App) LibraryImport(category, folderID string) string {
	var filters []wailsRuntime.FileFilter
	switch category {
	case "video":
		filters = []wailsRuntime.FileFilter{
			{DisplayName: "视频文件", Pattern: "*.mp4;*.mkv;*.avi;*.mov;*.webm;*.flv;*.wmv"},
		}
	case "audio":
		filters = []wailsRuntime.FileFilter{
			{DisplayName: "音频文件", Pattern: "*.mp3;*.wav;*.m4a;*.ogg;*.flac;*.aac;*.wma"},
		}
	case "pdf":
		filters = []wailsRuntime.FileFilter{
			{DisplayName: "PDF文件", Pattern: "*.pdf"},
		}
	default:
		filters = []wailsRuntime.FileFilter{
			{DisplayName: "媒体文件", Pattern: "*.mp4;*.mkv;*.avi;*.mov;*.webm;*.flv;*.wmv;*.mp3;*.wav;*.m4a;*.ogg;*.flac;*.aac;*.wma;*.pdf"},
		}
	}
	files, err := wailsRuntime.OpenMultipleFilesDialog(a.ctx, wailsRuntime.OpenDialogOptions{Filters: filters})
	if err != nil || len(files) == 0 {
		b, _ := json.Marshal(LibraryImportResult{Files: []LibraryFile{}})
		return string(b)
	}
	lib := a.readLibrary()
	var imported, skipped int
	for _, file := range files {
		if containsFile(lib.Files, file) {
			skipped++
			continue
		}
		if len(lib.Files) >= 200 {
			break
		}
		ftype := detectFileType(file)
		if ftype == "" {
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
	a.writeLibrary(lib)
	b, _ := json.Marshal(LibraryImportResult{Files: lib.Files, Imported: imported, Skipped: skipped})
	return string(b)
}

func containsFile(files []LibraryFile, path string) bool {
	for _, f := range files {
		if f.Path == path {
			return true
		}
	}
	return false
}

func (a *App) LibraryRemove(pathsJSON string) string {
	var paths []string
	if err := json.Unmarshal([]byte(pathsJSON), &paths); err != nil {
		fmt.Fprintf(os.Stderr, "LibraryRemove: unmarshal error: %v\n", err)
		return "[]"
	}
	pathSet := make(map[string]bool, len(paths))
	for _, p := range paths {
		pathSet[p] = true
	}
	lib := a.readLibrary()
	filtered := make([]LibraryFile, 0, len(lib.Files))
	for _, f := range lib.Files {
		if !pathSet[f.Path] {
			filtered = append(filtered, f)
		}
	}
	lib.Files = filtered
	a.writeLibrary(lib)
	b, _ := json.Marshal(lib.Files)
	return string(b)
}

func (a *App) LibraryRename(path, newName string) string {
	lib := a.readLibrary()
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
	a.writeLibrary(lib)
	b, _ := json.Marshal(lib)
	return string(b)
}

func (a *App) LibraryMove(pathsJSON, folderID string) string {
	var paths []string
	if err := json.Unmarshal([]byte(pathsJSON), &paths); err != nil {
		fmt.Fprintf(os.Stderr, "LibraryMove: unmarshal error: %v\n", err)
	}
	pathSet := make(map[string]bool, len(paths))
	for _, p := range paths {
		pathSet[p] = true
	}
	lib := a.readLibrary()
	for i := range lib.Files {
		if pathSet[lib.Files[i].Path] {
			lib.Files[i].FolderID = folderID
		}
	}
	a.writeLibrary(lib)
	b, _ := json.Marshal(lib.Files)
	return string(b)
}

func (a *App) FolderCreate(name, parentID string) string {
	lib := a.readLibrary()
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
	a.writeLibrary(lib)
	b, _ := json.Marshal(lib.Folders)
	return string(b)
}

func (a *App) FolderDelete(id string) string {
	lib := a.readLibrary()
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
	a.writeLibrary(lib)
	b, _ := json.Marshal(lib.Folders)
	return string(b)
}

func (a *App) FolderRename(id, name string) string {
	lib := a.readLibrary()
	for i := range lib.Folders {
		if lib.Folders[i].ID == id {
			lib.Folders[i].Name = name
			break
		}
	}
	a.writeLibrary(lib)
	b, _ := json.Marshal(lib.Folders)
	return string(b)
}
