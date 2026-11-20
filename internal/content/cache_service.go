package content

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// transcodeCacheMaxBytes 转码缓存总大小上限，超出后按最后访问时间回收
const transcodeCacheMaxBytes int64 = 2 << 30 // 2GB

// CacheEntry 是一类派生缓存的占用情况
type CacheEntry struct {
	Kind  string `json:"kind"`
	Label string `json:"label"`
	Size  int64  `json:"size"`
	Files int    `json:"files"`
}

// CacheStats 汇总数据目录下全部派生缓存的占用
type CacheStats struct {
	Entries []CacheEntry `json:"entries"`
	Total   int64        `json:"total"`
}

// CacheClearResult 返回清理结果与释放的字节数
type CacheClearResult struct {
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
	Freed int64  `json:"freed"`
}

// cacheTarget 描述一类可清理的缓存目录
type cacheTarget struct {
	kind  string
	label string
	// dirs 是相对 dataDir 的目录，清理时整目录删除
	dirs []string
	// onlyTemporary 为 true 时只删除 *.tmp，保留目录内其他文件（如已下载的模型）
	onlyTemporary bool
}

var cacheTargets = []cacheTarget{
	{kind: "thumbnails", label: "视频缩略图", dirs: []string{"aling/thumbnails"}},
	{kind: "waveforms", label: "音频波形", dirs: []string{"aling/waveforms"}},
	{kind: "transcoded", label: "转码文件", dirs: []string{"transcoded"}},
	{kind: "subtitles", label: "字幕缓存", dirs: []string{"subtitle-cache"}},
	{kind: "podcasts", label: "已下载音频", dirs: []string{"podcasts"}},
	{kind: "transcripts", label: "转录临时文件", dirs: []string{"temp-transcript"}},
	{kind: "model-temp", label: "模型下载残留", dirs: []string{"whisper-models"}, onlyTemporary: true},
}

// CacheService 统计数据目录下各类派生缓存的占用，并提供按类别清理的能力。
type CacheService struct {
	app     *application.App
	dataDir string
	library *LibraryService
}

func NewCacheService(app *application.App, dataDir string, library *LibraryService) *CacheService {
	return &CacheService{app: app, dataDir: dataDir, library: library}
}

// ServiceStartup 清理上次异常退出残留的临时文件
func (s *CacheService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	if n := s.cleanupTemporary(); n > 0 {
		loggerOf(s.app).Info("Cleaned temporary cache files", "count", n)
	}
	return nil
}

func (s *CacheService) ServiceShutdown() error { return nil }

// GetCacheStats 统计各缓存目录的文件数与占用空间
func (s *CacheService) GetCacheStats() CacheStats {
	stats := CacheStats{Entries: make([]CacheEntry, 0, len(cacheTargets))}
	for _, target := range cacheTargets {
		entry := CacheEntry{Kind: target.kind, Label: target.label}
		for _, dir := range s.targetDirs(target) {
			walkCacheFiles(dir, target.onlyTemporary, func(_ string, size int64) {
				entry.Size += size
				entry.Files++
			})
		}
		stats.Entries = append(stats.Entries, entry)
		stats.Total += entry.Size
	}
	return stats
}

// ClearCache 清理指定类别的缓存，返回释放的字节数
func (s *CacheService) ClearCache(kind string) CacheClearResult {
	target, ok := findCacheTarget(kind)
	if !ok {
		return CacheClearResult{Error: "未知的缓存类型"}
	}
	freed, err := s.clearTarget(target)
	if err != nil {
		loggerOf(s.app).Warn("Clear cache failed", "kind", kind, "error", err)
		return CacheClearResult{Error: err.Error(), Freed: freed}
	}
	loggerOf(s.app).Info("Cleared cache", "kind", kind, "freed", freed)
	return CacheClearResult{OK: true, Freed: freed}
}

// ClearAllCaches 依次清理全部缓存类别。单个类别失败时不中断，
// 尽量清完其余类别，最后汇总失败原因返回。
func (s *CacheService) ClearAllCaches() CacheClearResult {
	var freed int64
	var failures []string
	for _, target := range cacheTargets {
		n, err := s.clearTarget(target)
		freed += n
		if err != nil {
			loggerOf(s.app).Warn("Clear cache failed", "kind", target.kind, "error", err)
			failures = append(failures, target.label+": "+err.Error())
		}
	}
	if len(failures) > 0 {
		return CacheClearResult{Error: strings.Join(failures, "；"), Freed: freed}
	}
	loggerOf(s.app).Info("Cleared all caches", "freed", freed)
	return CacheClearResult{OK: true, Freed: freed}
}

func (s *CacheService) targetDirs(target cacheTarget) []string {
	dirs := make([]string, 0, len(target.dirs))
	for _, dir := range target.dirs {
		dirs = append(dirs, filepath.Join(s.dataDir, dir))
	}
	return dirs
}

func findCacheTarget(kind string) (cacheTarget, bool) {
	for _, target := range cacheTargets {
		if target.kind == kind {
			return target, true
		}
	}
	return cacheTarget{}, false
}

// clearTarget 删除目标目录（或目录内的临时文件）。删除 podcasts 时一并
// 清理对应的媒体库记录，避免库里留下打不开的条目。
func (s *CacheService) clearTarget(target cacheTarget) (int64, error) {
	var freed int64
	for _, dir := range s.targetDirs(target) {
		if _, err := os.Stat(dir); err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				continue
			}
			return freed, err
		}

		if !target.onlyTemporary {
			var before int64
			var removed []string
			walkCacheFiles(dir, false, func(path string, size int64) {
				removed = append(removed, path)
				before += size
			})
			rmErr := os.RemoveAll(dir)
			// 删除失败时目录里可能还有残留，只把真正删掉的字节计入释放量
			freed += before - dirSize(dir)
			if rmErr != nil {
				return freed, rmErr
			}
			if target.kind == "podcasts" {
				if s.library != nil && len(removed) > 0 {
					s.library.LibraryRemove(removed)
				}
				// 音频已删除，节目上的本地路径要重置，否则播放会指向不存在的文件
				if err := q().ClearAllEpisodeLocalPaths(context.Background()); err != nil {
					loggerOf(s.app).Warn("Reset episode local paths", "error", err)
				}
			}
			continue
		}

		// 只清理临时文件时递归处理，与统计口径保持一致（含子目录）。
		walkCacheFiles(dir, true, func(path string, size int64) {
			if rmErr := os.Remove(path); rmErr == nil {
				freed += size
			}
		})
	}
	return freed, nil
}

// cleanupTemporary 删除上次运行残留的临时产物：转录输出、模型下载中断的
// .tmp、未完成的转码 .part 以及中断的播客下载 .part 文件。
func (s *CacheService) cleanupTemporary() int {
	patterns := []string{
		filepath.Join(s.dataDir, "temp-transcript", "*"),
		filepath.Join(s.dataDir, "whisper-models", "*.tmp"),
		filepath.Join(s.dataDir, "transcoded", "*.part*"),
		filepath.Join(s.dataDir, "podcasts", "*", "*.part"),
	}
	removed := 0
	for _, pattern := range patterns {
		matches, _ := filepath.Glob(pattern)
		for _, path := range matches {
			if info, err := os.Stat(path); err == nil && info.IsDir() {
				continue
			}
			if err := os.Remove(path); err == nil {
				removed++
			}
		}
	}
	return removed
}

// walkCacheFiles 遍历目录下文件（含子目录），onlyTemporary 为 true 时只统计 *.tmp
func walkCacheFiles(dir string, onlyTemporary bool, fn func(path string, size int64)) {
	_ = filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if onlyTemporary && !strings.HasSuffix(d.Name(), ".tmp") {
			return nil
		}
		if info, infoErr := d.Info(); infoErr == nil {
			fn(path, info.Size())
		}
		return nil
	})
}

// dirSize 返回目录下全部文件的总大小，用于扣除删除失败后的残留量。
func dirSize(dir string) int64 {
	var total int64
	walkCacheFiles(dir, false, func(_ string, size int64) { total += size })
	return total
}

// enforceTranscodeLimit 把转码缓存压到上限以内：按最后修改时间从旧到新删除，
// keep 非空时不删除该文件（刚生成的结果）。
func enforceTranscodeLimit(dataDir, keep string, limit int64) {
	dir := filepath.Join(dataDir, "transcoded")
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	type cacheFile struct {
		path string
		size int64
		mod  int64
	}
	files := make([]cacheFile, 0, len(entries))
	var total int64
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		info, infoErr := entry.Info()
		if infoErr != nil {
			continue
		}
		files = append(files, cacheFile{
			path: filepath.Join(dir, entry.Name()),
			size: info.Size(),
			mod:  info.ModTime().UnixNano(),
		})
		total += info.Size()
	}
	if total <= limit {
		return
	}
	sort.Slice(files, func(i, j int) bool { return files[i].mod < files[j].mod })
	for _, file := range files {
		if total <= limit {
			return
		}
		if file.path == keep {
			continue
		}
		if err := os.Remove(file.path); err == nil {
			total -= file.size
		}
	}
}
