package tools

import (
	"os"
	"path/filepath"
	"testing"
)

func indexOfPath(paths []string, want string) int {
	for i, p := range paths {
		if p == want {
			return i
		}
	}
	return -1
}

// Windows 安装包把 ffmpeg.exe 放在 exe 同目录，查找列表必须包含该路径，
// 且排在相对路径之前，避免从任意工作目录启动时命中错误的二进制。
func TestFFmpegCandidatesPreferExeDirOverRelativePaths(t *testing.T) {
	exeDir := t.TempDir()
	exePath := filepath.Join(exeDir, "ffmpeg.exe")

	candidates := FFmpegCandidates("/data", exeDir, "", "windows")
	exeIdx := indexOfPath(candidates, exePath)
	if exeIdx < 0 {
		t.Fatalf("候选列表缺少 exe 目录路径 %q: %v", exePath, candidates)
	}
	relIdx := indexOfPath(candidates, "sidecar/ffmpeg.exe")
	if relIdx < 0 {
		t.Fatalf("候选列表缺少相对路径 sidecar/ffmpeg.exe: %v", candidates)
	}
	if exeIdx > relIdx {
		t.Fatalf("exe 目录应排在相对路径之前: %v", candidates)
	}
}

func TestFirstExistingFindsFFmpegInExeDir(t *testing.T) {
	exeDir := t.TempDir()
	want := filepath.Join(exeDir, "ffmpeg.exe")
	if err := os.WriteFile(want, []byte("fake"), 0644); err != nil {
		t.Fatal(err)
	}

	got := FirstExisting(FFmpegCandidates(filepath.Join(t.TempDir(), "data"), exeDir, "", "windows"))
	if got != want {
		t.Fatalf("FirstExisting = %q, want %q", got, want)
	}
}

func TestWhisperCandidatesFindExeDir(t *testing.T) {
	exeDir := t.TempDir()
	want := filepath.Join(exeDir, "whisper-sidecar.exe")
	if err := os.WriteFile(want, []byte("fake"), 0644); err != nil {
		t.Fatal(err)
	}

	got := FirstExisting(WhisperCandidates(filepath.Join(t.TempDir(), "data"), exeDir, "", "windows"))
	if got != want {
		t.Fatalf("FirstExisting = %q, want %q", got, want)
	}
}

func TestYtDlpCandidatesPreferExeDirOverRelativePaths(t *testing.T) {
	exeDir := t.TempDir()
	exePath := filepath.Join(exeDir, "yt-dlp.exe")

	candidates := YtDlpCandidates("/data", exeDir, "", "windows")
	exeIdx := indexOfPath(candidates, exePath)
	if exeIdx < 0 {
		t.Fatalf("候选列表缺少 exe 目录路径 %q: %v", exePath, candidates)
	}
	relIdx := indexOfPath(candidates, "sidecar/yt-dlp.exe")
	if relIdx < 0 {
		t.Fatalf("候选列表缺少相对路径 sidecar/yt-dlp.exe: %v", candidates)
	}
	if exeIdx > relIdx {
		t.Fatalf("exe 目录应排在相对路径之前: %v", candidates)
	}
}

func TestFirstExistingFindsYtDlpInExeDir(t *testing.T) {
	exeDir := t.TempDir()
	want := filepath.Join(exeDir, "yt-dlp.exe")
	if err := os.WriteFile(want, []byte("fake"), 0644); err != nil {
		t.Fatal(err)
	}

	got := FirstExisting(YtDlpCandidates(filepath.Join(t.TempDir(), "data"), exeDir, "", "windows"))
	if got != want {
		t.Fatalf("FirstExisting = %q, want %q", got, want)
	}
}

// macOS 打包后仍优先从 .app/Contents/Resources 读取 sidecar。
func TestDarwinCandidatesKeepBundleResourcesFirst(t *testing.T) {
	bundlePath := "/Applications/aling-go.app/Contents/Resources"

	ffmpeg := FFmpegCandidates("/data", "/Applications/aling-go.app/Contents/MacOS", bundlePath, "darwin")
	if want := filepath.Join(bundlePath, "ffmpeg"); ffmpeg[0] != want {
		t.Fatalf("ffmpeg 候选首项 = %q, want %q", ffmpeg[0], want)
	}

	whisper := WhisperCandidates("/data", "/Applications/aling-go.app/Contents/MacOS", bundlePath, "darwin")
	if want := filepath.Join(bundlePath, "whisper-sidecar"); whisper[0] != want {
		t.Fatalf("whisper 候选首项 = %q, want %q", whisper[0], want)
	}

	ytDlp := YtDlpCandidates("/data", "/Applications/aling-go.app/Contents/MacOS", bundlePath, "darwin")
	if want := filepath.Join(bundlePath, "yt-dlp"); ytDlp[0] != want {
		t.Fatalf("yt-dlp 候选首项 = %q, want %q", ytDlp[0], want)
	}
}
