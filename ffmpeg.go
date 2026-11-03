package main

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
	if goRuntime.GOOS == "darwin" {
		locations = append([]string{"../sidecar/ffmpeg"}, locations...)
		if bundlePath := bundleResources(); bundlePath != "" {
			locations = append([]string{filepath.Join(bundlePath, "ffmpeg")}, locations...)
		}
	}
	for _, p := range locations {
		logger.Debug("findFFmpeg checking", "path", p)
		if _, err := os.Stat(p); err == nil {
			logger.Debug("findFFmpeg found", "path", p)
			return p
		}
	}
	logger.Debug("findFFmpeg not found")
	return ""
}

func extractAudio(dataDir string, logger *slog.Logger, filePath string) string {
	logger.Debug("extractAudio start", "filePath", filePath)
	audioDir := filepath.Join(dataDir, "aling", "temp-audio")
	os.MkdirAll(audioDir, 0755)
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
		os.Remove(outPath)
		return ""
	}

	fi, _ := os.Stat(outPath)
	if fi == nil || fi.Size() == 0 {
		logger.Debug("extractAudio output file is empty after success")
		os.Remove(outPath)
		return ""
	}
	return outPath
}
