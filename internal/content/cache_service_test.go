package content

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func writeCacheFile(t *testing.T, dir, name string, size int) string {
	t.Helper()
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatalf("创建缓存目录失败: %v", err)
	}
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, make([]byte, size), 0644); err != nil {
		t.Fatalf("写入缓存文件失败: %v", err)
	}
	return path
}

func cacheEntryOf(t *testing.T, stats CacheStats, kind string) CacheEntry {
	t.Helper()
	for _, entry := range stats.Entries {
		if entry.Kind == kind {
			return entry
		}
	}
	t.Fatalf("统计结果缺少 %s: %+v", kind, stats.Entries)
	return CacheEntry{}
}

func TestGetCacheStatsCountsFiles(t *testing.T) {
	dataDir := t.TempDir()
	s := &CacheService{dataDir: dataDir}

	writeCacheFile(t, filepath.Join(dataDir, "aling", "thumbnails"), "a.jpg", 100)
	writeCacheFile(t, filepath.Join(dataDir, "aling", "waveforms"), "b.json", 200)
	writeCacheFile(t, filepath.Join(dataDir, "podcasts", "1"), "ep.mp3", 300)

	stats := s.GetCacheStats()
	if entry := cacheEntryOf(t, stats, "thumbnails"); entry.Files != 1 || entry.Size != 100 {
		t.Fatalf("缩略图统计不符: %+v", entry)
	}
	if entry := cacheEntryOf(t, stats, "podcasts"); entry.Files != 1 || entry.Size != 300 {
		t.Fatalf("已下载音频统计不符: %+v", entry)
	}
	// 子目录中的文件也要计入
	if stats.Total != 600 {
		t.Fatalf("总占用 = %d, want 600", stats.Total)
	}
	if entry := cacheEntryOf(t, stats, "transcoded"); entry.Files != 0 || entry.Size != 0 {
		t.Fatalf("空目录统计应为 0: %+v", entry)
	}
}

func TestGetCacheStatsOnlyCountsTemporaryModelFiles(t *testing.T) {
	dataDir := t.TempDir()
	s := &CacheService{dataDir: dataDir}
	modelDir := filepath.Join(dataDir, "whisper-models")
	writeCacheFile(t, modelDir, "ggml-base.bin", 500)
	writeCacheFile(t, modelDir, "ggml-small.bin.tmp", 100)

	entry := cacheEntryOf(t, s.GetCacheStats(), "model-temp")
	if entry.Files != 1 || entry.Size != 100 {
		t.Fatalf("模型下载残留统计不符: %+v", entry)
	}
}

func TestClearCacheRemovesTargetAndKeepsOthers(t *testing.T) {
	dataDir := t.TempDir()
	s := &CacheService{dataDir: dataDir}
	thumbs := filepath.Join(dataDir, "aling", "thumbnails")
	writeCacheFile(t, thumbs, "a.jpg", 100)
	waveforms := filepath.Join(dataDir, "aling", "waveforms")
	writeCacheFile(t, waveforms, "b.json", 200)

	target, ok := findCacheTarget("thumbnails")
	if !ok {
		t.Fatal("未找到 thumbnails 缓存类型")
	}
	freed, err := s.clearTarget(target)
	if err != nil {
		t.Fatalf("清理失败: %v", err)
	}
	if freed != 100 {
		t.Fatalf("释放字节 = %d, want 100", freed)
	}
	if _, statErr := os.Stat(thumbs); !os.IsNotExist(statErr) {
		t.Fatalf("缩略图目录应被删除, err = %v", statErr)
	}
	if _, statErr := os.Stat(filepath.Join(waveforms, "b.json")); statErr != nil {
		t.Fatalf("其他缓存不应被删除: %v", statErr)
	}
}

func TestClearModelTempKeepsModels(t *testing.T) {
	dataDir := t.TempDir()
	s := &CacheService{dataDir: dataDir}
	modelDir := filepath.Join(dataDir, "whisper-models")
	writeCacheFile(t, modelDir, "ggml-base.bin", 500)
	writeCacheFile(t, modelDir, "ggml-base.bin.tmp", 100)

	target, ok := findCacheTarget("model-temp")
	if !ok {
		t.Fatal("未找到 model-temp 缓存类型")
	}
	if _, err := s.clearTarget(target); err != nil {
		t.Fatalf("清理失败: %v", err)
	}
	if _, err := os.Stat(filepath.Join(modelDir, "ggml-base.bin")); err != nil {
		t.Fatalf("已下载的模型不应被删除: %v", err)
	}
	if _, err := os.Stat(filepath.Join(modelDir, "ggml-base.bin.tmp")); !os.IsNotExist(err) {
		t.Fatalf(".tmp 残留应被删除, err = %v", err)
	}
}

func TestClearUnknownCacheKindReturnsError(t *testing.T) {
	s := &CacheService{dataDir: t.TempDir()}
	if res := s.ClearCache("unknown"); res.OK || res.Error == "" {
		t.Fatalf("未知类型应返回错误: %+v", res)
	}
}

func TestCleanupTemporaryRemovesLeftovers(t *testing.T) {
	dataDir := t.TempDir()
	s := &CacheService{dataDir: dataDir}
	writeCacheFile(t, filepath.Join(dataDir, "temp-transcript"), "abc.json", 10)
	writeCacheFile(t, filepath.Join(dataDir, "whisper-models"), "ggml-base.bin.tmp", 10)
	writeCacheFile(t, filepath.Join(dataDir, "whisper-models"), "ggml-base.bin", 10)
	writeCacheFile(t, filepath.Join(dataDir, "transcoded"), "abc.part.mp4", 10)

	if removed := s.cleanupTemporary(); removed != 3 {
		t.Fatalf("清理数量 = %d, want 3", removed)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "whisper-models", "ggml-base.bin")); err != nil {
		t.Fatalf("模型文件不应被删除: %v", err)
	}
}

func TestEnforceTranscodeLimitRemovesOldest(t *testing.T) {
	dataDir := t.TempDir()
	dir := filepath.Join(dataDir, "transcoded")
	oldest := writeCacheFile(t, dir, "oldest.mp4", 100)
	middle := writeCacheFile(t, dir, "middle.mp4", 100)
	keep := writeCacheFile(t, dir, "keep.mp4", 100)
	base := time.Now().Add(-time.Hour)
	for path, offset := range map[string]time.Duration{oldest: 0, middle: time.Minute, keep: 2 * time.Minute} {
		if err := os.Chtimes(path, base.Add(offset), base.Add(offset)); err != nil {
			t.Fatalf("设置时间失败: %v", err)
		}
	}

	// 上限 200 字节：需要删掉一个最旧的文件
	enforceTranscodeLimit(dataDir, keep, 200)
	if _, err := os.Stat(oldest); !os.IsNotExist(err) {
		t.Fatalf("最旧的转码缓存应被删除, err = %v", err)
	}
	for _, path := range []string{middle, keep} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("文件不应被删除 %s: %v", path, err)
		}
	}
}

func TestEnforceTranscodeLimitKeepsNewestWhenOverLimit(t *testing.T) {
	dataDir := t.TempDir()
	dir := filepath.Join(dataDir, "transcoded")
	keep := writeCacheFile(t, dir, "keep.mp4", 300)
	writeCacheFile(t, dir, "other.mp4", 300)

	enforceTranscodeLimit(dataDir, keep, 0)
	if _, err := os.Stat(filepath.Join(dir, "other.mp4")); !os.IsNotExist(err) {
		t.Fatalf("超出上限的其他缓存应被删除, err = %v", err)
	}
	if _, err := os.Stat(keep); err != nil {
		t.Fatalf("刚生成的结果不应被删除: %v", err)
	}
}
