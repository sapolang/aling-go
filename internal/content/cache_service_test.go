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

func TestClearAllCachesClearsEveryCategory(t *testing.T) {
	dataDir := t.TempDir()
	s := &CacheService{dataDir: dataDir}
	writeCacheFile(t, filepath.Join(dataDir, "aling", "thumbnails"), "a.jpg", 100)
	writeCacheFile(t, filepath.Join(dataDir, "aling", "waveforms"), "b.json", 100)
	writeCacheFile(t, filepath.Join(dataDir, "transcoded"), "c.mp4", 100)
	writeCacheFile(t, filepath.Join(dataDir, "subtitle-cache"), "d.json", 100)
	writeCacheFile(t, filepath.Join(dataDir, "temp-transcript"), "e.json", 100)
	writeCacheFile(t, filepath.Join(dataDir, "aling", "temp-audio", "online-abc"), "f.wav", 100)
	writeCacheFile(t, filepath.Join(dataDir, "whisper-models"), "f.bin.tmp", 100)
	writeCacheFile(t, filepath.Join(dataDir, "whisper-models"), "f.bin", 500)

	res := s.ClearAllCaches()
	if !res.OK || res.Error != "" {
		t.Fatalf("清理全部缓存失败: %+v", res)
	}
	if res.Freed != 700 {
		t.Fatalf("释放字节 = %d, want 700", res.Freed)
	}
	for _, dir := range []string{
		filepath.Join(dataDir, "aling", "thumbnails"),
		filepath.Join(dataDir, "aling", "waveforms"),
		filepath.Join(dataDir, "transcoded"),
		filepath.Join(dataDir, "subtitle-cache"),
		filepath.Join(dataDir, "temp-transcript"),
		filepath.Join(dataDir, "aling", "temp-audio"),
	} {
		if _, err := os.Stat(dir); !os.IsNotExist(err) {
			t.Fatalf("%s 应被删除, err = %v", dir, err)
		}
	}
	if _, err := os.Stat(filepath.Join(dataDir, "whisper-models", "f.bin.tmp")); !os.IsNotExist(err) {
		t.Fatalf("模型下载残留应被删除, err = %v", err)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "whisper-models", "f.bin")); err != nil {
		t.Fatalf("已下载的模型不应被删除: %v", err)
	}
}

func TestClearPodcastsRemovesLibraryEntriesAndResetsLocalPaths(t *testing.T) {
	db := setupFeedTestDB(t)
	dataDir := t.TempDir()
	episodePath := writeCacheFile(t, filepath.Join(dataDir, "podcasts", "1"), "ep.mp3", 300)
	otherPath := writeCacheFile(t, filepath.Join(dataDir, "transcoded"), "keep.mp4", 100)

	library := &LibraryService{dataDir: dataDir}
	library.writeLibrary(LibraryData{Files: []LibraryFile{
		{Path: episodePath, Name: "ep.mp3", Type: "audio"},
		{Path: otherPath, Name: "keep.mp4", Type: "video"},
	}})

	if _, err := db.Exec("INSERT INTO feeds (url) VALUES (?)", "https://example.com/feed.xml"); err != nil {
		t.Fatalf("写入订阅源失败: %v", err)
	}
	if _, err := db.Exec(
		"INSERT INTO feed_episodes (feed_id, guid, local_path) VALUES (1, 'g1', ?)", episodePath,
	); err != nil {
		t.Fatalf("写入节目失败: %v", err)
	}

	target, ok := findCacheTarget("podcasts")
	if !ok {
		t.Fatal("未找到 podcasts 缓存类型")
	}
	s := &CacheService{dataDir: dataDir, library: library}
	freed, err := s.clearTarget(target)
	if err != nil {
		t.Fatalf("清理失败: %v", err)
	}
	if freed != 300 {
		t.Fatalf("释放字节 = %d, want 300", freed)
	}
	if _, statErr := os.Stat(filepath.Join(dataDir, "podcasts")); !os.IsNotExist(statErr) {
		t.Fatalf("播客目录应被删除, err = %v", statErr)
	}

	lib := library.readLibrary()
	if len(lib.Files) != 1 || lib.Files[0].Path != otherPath {
		t.Fatalf("媒体库应只保留非播客条目: %+v", lib.Files)
	}

	var localPath string
	if err := db.QueryRow("SELECT local_path FROM feed_episodes WHERE guid = 'g1'").Scan(&localPath); err != nil {
		t.Fatalf("查询节目失败: %v", err)
	}
	if localPath != "" {
		t.Fatalf("节目本地路径应被清空, got %q", localPath)
	}
}

func TestCleanupTemporaryRemovesLeftovers(t *testing.T) {
	dataDir := t.TempDir()
	s := &CacheService{dataDir: dataDir}
	writeCacheFile(t, filepath.Join(dataDir, "temp-transcript"), "abc.json", 10)
	writeCacheFile(t, filepath.Join(dataDir, "whisper-models"), "ggml-base.bin.tmp", 10)
	writeCacheFile(t, filepath.Join(dataDir, "whisper-models"), "ggml-base.bin", 10)
	writeCacheFile(t, filepath.Join(dataDir, "transcoded"), "abc.part.mp4", 10)
	writeCacheFile(t, filepath.Join(dataDir, "podcasts", "1"), "ep.mp3.part", 10)

	if removed := s.cleanupTemporary(); removed != 4 {
		t.Fatalf("清理数量 = %d, want 4", removed)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "whisper-models", "ggml-base.bin")); err != nil {
		t.Fatalf("模型文件不应被删除: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "podcasts", "1", "ep.mp3.part")); !os.IsNotExist(err) {
		t.Fatalf("中断的播客下载残留应被删除, err = %v", err)
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

func TestCleanupExpiredOnlineAudio(t *testing.T) {
	dataDir := t.TempDir()
	s := &CacheService{dataDir: dataDir}
	root := filepath.Join(dataDir, "aling", "temp-audio")

	stale := filepath.Join(root, "online-stale")
	fresh := filepath.Join(root, "online-fresh")
	other := filepath.Join(root, "custom-cache")
	writeCacheFile(t, stale, "audio-16k.wav", 100)
	writeCacheFile(t, fresh, "audio-16k.wav", 100)
	writeCacheFile(t, other, "x.wav", 100)

	now := time.Now()
	old := now.Add(-8 * 24 * time.Hour)
	if err := os.Chtimes(stale, old, old); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(other, old, old); err != nil {
		t.Fatal(err)
	}

	if removed := s.cleanupExpiredOnlineAudio(now); removed != 1 {
		t.Fatalf("清理目录数 = %d, want 1", removed)
	}
	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Fatalf("过期缓存应被删除: %v", err)
	}
	if _, err := os.Stat(fresh); err != nil {
		t.Fatalf("近期缓存应保留: %v", err)
	}
	if _, err := os.Stat(other); err != nil {
		t.Fatalf("非 online- 目录不应被清理: %v", err)
	}
}

func TestCleanupExpiredOnlineAudioSkipsRefreshedDir(t *testing.T) {
	dataDir := t.TempDir()
	s := &CacheService{dataDir: dataDir}
	dir := filepath.Join(dataDir, "aling", "temp-audio", "online-refreshed")
	writeCacheFile(t, dir, "audio-16k.wav", 100)

	now := time.Now()
	old := now.Add(-30 * 24 * time.Hour)
	if err := os.Chtimes(dir, old, old); err != nil {
		t.Fatal(err)
	}
	// 模拟命中缓存时刷新 mtime
	refreshed := now.Add(-time.Hour)
	if err := os.Chtimes(dir, refreshed, refreshed); err != nil {
		t.Fatal(err)
	}

	if removed := s.cleanupExpiredOnlineAudio(now); removed != 0 {
		t.Fatalf("刚使用过的缓存不应被清理, removed = %d", removed)
	}
	if _, err := os.Stat(filepath.Join(dir, "audio-16k.wav")); err != nil {
		t.Fatalf("缓存文件应保留: %v", err)
	}
}
