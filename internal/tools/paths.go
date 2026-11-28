// Package tools 提供内置命令行工具（ffmpeg / yt-dlp / whisper-sidecar）的
// 路径查找与调用。GUI 服务与 tool 子命令共用这里的实现，避免两套查找逻辑漂移。
package tools

import (
	"os"
	"os/exec"
	"path/filepath"
	goRuntime "runtime"
)

// ExecutableDir 返回当前可执行文件所在目录，取不到时返回空字符串。
// 通过 PATH 软链调用时必须解析到真实二进制，否则 macOS 上会去软链所在目录
// 找 Resources，导致已注册命令找不到 sidecar。
func ExecutableDir() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	return executableDirFrom(exe)
}

// executableDirFrom 是 ExecutableDir 的路径解析部分，便于测试软链场景。
func executableDirFrom(exe string) string {
	if real, err := filepath.EvalSymlinks(exe); err == nil {
		exe = real
	}
	return filepath.Dir(exe)
}

// FirstExisting 返回第一个存在的路径，全部不存在时返回空字符串。
func FirstExisting(locations []string) string {
	for _, p := range locations {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

// BundleResources 返回 macOS .app 包内的 Resources 目录，非 bundle 布局返回空字符串。
func BundleResources() string {
	exeDir := ExecutableDir()
	if exeDir == "" {
		return ""
	}
	res := filepath.Join(filepath.Dir(exeDir), "Resources")
	if _, err := os.Stat(res); err == nil {
		return res
	}
	return ""
}

// FindFFmpeg 返回 ffmpeg 可执行文件路径，找不到返回空字符串。PATH 优先。
func FindFFmpeg(dataDir string) string {
	if p, err := exec.LookPath("ffmpeg"); err == nil {
		return p
	}
	return FirstExisting(FFmpegCandidates(dataDir, ExecutableDir(), BundleResources(), goRuntime.GOOS))
}

// FFmpegCandidates 返回除 PATH 之外的 ffmpeg 查找路径。
// Windows 安装包把 ffmpeg.exe 放在 exe 同目录，因此 exe 目录排在相对路径之前，
// 避免从任意工作目录启动时找到错误的二进制。
func FFmpegCandidates(dataDir, exeDir, bundlePath, goos string) []string {
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

// FindYtDlp 返回 yt-dlp 可执行文件路径，找不到返回空字符串。PATH 优先。
func FindYtDlp(dataDir string) string {
	if p, err := exec.LookPath("yt-dlp"); err == nil {
		return p
	}
	return FirstExisting(YtDlpCandidates(dataDir, ExecutableDir(), BundleResources(), goRuntime.GOOS))
}

// YtDlpCandidates 返回除 PATH 之外的 yt-dlp 查找路径。
// Windows 安装包把 yt-dlp.exe 放在 exe 同目录，因此 exe 目录排在相对路径之前。
func YtDlpCandidates(dataDir, exeDir, bundlePath, goos string) []string {
	if goos == "darwin" {
		locations := []string{
			"/opt/homebrew/bin/yt-dlp",
			"/usr/local/bin/yt-dlp",
			"/usr/bin/yt-dlp",
			filepath.Join(dataDir, "sidecar", "yt-dlp"),
			"sidecar/yt-dlp",
			"./sidecar/yt-dlp",
		}
		locations = append([]string{"../sidecar/yt-dlp"}, locations...)
		if bundlePath != "" {
			locations = append([]string{filepath.Join(bundlePath, "yt-dlp")}, locations...)
		}
		return locations
	}

	locations := []string{filepath.Join(dataDir, "sidecar", "yt-dlp.exe")}
	if exeDir != "" {
		locations = append(locations, filepath.Join(exeDir, "yt-dlp.exe"))
	}
	return append(locations,
		"sidecar/yt-dlp.exe",
		"./sidecar/yt-dlp.exe",
	)
}

// FindWhisper 返回 whisper-sidecar 可执行文件路径，找不到返回空字符串。
// 与另外两个工具不同，这里不查 PATH，避免误用系统上其它 whisper 实现。
func FindWhisper(dataDir string) string {
	return FirstExisting(WhisperCandidates(dataDir, ExecutableDir(), BundleResources(), goRuntime.GOOS))
}

// WhisperCandidates 返回 whisper-sidecar 的查找路径。
// Windows 安装包把 whisper-sidecar.exe 放在 exe 同目录，因此 exe 目录排在相对路径之前。
func WhisperCandidates(dataDir, exeDir, bundlePath, goos string) []string {
	if goos == "darwin" {
		locations := []string{
			filepath.Join(dataDir, "sidecar", "whisper-sidecar"),
			"sidecar/whisper-sidecar",
			"./sidecar/whisper-sidecar",
			filepath.Join(dataDir, "sidecar", "whisper-sidecar.exe"),
		}
		locations = append([]string{"../sidecar/whisper-sidecar"}, locations...)
		if bundlePath != "" {
			locations = append([]string{filepath.Join(bundlePath, "whisper-sidecar")}, locations...)
		}
		return locations
	}

	locations := []string{
		filepath.Join(dataDir, "sidecar", "whisper-sidecar.exe"),
		filepath.Join(dataDir, "sidecar", "whisper-sidecar"),
	}
	if exeDir != "" {
		locations = append(locations,
			filepath.Join(exeDir, "whisper-sidecar.exe"),
			filepath.Join(exeDir, "whisper-sidecar"),
		)
	}
	return append(locations,
		"sidecar/whisper-sidecar.exe",
		"sidecar/whisper-sidecar",
		"./sidecar/whisper-sidecar.exe",
		"./sidecar/whisper-sidecar",
	)
}
