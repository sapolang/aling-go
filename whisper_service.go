package main

import (
	"bufio"
	"context"
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

	"github.com/wailsapp/wails/v3/pkg/application"
)

type whisperProgress struct {
	Progress int    `json:"progress"`
	Status   string `json:"status"`
}

var whisperModels = []struct {
	Name string
	File string
	Size string
}{
	{"tiny", "ggml-tiny.bin", "75MB"},
	{"small", "ggml-small.bin", "466MB"},
	{"large", "ggml-large-v3.bin", "3.1GB"},
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

type WhisperService struct {
	app         *application.App
	dataDir     string
	modelFile   string
	whisperLang string
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
		whisperLang: "auto",
		dlProgress:  -1,
	}
	s.loadWhisperLang()
	s.loadWhisperModel()
	return s
}

func (s *WhisperService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error { return nil }
func (s *WhisperService) ServiceShutdown() error { return nil }

// --- Transcribe ---

func (s *WhisperService) Transcribe(filePath string) string {
	s.app.Logger.Debug("Transcribe start", "filePath", filePath)
	wavPath := extractAudio(s.dataDir, s.app.Logger, filePath)
	s.app.Logger.Debug("Transcribe wavPath", "wavPath", wavPath)
	if wavPath == "" {
		s.app.Logger.Debug("Transcribe extractAudio returned empty, using original file")
		wavPath = filePath
	}

	sidecar := s.findWhisperSidecar()
	if sidecar == "" {
		s.app.Logger.Info("Transcription failed: whisper sidecar not found. Run 'make sidecar' to build it.")
		return "[]"
	}

	modelPath := s.modelPath()
	s.app.Logger.Debug("Transcribe modelPath", "modelPath", modelPath)
	outDir := filepath.Join(s.dataDir, "temp-transcript")
	os.MkdirAll(outDir, 0755)
	outFile := filepath.Join(outDir, md5Hash(filePath))

	s.app.Logger.Debug("Transcribe outFile", "outFile", outFile)
	s.app.Logger.Debug("Transcribe whisperLang", "whisperLang", s.whisperLang)

	cmd := exec.Command(sidecar, "-f", wavPath, "-m", modelPath, "-oj", "-of", outFile, "-pp", "-l", s.whisperLang)
	s.app.Logger.Debug("Transcribe cmd", "cmd", cmd.String())
	stderr, err := cmd.StderrPipe()
	if err != nil {
		s.app.Logger.Info("Transcription failed: cannot read whisper stderr", "error", err)
		return "[]"
	}

	if err := cmd.Start(); err != nil {
		s.app.Logger.Info("Transcription failed: cannot start whisper process", "error", err)
		return "[]"
	}

	stderrLines := []string{}
	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			line := scanner.Text()
			stderrLines = append(stderrLines, line)
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
		if len(stderrLines) > 0 {
			s.app.Logger.Info("Transcription failed: whisper process exited with error", "exitErr", waitErr, "stderr", strings.Join(stderrLines, "\n"))
		} else {
			s.app.Logger.Info("Transcription failed: whisper process exited with error", "exitErr", waitErr, "modelPath", modelPath, "sidecar", sidecar)
		}
		return "[]"
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
		s.app.Logger.Debug("Transcribe unmarshal error", "error", err)
		return "[]"
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

	b, _ := json.Marshal(result)
	return string(b)
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
	os.WriteFile(filepath.Join(s.dataDir, "whisper-model.txt"), []byte(s.modelFile), 0644)
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
	os.WriteFile(filepath.Join(s.dataDir, "whisper-lang.txt"), []byte(lang), 0644)
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

func (s *WhisperService) ListWhisperModels() string {
	type entry struct {
		Name       string `json:"name"`
		File       string `json:"file"`
		Size       string `json:"size"`
		Downloaded bool   `json:"downloaded"`
	}
	modelDir := filepath.Join(s.dataDir, "whisper-models")
	var list []entry
	for _, m := range whisperModels {
		_, err := os.Stat(filepath.Join(modelDir, m.File))
		list = append(list, entry{m.Name, m.File, m.Size, err == nil})
	}
	b, _ := json.Marshal(list)
	return string(b)
}

// --- Model download ---

func (s *WhisperService) DownloadWhisperModel(mirrorURL, modelName string) error {
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
	os.MkdirAll(modelDir, 0755)
	modelPath := s.modelPath()
	tmpPath := modelPath + ".tmp"
	os.Remove(tmpPath)

	url := mirrorURL + "/ggerganov/whisper.cpp/resolve/main/" + s.modelFile
	client := &http.Client{Timeout: 30 * 60 * 1e9}
	resp, err := client.Get(url)
	if err != nil {
		os.Remove(tmpPath)
		return err
	}
	defer resp.Body.Close()

	out, err := os.Create(tmpPath)
	if err != nil {
		os.Remove(tmpPath)
		return err
	}

	total := resp.ContentLength
	downloaded := int64(0)
	buf := make([]byte, 32*1024)

	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			if _, err := out.Write(buf[:n]); err != nil {
				out.Close()
				os.Remove(tmpPath)
				return fmt.Errorf("write error: %w", err)
			}
			downloaded += int64(n)
			if total > 0 {
				pct := int(downloaded * 100 / total)
				s.dlMu.Lock()
				s.dlProgress = pct
				s.dlMu.Unlock()
				s.app.Event.Emit("whisper:download-progress", pct)
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			out.Close()
			os.Remove(tmpPath)
			return err
		}
	}

	out.Close()
	os.Rename(tmpPath, modelPath)
	return nil
}

func (s *WhisperService) GetDownloadProgress() string {
	s.dlMu.Lock()
	defer s.dlMu.Unlock()
	if s.dlProgress < 0 {
		return ""
	}
	return fmt.Sprintf(`{"model":"%s","progress":%d}`, s.dlModel, s.dlProgress)
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
