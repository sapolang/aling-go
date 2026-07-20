package main

import (
	"crypto/md5"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

func (a *App) recentFilePath() string {
	return filepath.Join(a.dataDir, "recent.json")
}

func (a *App) RecentList() string {
	data, err := os.ReadFile(a.recentFilePath())
	if err != nil {
		return "[]"
	}
	return string(data)
}

func (a *App) RecentAdd(filePath string) string {
	var files []RecentFile
	data, err := os.ReadFile(a.recentFilePath())
	if err == nil {
		json.Unmarshal(data, &files)
	}

	updated := []RecentFile{{Path: filePath, Name: filepath.Base(filePath)}}
	for _, f := range files {
		if f.Path != filePath {
			updated = append(updated, f)
		}
	}
	if len(updated) > 50 {
		updated = updated[:50]
	}

	b, _ := json.Marshal(updated)
	os.WriteFile(a.recentFilePath(), b, 0644)
	return string(b)
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
