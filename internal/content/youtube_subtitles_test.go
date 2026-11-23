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

// 在线音轨缓存按事件 key 固定在同一目录：转录失败后重试要复用已下载的音频，
// 不能因为临时目录名变化而重新下载。
func TestOnlineAudioDirIsStablePerEventKey(t *testing.T) {
	s := &PlatformService{dataDir: t.TempDir()}

	first := s.onlineAudioDir("yt:dQw4w9WgXcQ")
	second := s.onlineAudioDir("yt:dQw4w9WgXcQ")
	other := s.onlineAudioDir("yt:xxxxxxxxxxx")

	if first != second {
		t.Fatalf("同一事件 key 应返回同一目录: %q != %q", first, second)
	}
	if first == other {
		t.Fatalf("不同事件 key 不应共用目录: %q", first)
	}
	if !strings.HasPrefix(first, filepath.Join(s.dataDir, "aling", "temp-audio")) {
		t.Fatalf("缓存目录应位于 temp-audio 下: %q", first)
	}
}

// downloadedAudio 只把 yt-dlp 已完成的音轨当作可复用结果：
// 下载中的 .part、转码后的 wav 以及空文件都不能当作已下载的原始音轨。
func TestDownloadedAudioIgnoresPartialAndTranscoded(t *testing.T) {
	dir := t.TempDir()
	write := func(name string, content string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}

	write("audio.webm.part", "partial")
	write("audio-16k.wav", "wav")
	if got := downloadedAudio(dir); got != "" {
		t.Fatalf("不应把 .part 或 wav 当作已下载音轨: %q", got)
	}

	write("audio.webm", "complete")
	if got := downloadedAudio(dir); got != filepath.Join(dir, "audio.webm") {
		t.Fatalf("应复用已完成的音轨，got %q", got)
	}
}

// 转录成功后只删原始下载音轨，保留 16kHz WAV 供「重新转录」复用；
// 下载中的 .part 应保留以支持续传。
func TestRemoveDownloadedAudioKeepsWavAndPartial(t *testing.T) {
	dir := t.TempDir()
	write := func(name string) string {
		t.Helper()
		path := filepath.Join(dir, name)
		if err := os.WriteFile(path, []byte("x"), 0644); err != nil {
			t.Fatal(err)
		}
		return path
	}

	raw := write("audio.webm")
	part := write("audio.webm.part")
	wav := write("audio-16k.wav")

	removeDownloadedAudio(dir)

	if _, err := os.Stat(raw); !os.IsNotExist(err) {
		t.Fatalf("原始下载音轨应被删除, err = %v", err)
	}
	for name, path := range map[string]string{"WAV": wav, ".part": part} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("%s 不应被删除: %v", name, err)
		}
	}
}
