package content

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func newTestLibraryService(t *testing.T) *LibraryService {
	t.Helper()
	return &LibraryService{dataDir: t.TempDir()}
}

func writeTestFile(t *testing.T, name string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, []byte("x"), 0644); err != nil {
		t.Fatalf("写入测试文件失败: %v", err)
	}
	return path
}

func TestLibraryImportPathsReturnsTypedResult(t *testing.T) {
	s := newTestLibraryService(t)
	file := writeTestFile(t, "lesson.mp4")

	res := s.LibraryImportPaths([]string{file, file}, "")
	if res.Imported != 1 || res.Skipped != 1 || res.Dropped != 0 {
		t.Fatalf("导入结果不符: %+v", res)
	}

	lib := s.LibraryList()
	if len(lib.Folders) != 0 || len(lib.Files) != 1 {
		t.Fatalf("媒体库内容不符: %+v", lib)
	}
	if lib.Files[0].Name != "lesson.mp4" || lib.Files[0].Type != "video" {
		t.Fatalf("媒体库条目不符: %+v", lib.Files[0])
	}

	recent := s.RecentList()
	if len(recent) != 1 || recent[0].Path != file || recent[0].Type != "video" {
		t.Fatalf("最近列表不符: %+v", recent)
	}
}

func TestLibraryFoldersAndRemove(t *testing.T) {
	s := newTestLibraryService(t)
	file := writeTestFile(t, "movie.mkv")
	s.LibraryImportPaths([]string{file}, "")

	folders := s.FolderCreate("课程", "")
	if len(folders) != 1 {
		t.Fatalf("创建文件夹失败: %+v", folders)
	}
	folderID := folders[0].ID

	files := s.LibraryMove([]string{file}, folderID)
	if len(files) != 1 || files[0].FolderID != folderID {
		t.Fatalf("移动文件失败: %+v", files)
	}

	folders = s.FolderRename(folderID, "新名称")
	if folders[0].Name != "新名称" {
		t.Fatalf("重命名文件夹失败: %+v", folders)
	}

	if remaining := s.LibraryRemove([]string{file}); len(remaining) != 0 {
		t.Fatalf("移除文件失败: %+v", remaining)
	}

	if remaining := s.FolderDelete(folderID); len(remaining) != 0 {
		t.Fatalf("删除文件夹失败: %+v", remaining)
	}
}

func TestRecentPosition(t *testing.T) {
	s := newTestLibraryService(t)
	file := writeTestFile(t, "clip.mp3")
	s.RecentAdd(file)
	s.RecentUpdatePosition(file, 12.5)

	if got := s.RecentGetPosition(file); got != 12.5 {
		t.Fatalf("播放位置不符: %v", got)
	}
	if got := s.RecentGetPosition("/not/exist.mp3"); got != 0 {
		t.Fatalf("未知文件应返回 0，实际 %v", got)
	}
}

func TestRecentAddMovesFileToFrontWithoutLoss(t *testing.T) {
	s := newTestLibraryService(t)
	first := writeTestFile(t, "first.mp4")
	second := writeTestFile(t, "second.pdf")
	third := writeTestFile(t, "third.mp3")
	s.LibraryImportPaths([]string{first, second, third}, "")

	assertOrder := func(label string, got []RecentEntry, want ...string) {
		t.Helper()
		if len(got) != len(want) {
			t.Fatalf("%s: 条目数不符，期望 %d，实际 %+v", label, len(want), got)
		}
		for i := range want {
			if got[i].Path != want[i] {
				t.Fatalf("%s: 第 %d 项不符，期望 %q，实际 %+v", label, i, want[i], got)
			}
		}
	}

	// 重新打开已在首位的文件：旧实现会丢掉它，并把后一项复制成两份。
	assertOrder("首位置顶", s.RecentAdd(first), first, second, third)
	// 重新打开中间项。
	assertOrder("中间置顶", s.RecentAdd(second), second, first, third)

	// 直接检查落盘内容，确认没有重复条目（LibraryList 读取时会去重，不能暴露问题）。
	raw, err := os.ReadFile(filepath.Join(s.dataDir, "library.json"))
	if err != nil {
		t.Fatalf("读取 library.json 失败: %v", err)
	}
	var stored LibraryData
	if err := json.Unmarshal(raw, &stored); err != nil {
		t.Fatalf("解析 library.json 失败: %v", err)
	}
	if len(stored.Files) != 3 {
		t.Fatalf("落盘条目数不符: %+v", stored.Files)
	}
	seen := map[string]bool{}
	for _, f := range stored.Files {
		if seen[f.Path] {
			t.Fatalf("落盘出现重复条目: %s", f.Path)
		}
		seen[f.Path] = true
	}
}

func TestSubtitleCacheRoundTrip(t *testing.T) {
	s := newTestLibraryService(t)
	file := writeTestFile(t, "clip.mp4")

	if got := s.GetCachedSubtitles(file); got != nil {
		t.Fatalf("未缓存时应返回 nil，实际 %+v", got)
	}

	want := []SubtitleItem{{ID: 1, StartTime: 0, EndTime: 1.5, Text: "hello"}}
	s.CacheSubtitles(file, want)

	got := s.GetCachedSubtitles(file)
	if len(got) != 1 || got[0] != want[0] {
		t.Fatalf("字幕缓存读取不符: %+v", got)
	}
}
