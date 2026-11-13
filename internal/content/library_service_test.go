package content

import (
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
