package content

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// fakeYtDlp 用临时目录里的 sh 脚本冒充 yt-dlp，并通过 PATH 让 findYtDlp 命中。
// 只用于验证输出流路由，脚本本身不关心传入参数。
func fakeYtDlp(t *testing.T, script string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("伪 yt-dlp 依赖 sh 脚本，Windows 不适用")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "yt-dlp")
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"+script), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)
}

func TestRunYtDlpStreamsProgressFromStdout(t *testing.T) {
	// yt-dlp 的进度行走 stdout；错误行才走 stderr。
	fakeYtDlp(t, `echo "[download]  42.5% of 3.00MiB at 1.00MiB/s"
echo "[download] 100% of 3.00MiB"
`)

	s := &PlatformService{feed: &FeedService{}}
	var got []int
	if err := s.runYtDlp(5*time.Second, func(pct int) { got = append(got, pct) }); err != nil {
		t.Fatalf("runYtDlp error: %v", err)
	}

	want := []int{43, 100}
	if len(got) != len(want) {
		t.Fatalf("progress = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("progress = %v, want %v", got, want)
		}
	}
}

func TestRunYtDlpReportsStderrError(t *testing.T) {
	fakeYtDlp(t, `echo "[download]  10.0% of 3.00MiB"
echo "ERROR: [youtube] boom" >&2
exit 1
`)

	s := &PlatformService{feed: &FeedService{}}
	var got []int
	err := s.runYtDlp(5*time.Second, func(pct int) { got = append(got, pct) })
	if err == nil || !strings.Contains(err.Error(), "ERROR: [youtube] boom") {
		t.Fatalf("error = %v, want stderr message", err)
	}
	if len(got) != 1 || got[0] != 10 {
		t.Fatalf("progress = %v, want [10]", got)
	}
}

// 增量字幕事件 key 必须与前端约定一致：
// YouTube 用 yt:<videoID>，B站用 bili:<bvid>，播客用 podcast:<episodeID>。
func TestSubtitleEventKeyMatchesFrontend(t *testing.T) {
	tests := []struct {
		name string
		got  string
		want string
	}{
		{"youtube", platformSubtitleEventKey(platformYouTube, "dQw4w9WgXcQ"), "yt:dQw4w9WgXcQ"},
		{"bilibili", platformSubtitleEventKey(platformBilibili, "BV1xx411c7mD"), "bili:BV1xx411c7mD"},
		{"podcast", podcastSubtitleEventKey(42), "podcast:42"},
	}
	for _, tt := range tests {
		if tt.got != tt.want {
			t.Errorf("%s key = %q, want %q", tt.name, tt.got, tt.want)
		}
	}
}
