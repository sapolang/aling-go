package main

import (
	"crypto/md5"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

func (a *App) RecentList() string {
	lib := a.readLibrary()
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

func (a *App) RecentAdd(filePath string) string {
	lib := a.readLibrary()
	found := false
	for i, f := range lib.Files {
		if f.Path == filePath {
			lib.Files = append([]LibraryFile{lib.Files[i]}, append(lib.Files[:i], lib.Files[i+1:]...)...)
			found = true
			break
		}
	}
	if !found {
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
			}}, lib.Files...)
		}
	}
	a.writeLibrary(lib)
	return a.RecentList()
}

func (a *App) CacheSubtitles(filePath, subsJSON string) {
	cacheDir := filepath.Join(a.dataDir, "subtitle-cache")
	os.MkdirAll(cacheDir, 0755)
	cacheKey := md5Hash(filePath)
	cachePath := filepath.Join(cacheDir, cacheKey+".json")
	os.WriteFile(cachePath, []byte(subsJSON), 0644)
}

func (a *App) GetCachedSubtitles(filePath string) string {
	cacheDir := filepath.Join(a.dataDir, "subtitle-cache")
	cacheKey := md5Hash(filePath)
	cachePath := filepath.Join(cacheDir, cacheKey+".json")
	data, err := os.ReadFile(cachePath)
	if err != nil {
		return ""
	}
	return string(data)
}

func md5Hash(s string) string {
	h := md5.New()
	h.Write([]byte(s))
	return fmt.Sprintf("%x", h.Sum(nil))
}
