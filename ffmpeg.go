package main

import (
	"encoding/base64"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	goRuntime "runtime"
)

func (a *App) GetVideoThumbnail(filePath string) string {
	cacheDir := filepath.Join(a.dataDir, "aling", "thumbnails")
	os.MkdirAll(cacheDir, 0755)
	cacheKey := md5Hash(filePath)
	thumbPath := filepath.Join(cacheDir, cacheKey+".jpg")

	if data, err := os.ReadFile(thumbPath); err == nil {
		return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(data)
	}

	ffmpeg := a.findFFmpeg()
	if ffmpeg == "" {
		return ""
	}

	cmd := exec.Command(ffmpeg, "-i", filePath, "-ss", "00:00:05", "-vframes", "1", "-q:v", "2", "-update", "1", thumbPath)
	cmd.Run()

	data, err := os.ReadFile(thumbPath)
	if err != nil {
		return ""
	}
	return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(data)
}

func (a *App) findFFmpeg() string {
	fmt.Println("DEBUG findFFmpeg: exec.LookPath")
	if p, err := exec.LookPath("ffmpeg"); err == nil {
		fmt.Println("DEBUG findFFmpeg: found in PATH:", p)
		return p
	}

	locations := []string{
		"/usr/local/bin/ffmpeg",
		"/opt/homebrew/bin/ffmpeg",
		"/usr/bin/ffmpeg",
		filepath.Join(a.dataDir, "sidecar", "ffmpeg"),
		filepath.Join(a.dataDir, "sidecar", "ffmpeg.exe"),
		"sidecar/ffmpeg",
		"sidecar/ffmpeg.exe",
		"./sidecar/ffmpeg",
		"./sidecar/ffmpeg.exe",
	}
	if goRuntime.GOOS == "darwin" {
		locations = append([]string{"../sidecar/ffmpeg"}, locations...)
		if bundlePath := a.bundleResources(); bundlePath != "" {
			locations = append([]string{filepath.Join(bundlePath, "ffmpeg")}, locations...)
		}
	}
	for _, p := range locations {
		fmt.Println("DEBUG findFFmpeg: checking", p)
		if _, err := os.Stat(p); err == nil {
			fmt.Println("DEBUG findFFmpeg: found at", p)
			return p
		}
	}
	fmt.Println("DEBUG findFFmpeg: NOT FOUND")
	return ""
}

func (a *App) extractAudio(filePath string) string {
	fmt.Println("DEBUG extractAudio: start, filePath=", filePath)
	audioDir := filepath.Join(a.dataDir, "aling", "temp-audio")
	os.MkdirAll(audioDir, 0755)
	outPath := filepath.Join(audioDir, md5Hash(filePath)+".wav")

	ffmpeg := a.findFFmpeg()
	fmt.Println("DEBUG extractAudio: ffmpeg=", ffmpeg)
	if ffmpeg == "" {
		fmt.Println("DEBUG extractAudio: ffmpeg not found")
		return ""
	}

	if fi, err := os.Stat(outPath); err == nil && fi.Size() > 0 {
		fmt.Println("DEBUG extractAudio: cached, returning", outPath)
		return outPath
	}

	cmd := exec.Command(ffmpeg, "-i", filePath, "-ar", "16000", "-ac", "1", "-sample_fmt", "s16", outPath)
	fmt.Println("DEBUG extractAudio: running", cmd.String())
	out, err := cmd.CombinedOutput()
	fmt.Println("DEBUG extractAudio: output:", string(out))
	if err != nil {
		fmt.Println("DEBUG extractAudio: error:", err)
		os.Remove(outPath)
		return ""
	}

	fi, _ := os.Stat(outPath)
	if fi == nil || fi.Size() == 0 {
		fmt.Println("DEBUG extractAudio: output file is empty after success")
		os.Remove(outPath)
		return ""
	}
	return outPath
}
