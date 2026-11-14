package content

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	goRuntime "runtime"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type whisperProgress struct {
	Progress int    `json:"progress"`
	Status   string `json:"status"`
}

var whisperModels = []struct {
	Name   string
	File   string
	Size   string
	SHA256 string
}{
	{"tiny", "ggml-tiny.bin", "75MB", "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21"},
	{"base", "ggml-base.bin", "142MB", "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe"},
	{"small", "ggml-small.bin", "466MB", "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b"},
	{"large", "ggml-large-v3.bin", "3.1GB", "64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2"},
}

// 下载源按优先级排序，逐一尝试；tmp 文件保留以支持断点续传
var whisperModelSources = []struct {
	Name string
	Base string
}{
	{"hf-mirror", "https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main"},
	{"huggingface", "https://huggingface.co/ggerganov/whisper.cpp/resolve/main"},
}

func bundleResources() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	dir := filepath.Dir(filepath.Dir(exe))
	res := filepath.Join(dir, "Resources")
	if _, err := os.Stat(res); err == nil {
		return res
	}
	return ""
}

type WhisperModelInfo struct {
	Name       string `json:"name"`
	File       string `json:"file"`
	Size       string `json:"size"`
	Downloaded bool   `json:"downloaded"`
}

type WhisperDownloadProgress struct {
	Model    string `json:"model"`
	Progress int    `json:"progress"`
}

type WhisperService struct {
	app         *application.App
	dataDir     string
	modelFile   string
	whisperLang string
	gpuDisabled atomic.Bool
	dlMu        sync.Mutex
	dlActive    bool
	dlProgress  int
	dlModel     string
}

func NewWhisperService(app *application.App, dataDir string) *WhisperService {
	s := &WhisperService{
		app:         app,
		dataDir:     dataDir,
		modelFile:   "ggml-tiny.bin",
		whisperLang: "en",
		dlProgress:  -1,
	}
	s.loadWhisperLang()
	s.loadWhisperModel()
	return s
}

func (s *WhisperService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	return nil
}
func (s *WhisperService) ServiceShutdown() error { return nil }

// --- Transcribe ---

// Transcribe 先用 GPU 转录；部分机器上 sidecar 的 Metal 后端初始化会直接 abort
// （ggml_metal_library_compile_all 失败后 op 全为 NONE），此时禁用 GPU 重试一次。
func (s *WhisperService) Transcribe(filePath string) []SubtitleItem {
	s.app.Logger.Debug("Transcribe start", "filePath", filePath)
	wavPath := extractAudio(s.dataDir, s.app.Logger, filePath)
	s.app.Logger.Debug("Transcribe wavPath", "wavPath", wavPath)
	if wavPath == "" {
		s.app.Logger.Debug("Transcribe extractAudio returned empty, using original file")
		wavPath = filePath
	}

	// Metal 后端一旦失败，后续转录直接走 CPU，避免每次都先崩溃并产生一条系统崩溃报告
	if s.gpuDisabled.Load() {
		items, err := s.runWhisper(wavPath, filePath, "-ng")
		if err != nil {
			s.app.Logger.Info("Transcription failed", "error", err)
			return []SubtitleItem{}
		}
		return items
	}

	items, err := s.runWhisper(wavPath, filePath)
	if err != nil {
		s.app.Logger.Info("GPU transcription failed, retrying without GPU", "error", err)
		s.gpuDisabled.Store(true)
		items, err = s.runWhisper(wavPath, filePath, "-ng")
	}
	if err != nil {
		s.app.Logger.Info("Transcription failed", "error", err)
		return []SubtitleItem{}
	}
	return items
}

// runWhisper 执行一次 whisper-sidecar，cacheKey 用于定位输出文件。
func (s *WhisperService) runWhisper(wavPath, cacheKey string, extraArgs ...string) ([]SubtitleItem, error) {
	sidecar := s.findWhisperSidecar()
	if sidecar == "" {
		return nil, fmt.Errorf("whisper sidecar not found, run 'make sidecar' to build it")
	}

	modelPath := s.modelPath()
	outDir := filepath.Join(s.dataDir, "temp-transcript")
	if err := os.MkdirAll(outDir, 0755); err != nil {
		return nil, fmt.Errorf("create transcript dir: %w", err)
	}
	outFile := filepath.Join(outDir, md5Hash(cacheKey))
	// 上一次失败的残留会让下面的读取误判为成功
	_ = os.Remove(outFile + ".json")

	args := []string{"-f", wavPath, "-m", modelPath, "-oj", "-of", outFile, "-pp", "-l", s.whisperLang}
	args = append(args, extraArgs...)
	cmd := exec.Command(sidecar, args...)
	s.app.Logger.Debug("Transcribe cmd", "cmd", cmd.String())
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("read whisper stderr: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start whisper process: %w", err)
	}

	var (
		stderrMu    sync.Mutex
		stderrLines []string
	)
	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			line := scanner.Text()
			stderrMu.Lock()
			stderrLines = append(stderrLines, line)
			stderrMu.Unlock()
			if strings.Contains(line, "%") {
				parts := strings.Fields(line)
				for _, p := range parts {
					if strings.HasSuffix(p, "%") {
						pct := strings.TrimSuffix(p, "%")
						var prog int
						if _, err := fmt.Sscanf(pct, "%d", &prog); err == nil {
							s.app.Event.Emit("whisper:progress",
								whisperProgress{
									Progress: prog,
									Status:   "transcribing",
								})
						}
					}
				}
			}
		}
	}()

	waitErr := cmd.Wait()

	data, err := os.ReadFile(outFile + ".json")
	if err != nil {
		stderrMu.Lock()
		stderrText := strings.Join(stderrLines, "\n")
		stderrMu.Unlock()
		if stderrText != "" {
			return nil, fmt.Errorf("whisper 退出异常（%v），stderr: %s", waitErr, stderrText)
		}
		return nil, fmt.Errorf("whisper 退出异常（%v），sidecar: %s", waitErr, sidecar)
	}

	var whisperOutput struct {
		Transcription []struct {
			Offsets struct {
				From int `json:"from"`
				To   int `json:"to"`
			} `json:"offsets"`
			Text string `json:"text"`
		} `json:"transcription"`
	}
	if err := json.Unmarshal(data, &whisperOutput); err != nil {
		return nil, fmt.Errorf("parse whisper output: %w", err)
	}

	result := make([]SubtitleItem, 0, len(whisperOutput.Transcription))
	for i, ss := range whisperOutput.Transcription {
		result = append(result, SubtitleItem{
			ID:        i + 1,
			StartTime: float64(ss.Offsets.From) / 1000,
			EndTime:   float64(ss.Offsets.To) / 1000,
			Text:      strings.TrimSpace(ss.Text),
		})
	}

	return result, nil
}

// --- Whisper status / model ---

func (s *WhisperService) WhisperStatus() WhisperStatus {
	modelPath := s.modelPath()
	_, err := os.Stat(modelPath)
	return WhisperStatus{
		Loaded:  err == nil,
		Loading: false,
		Model:   s.modelFile,
	}
}

func (s *WhisperService) SetWhisperModel(name string) {
	s.modelFile = s.modelFileFor(name)
	_ = os.WriteFile(filepath.Join(s.dataDir, "whisper-model.txt"), []byte(s.modelFile), 0644)
}

func (s *WhisperService) loadWhisperModel() {
	data, err := os.ReadFile(filepath.Join(s.dataDir, "whisper-model.txt"))
	if err == nil {
		m := strings.TrimSpace(string(data))
		if m != "" {
			s.modelFile = m
		}
	}
}

func (s *WhisperService) GetWhisperLang() string {
	return s.whisperLang
}

func (s *WhisperService) SetWhisperLang(lang string) {
	s.whisperLang = lang
	_ = os.WriteFile(filepath.Join(s.dataDir, "whisper-lang.txt"), []byte(lang), 0644)
}

func (s *WhisperService) loadWhisperLang() {
	data, err := os.ReadFile(filepath.Join(s.dataDir, "whisper-lang.txt"))
	if err == nil {
		lang := strings.TrimSpace(string(data))
		if lang != "" {
			s.whisperLang = lang
		}
	}
}

func (s *WhisperService) ListWhisperModels() []WhisperModelInfo {
	modelDir := filepath.Join(s.dataDir, "whisper-models")
	list := make([]WhisperModelInfo, 0, len(whisperModels))
	for _, m := range whisperModels {
		_, err := os.Stat(filepath.Join(modelDir, m.File))
		list = append(list, WhisperModelInfo{
			Name:       m.Name,
			File:       m.File,
			Size:       m.Size,
			Downloaded: err == nil,
		})
	}
	return list
}

// --- Model download ---

func (s *WhisperService) DownloadWhisperModel(modelName string) error {
	s.dlMu.Lock()
	if s.dlActive {
		s.dlMu.Unlock()
		return fmt.Errorf("download already in progress")
	}
	s.dlActive = true
	s.dlModel = modelName
	s.dlProgress = 0
	s.dlMu.Unlock()

	cleanup := func() {
		s.dlMu.Lock()
		s.dlActive = false
		s.dlProgress = -1
		s.dlModel = ""
		s.dlMu.Unlock()
	}
	defer cleanup()

	s.modelFile = s.modelFileFor(modelName)
	modelDir := filepath.Join(s.dataDir, "whisper-models")
	_ = os.MkdirAll(modelDir, 0755)
	modelPath := s.modelPath()
	tmpPath := modelPath + ".tmp"

	var lastErr error
	ok := false
	for _, src := range whisperModelSources {
		s.app.Logger.Info("downloading whisper model", "source", src.Name, "model", modelName)
		if err := s.downloadFromURL(src.Base+"/"+s.modelFile, tmpPath); err != nil {
			s.app.Logger.Info("download source failed, trying next", "source", src.Name, "error", err)
			lastErr = err
			continue
		}
		ok = true
		break
	}
	if !ok {
		return fmt.Errorf("all download sources failed: %w", lastErr)
	}

	if err := s.verifyModelSHA256(tmpPath); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}
	return os.Rename(tmpPath, modelPath)
}

// downloadFromURL 下载到 tmpPath；已存在 tmp 时用 Range 断点续传，失败保留 tmp
func (s *WhisperService) downloadFromURL(url, tmpPath string) error {
	var offset int64
	if fi, err := os.Stat(tmpPath); err == nil {
		offset = fi.Size()
	}

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return err
	}
	if offset > 0 {
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-", offset))
	}
	client := &http.Client{Timeout: 30 * 60 * 1e9}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	var out *os.File
	switch {
	case offset > 0 && resp.StatusCode == http.StatusPartialContent:
		out, err = os.OpenFile(tmpPath, os.O_WRONLY|os.O_APPEND, 0600)
	case resp.StatusCode == http.StatusOK:
		offset = 0
		out, err = os.Create(tmpPath)
	default:
		return fmt.Errorf("unexpected status: %s", resp.Status)
	}
	if err != nil {
		return err
	}

	total := resp.ContentLength + offset
	downloaded := offset
	buf := make([]byte, 32*1024)

	for {
		n, rerr := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := out.Write(buf[:n]); werr != nil {
				out.Close()
				return fmt.Errorf("write error: %w", werr)
			}
			downloaded += int64(n)
			if total > 0 {
				pct := int(downloaded * 100 / total)
				if pct > 100 {
					pct = 100
				}
				s.dlMu.Lock()
				s.dlProgress = pct
				s.dlMu.Unlock()
				s.app.Event.Emit("whisper:download-progress", pct)
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			out.Close()
			return rerr
		}
	}
	return out.Close()
}

func (s *WhisperService) verifyModelSHA256(path string) error {
	want := ""
	for _, m := range whisperModels {
		if m.File == s.modelFile {
			want = m.SHA256
			break
		}
	}
	if want == "" {
		return nil
	}
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return err
	}
	if got := hex.EncodeToString(h.Sum(nil)); got != want {
		return fmt.Errorf("SHA256 mismatch: got %s, want %s", got, want)
	}
	return nil
}

func (s *WhisperService) GetDownloadProgress() *WhisperDownloadProgress {
	s.dlMu.Lock()
	defer s.dlMu.Unlock()
	if s.dlProgress < 0 {
		return nil
	}
	return &WhisperDownloadProgress{Model: s.dlModel, Progress: s.dlProgress}
}

// --- Helpers ---

func (s *WhisperService) modelPath() string {
	return filepath.Join(s.dataDir, "whisper-models", s.modelFile)
}

func (s *WhisperService) modelFileFor(name string) string {
	for _, m := range whisperModels {
		if m.Name == name {
			return m.File
		}
	}
	return "ggml-tiny.bin"
}

func (s *WhisperService) findWhisperSidecar() string {
	locations := []string{
		filepath.Join(s.dataDir, "sidecar", "whisper-sidecar"),
		"sidecar/whisper-sidecar",
		"./sidecar/whisper-sidecar",
		filepath.Join(s.dataDir, "sidecar", "whisper-sidecar.exe"),
	}
	if goRuntime.GOOS == "darwin" {
		locations = append([]string{"../sidecar/whisper-sidecar"}, locations...)
		if bundlePath := bundleResources(); bundlePath != "" {
			locations = append([]string{filepath.Join(bundlePath, "whisper-sidecar")}, locations...)
		}
	}
	for _, p := range locations {
		s.app.Logger.Debug("findWhisperSidecar checking", "path", p)
		if _, err := os.Stat(p); err == nil {
			s.app.Logger.Debug("findWhisperSidecar found", "path", p)
			return p
		}
	}
	s.app.Logger.Debug("findWhisperSidecar not found")
	return ""
}
