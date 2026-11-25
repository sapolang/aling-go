package tts

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

const (
	piperReleaseBase = "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/"

	// maxInstallFileSize 限制从压缩包中解压的单个文件，避免压缩炸弹占满磁盘。
	maxInstallFileSize = int64(512 << 20)
)

// voiceDownload 描述一个可安装的本地 Piper 语音。
// SHA256 填入后，下载完成会校验；留空则跳过（调试期用）。
type voiceDownload struct {
	ID     string
	Name   string
	Path   string
	SHA256 string
}

// localVoiceCatalog 是当前仓库内置的三种英文 Piper medium 模型。
// 每个模型的 SHA256 可从 HuggingFace rhasspy/piper-voices 仓库的 LFS 指针或
// model_card.json 中获取，固定版本后填入即可防供应链污染。
var localVoiceCatalog = []voiceDownload{
	{ID: "en_US-lessac-medium", Name: "Lessac · 美式女声（推荐）", Path: "en/en_US/lessac/medium/en_US-lessac-medium.onnx"},
	{ID: "en_US-amy-medium", Name: "Amy · 美式女声", Path: "en/en_US/amy/medium/en_US-amy-medium.onnx"},
	{ID: "en_GB-alan-medium", Name: "Alan · 英式男声", Path: "en/en_GB/alan/medium/en_GB-alan-medium.onnx"},
}

// piperEngineHashes 是 Piper 引擎各平台压缩包的 SHA256。
// key 为 piperAssetForPlatform 返回的 filename，固定版本后填入即可防下载源被替换。
var piperEngineHashes = map[string]string{
	// TODO: 从 GitHub Releases 下载各平台压缩包后运行 shasum -a 256 填入
}

// installLocal 下载 Piper 可执行文件与指定语音模型。已存在的部分会跳过，
// 因此重复点击安装是安全的。
func (s *Service) installLocal(ctx context.Context, voice string, emit func(InstallProgress)) error {
	spec, ok := findVoiceSpec(voice)
	if !ok {
		return fmt.Errorf("不支持的离线发音：%s", voice)
	}

	if s.local.binaryPath() == "" {
		emit(InstallProgress{Progress: 1, Status: "binary", Message: "正在下载本地语音引擎…", Voice: spec.ID})
		assetURL, archiveName, err := piperAssetForPlatform()
		if err != nil {
			return err
		}
		wantHash := piperEngineHashes[archiveName]
		archivePath := filepath.Join(s.local.ttsDir(), "downloads", archiveName)
		if err := downloadToFile(ctx, assetURL, archivePath, wantHash, func(pct int) {
			emit(InstallProgress{Progress: 1 + pct*44/100, Status: "binary", Message: fmt.Sprintf("本地语音引擎 %d%%", pct), Voice: spec.ID})
		}); err != nil {
			return fmt.Errorf("下载本地语音引擎失败：%w", err)
		}
		defer func() { _ = os.Remove(archivePath) }()
		emit(InstallProgress{Progress: 46, Status: "extract", Message: "正在解压本地语音引擎…", Voice: spec.ID})
		target := filepath.Join(s.local.ttsDir(), "piper-dist")
		if err := extractArchive(archivePath, target); err != nil {
			return fmt.Errorf("解压本地语音引擎失败：%w", err)
		}
		if binary := s.local.binaryPath(); binary == "" {
			return fmt.Errorf("解压完成但没有找到 piper 可执行文件")
		} else if runtime.GOOS != "windows" {
			//nolint:gosec // 安装的语音引擎是可执行文件，必须保留执行权限。
			_ = os.Chmod(binary, 0o755)
		}
	}

	if s.local.findModelPath(spec.ID) == "" {
		modelDir := filepath.Join(s.local.ttsDir(), "models")
		if err := os.MkdirAll(modelDir, 0o755); err != nil {
			return err
		}
		baseURL := "https://huggingface.co/rhasspy/piper-voices/resolve/main/" + spec.Path
		modelPath := filepath.Join(modelDir, spec.ID+".onnx")
		configPath := modelPath + ".json"

		emit(InstallProgress{Progress: 50, Status: "model", Message: "正在下载语音模型…", Voice: spec.ID})
		if err := downloadToFile(ctx, baseURL, modelPath, spec.SHA256, func(pct int) {
			emit(InstallProgress{Progress: 50 + pct*30/100, Status: "model", Message: fmt.Sprintf("语音模型 %d%%", pct), Voice: spec.ID})
		}); err != nil {
			return fmt.Errorf("下载语音模型失败：%w", err)
		}
		emit(InstallProgress{Progress: 82, Status: "model", Message: "正在下载模型配置…", Voice: spec.ID})
		if err := downloadToFile(ctx, baseURL+".json", configPath, "", func(pct int) {
			emit(InstallProgress{Progress: 82 + pct*16/100, Status: "model", Message: fmt.Sprintf("模型配置 %d%%", pct), Voice: spec.ID})
		}); err != nil {
			return fmt.Errorf("下载模型配置失败：%w", err)
		}
	}

	emit(InstallProgress{Progress: 100, Status: "done", Message: "离线语音已就绪", Voice: spec.ID})
	return nil
}

func findVoiceSpec(id string) (voiceDownload, bool) {
	if id == "" {
		id = DefaultLocalVoice
	}
	for _, spec := range localVoiceCatalog {
		if spec.ID == id {
			return spec, true
		}
	}
	return voiceDownload{}, false
}

func piperAssetForPlatform() (url, filename string, err error) {
	var asset string
	switch runtime.GOOS {
	case "darwin":
		switch runtime.GOARCH {
		case "arm64":
			asset = "piper_macos_aarch64.tar.gz"
		case "amd64":
			asset = "piper_macos_x64.tar.gz"
		}
	case "windows":
		asset = "piper_windows_amd64.zip"
	case "linux":
		switch runtime.GOARCH {
		case "amd64":
			asset = "piper_linux_x86_64.tar.gz"
		case "arm64":
			asset = "piper_linux_aarch64.tar.gz"
		case "arm":
			asset = "piper_linux_armv7l.tar.gz"
		}
	}
	if asset == "" {
		return "", "", fmt.Errorf("当前平台 %s/%s 暂不提供自动安装的 Piper 版本", runtime.GOOS, runtime.GOARCH)
	}
	return piperReleaseBase + asset, asset, nil
}

// downloadToFile 先写临时文件再原子改名，失败时不会留下半截模型。
// 支持 HuggingFace → hf-mirror 与 GitHub → ghproxy 两级镜像回退。
// wantHash 非空时，下载完成会计算 SHA256 与期望值比对，防止供应链污染；
// 空字符串则跳过校验。
func downloadToFile(ctx context.Context, url, dst, wantHash string, onProgress func(int)) error {
	err := downloadOnce(ctx, url, dst, wantHash, onProgress)
	if err == nil {
		return nil
	}
	// HuggingFace 失败切 hf-mirror
	if strings.HasPrefix(url, "https://huggingface.co/") {
		mirror := strings.Replace(url, "https://huggingface.co/", "https://hf-mirror.com/", 1)
		if mirrorErr := downloadOnce(ctx, mirror, dst, wantHash, onProgress); mirrorErr == nil {
			return nil
		}
	}
	// GitHub Releases 失败切 ghproxy
	if strings.HasPrefix(url, "https://github.com/") {
		mirror := "https://ghproxy.com/" + url
		if mirrorErr := downloadOnce(ctx, mirror, dst, wantHash, onProgress); mirrorErr == nil {
			return nil
		}
	}
	return err
}

func downloadOnce(ctx context.Context, url, dst, wantHash string, onProgress func(int)) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(dst), ".download-*.tmp")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer func() { _ = os.Remove(tmpPath) }()

	h := sha256.New()
	written := int64(0)
	lastPct := -1
	buf := make([]byte, 128*1024)
	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			if _, err := tmp.Write(buf[:n]); err != nil {
				_ = tmp.Close()
				return err
			}
			if _, err := h.Write(buf[:n]); err != nil {
				_ = tmp.Close()
				return err
			}
			written += int64(n)
			if resp.ContentLength > 0 {
				pct := int(written * 100 / resp.ContentLength)
				if pct != lastPct {
					lastPct = pct
					onProgress(pct)
				}
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			_ = tmp.Close()
			return readErr
		}
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if resp.ContentLength > 0 && written != resp.ContentLength {
		return fmt.Errorf("下载不完整：%d/%d 字节", written, resp.ContentLength)
	}
	if wantHash != "" {
		if got := hex.EncodeToString(h.Sum(nil)); got != wantHash {
			return fmt.Errorf("SHA256 校验失败：got %s, want %s", got, wantHash)
		}
	}
	return os.Rename(tmpPath, dst)
}

func extractArchive(archivePath, targetDir string) error {
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		return err
	}
	lower := strings.ToLower(archivePath)
	switch {
	case strings.HasSuffix(lower, ".zip"):
		return extractZip(archivePath, targetDir)
	case strings.HasSuffix(lower, ".tar.gz"), strings.HasSuffix(lower, ".tgz"):
		return extractTarGz(archivePath, targetDir)
	default:
		return fmt.Errorf("不支持的压缩格式：%s", filepath.Base(archivePath))
	}
}

func extractTarGz(archivePath, targetDir string) error {
	file, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer file.Close()
	gz, err := gzip.NewReader(file)
	if err != nil {
		return err
	}
	defer func() { _ = gz.Close() }()

	reader := tar.NewReader(gz)
	for {
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
		target, err := safeArchiveTarget(targetDir, header.Name)
		if err != nil {
			return err
		}
		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			mode := os.FileMode(header.Mode & 0o777)
			if mode == 0 {
				mode = 0o644
			}
			out, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode)
			if err != nil {
				return err
			}
			written, err := io.Copy(out, io.LimitReader(reader, maxInstallFileSize+1))
			if err != nil {
				_ = out.Close()
				return err
			}
			if written > maxInstallFileSize {
				_ = out.Close()
				return fmt.Errorf("压缩包内文件过大：%s", header.Name)
			}
			if err := out.Close(); err != nil {
				return err
			}
		}
	}
}

func extractZip(archivePath, targetDir string) error {
	reader, err := zip.OpenReader(archivePath)
	if err != nil {
		return err
	}
	defer func() { _ = reader.Close() }()

	for _, entry := range reader.File {
		target, err := safeArchiveTarget(targetDir, entry.Name)
		if err != nil {
			return err
		}
		if entry.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		src, err := entry.Open()
		if err != nil {
			return err
		}
		mode := entry.Mode()
		if mode == 0 {
			mode = 0o644
		}
		out, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode)
		if err != nil {
			_ = src.Close()
			return err
		}
		written, err := io.Copy(out, io.LimitReader(src, maxInstallFileSize+1))
		if err != nil {
			_ = src.Close()
			_ = out.Close()
			return err
		}
		if written > maxInstallFileSize {
			_ = src.Close()
			_ = out.Close()
			return fmt.Errorf("压缩包内文件过大：%s", entry.Name)
		}
		_ = src.Close()
		if err := out.Close(); err != nil {
			return err
		}
	}
	return nil
}

func safeArchiveTarget(root, name string) (string, error) {
	cleaned := filepath.Clean(strings.ReplaceAll(name, "\\", "/"))
	if cleaned == "." || cleaned == "" {
		return filepath.Clean(root), nil
	}
	if filepath.IsAbs(cleaned) || cleaned == ".." || strings.HasPrefix(cleaned, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("压缩包包含非法路径：%s", name)
	}
	target := filepath.Join(root, cleaned)
	rootClean := filepath.Clean(root) + string(filepath.Separator)
	if !strings.HasPrefix(filepath.Clean(target), rootClean) {
		return "", fmt.Errorf("压缩包包含非法路径：%s", name)
	}
	return target, nil
}
