package content

import (
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"

	goRuntime "runtime"
)

func findFFmpeg(dataDir string, logger *slog.Logger) string {
	if p, err := exec.LookPath("ffmpeg"); err == nil {
		logger.Debug("findFFmpeg found in PATH", "path", p)
		return p
	}

	if p := firstExisting(ffmpegCandidates(dataDir, executableDir(), bundleResources(), goRuntime.GOOS)); p != "" {
		logger.Debug("findFFmpeg found", "path", p)
		return p
	}
	logger.Debug("findFFmpeg not found")
	return ""
}

// ffmpegCandidates 返回除 PATH 之外的 ffmpeg 查找路径。
// Windows 安装包把 ffmpeg.exe 放在 exe 同目录，因此 exe 目录排在相对路径之前，
// 避免从任意工作目录启动时找到错误的二进制。
func ffmpegCandidates(dataDir, exeDir, bundlePath, goos string) []string {
	if goos == "darwin" {
		locations := []string{
			"/usr/local/bin/ffmpeg",
			"/opt/homebrew/bin/ffmpeg",
			"/usr/bin/ffmpeg",
			filepath.Join(dataDir, "sidecar", "ffmpeg"),
			filepath.Join(dataDir, "sidecar", "ffmpeg.exe"),
			"sidecar/ffmpeg",
			"sidecar/ffmpeg.exe",
			"./sidecar/ffmpeg",
			"./sidecar/ffmpeg.exe",
		}
		locations = append([]string{"../sidecar/ffmpeg"}, locations...)
		if bundlePath != "" {
			locations = append([]string{filepath.Join(bundlePath, "ffmpeg")}, locations...)
		}
		return locations
	}

	locations := []string{
		filepath.Join(dataDir, "sidecar", "ffmpeg"),
		filepath.Join(dataDir, "sidecar", "ffmpeg.exe"),
	}
	if exeDir != "" {
		locations = append(locations,
			filepath.Join(exeDir, "ffmpeg.exe"),
			filepath.Join(exeDir, "ffmpeg"),
		)
	}
	return append(locations,
		"sidecar/ffmpeg",
		"sidecar/ffmpeg.exe",
		"./sidecar/ffmpeg",
		"./sidecar/ffmpeg.exe",
	)
}

func extractAudio(dataDir string, logger *slog.Logger, filePath string) string {
	logger.Debug("extractAudio start", "filePath", filePath)
	audioDir := filepath.Join(dataDir, "aling", "temp-audio")
	_ = os.MkdirAll(audioDir, 0755)
	outPath := filepath.Join(audioDir, md5Hash(filePath)+".wav")

	ffmpeg := findFFmpeg(dataDir, logger)
	if ffmpeg == "" {
		logger.Info("extractAudio failed: ffmpeg not found")
		return ""
	}

	if fi, err := os.Stat(outPath); err == nil && fi.Size() > 0 {
		logger.Debug("extractAudio cached, returning", "outPath", outPath)
		return outPath
	}

	cmd := exec.Command(ffmpeg, "-i", filePath, "-ar", "16000", "-ac", "1", "-sample_fmt", "s16", outPath)
	logger.Debug("extractAudio running", "cmd", cmd.String())
	out, err := cmd.CombinedOutput()
	logger.Debug("extractAudio output", "output", string(out))
	if err != nil {
		logger.Debug("extractAudio error", "error", err)
		_ = os.Remove(outPath)
		return ""
	}

	fi, _ := os.Stat(outPath)
	if fi == nil || fi.Size() == 0 {
		logger.Debug("extractAudio output file is empty after success")
		_ = os.Remove(outPath)
		return ""
	}
	return outPath
}
