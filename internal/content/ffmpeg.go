package content

import (
	"log/slog"
	"os"
	"path/filepath"

	"aling-go/internal/proc"
	"aling-go/internal/tools"
)

func findFFmpeg(dataDir string, logger *slog.Logger) string {
	p := tools.FindFFmpeg(dataDir)
	if p != "" {
		logger.Debug("findFFmpeg found", "path", p)
	} else {
		logger.Debug("findFFmpeg not found")
	}
	return p
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

	cmd := proc.Command(ffmpeg, "-i", filePath, "-ar", "16000", "-ac", "1", "-sample_fmt", "s16", outPath)
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
