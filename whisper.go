package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	goRuntime "runtime"
	"strings"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

type whisperProgress struct {
	Progress int    `json:"progress"`
	Status   string `json:"status"`
}

func (a *App) Transcribe(filePath string) string {
	fmt.Println("DEBUG Transcribe: start, filePath=", filePath)
	wavPath := a.extractAudio(filePath)
	fmt.Println("DEBUG Transcribe: wavPath=", wavPath)
	if wavPath == "" {
		fmt.Println("DEBUG Transcribe: extractAudio returned empty, using file as is")
		wavPath = filePath
	}

	sidecar := a.findWhisperSidecar()
	fmt.Println("DEBUG Transcribe: sidecar=", sidecar)
	if sidecar == "" {
		fmt.Println("DEBUG Transcribe: sidecar not found")
		return "[]"
	}

	modelPath := a.modelPath()
	fmt.Println("DEBUG Transcribe: modelPath=", modelPath)
	outDir := filepath.Join(a.dataDir, "temp-transcript")
	os.MkdirAll(outDir, 0755)
	outFile := filepath.Join(outDir, md5Hash(filePath))

	fmt.Println("DEBUG Transcribe: outFile=", outFile)
	fmt.Println("DEBUG Transcribe: whisperLang=", a.whisperLang)

	cmd := exec.Command(sidecar, "-f", wavPath, "-m", modelPath, "-oj", "-of", outFile, "-pp", "-l", a.whisperLang)
	fmt.Println("DEBUG Transcribe: cmd=", cmd.String())
	stderr, err := cmd.StderrPipe()
	if err != nil {
		fmt.Println("DEBUG Transcribe: StderrPipe error:", err)
		return "[]"
	}

	if err := cmd.Start(); err != nil {
		fmt.Println("DEBUG Transcribe: Start error:", err)
		return "[]"
	}
	fmt.Println("DEBUG Transcribe: process started, PID=", cmd.Process.Pid)

	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			line := scanner.Text()
			if strings.Contains(line, "%") {
				parts := strings.Fields(line)
				for _, p := range parts {
					if strings.HasSuffix(p, "%") {
						pct := strings.TrimSuffix(p, "%")
						var prog int
						if _, err := fmt.Sscanf(pct, "%d", &prog); err == nil {
							wailsRuntime.EventsEmit(a.ctx, "whisper:progress", whisperProgress{
								Progress: prog,
								Status:   "transcribing",
							})
						}
					}
				}
			}
		}
	}()

	err = cmd.Wait()
	fmt.Println("DEBUG Transcribe: process exited, err=", err)

	data, err := os.ReadFile(outFile + ".json")
	fmt.Println("DEBUG Transcribe: read result file, data len=", len(data), "err=", err)
	if err != nil {
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
		fmt.Println("DEBUG Transcribe: unmarshal error:", err)
		return "[]"
	}

	result := make([]SubtitleItem, 0, len(whisperOutput.Transcription))
	for i, s := range whisperOutput.Transcription {
		result = append(result, SubtitleItem{
			ID:        i + 1,
			StartTime: float64(s.Offsets.From) / 1000,
			EndTime:   float64(s.Offsets.To) / 1000,
			Text:      strings.TrimSpace(s.Text),
		})
	}

	b, _ := json.Marshal(result)
	return string(b)
}

func (a *App) WhisperStatus() WhisperStatus {
	modelPath := a.modelPath()
	_, err := os.Stat(modelPath)
	return WhisperStatus{
		Loaded:  err == nil,
		Loading: false,
		Model:   a.modelFile,
	}
}

func (a *App) SetWhisperModel(name string) {
	a.modelFile = a.modelFileFor(name)
	os.WriteFile(filepath.Join(a.dataDir, "whisper-model.txt"), []byte(a.modelFile), 0644)
}

func (a *App) loadWhisperModel() {
	data, err := os.ReadFile(filepath.Join(a.dataDir, "whisper-model.txt"))
	if err == nil {
		m := strings.TrimSpace(string(data))
		if m != "" {
			a.modelFile = m
		}
	}
}

func (a *App) GetWhisperLang() string {
	return a.whisperLang
}

func (a *App) SetWhisperLang(lang string) {
	a.whisperLang = lang
	os.WriteFile(filepath.Join(a.dataDir, "whisper-lang.txt"), []byte(lang), 0644)
}

func (a *App) loadWhisperLang() {
	configDir := a.dataDir
	data, err := os.ReadFile(filepath.Join(configDir, "whisper-lang.txt"))
	if err == nil {
		lang := strings.TrimSpace(string(data))
		if lang != "" {
			a.whisperLang = lang
		}
	}
}

func (a *App) ListWhisperModels() string {
	type entry struct {
		Name     string `json:"name"`
		File     string `json:"file"`
		Size     string `json:"size"`
		Downloaded bool `json:"downloaded"`
	}
	modelDir := filepath.Join(a.dataDir, "whisper-models")
	var list []entry
	for _, m := range whisperModels {
		_, err := os.Stat(filepath.Join(modelDir, m.File))
		list = append(list, entry{m.Name, m.File, m.Size, err == nil})
	}
	b, _ := json.Marshal(list)
	return string(b)
}

var whisperModels = []struct {
	Name string
	File string
	Size string
}{
	{"tiny",   "ggml-tiny.bin",     "75MB"},
	{"small",  "ggml-small.bin",    "466MB"},
	{"large",  "ggml-large-v3.bin", "3.1GB"},
}

func (a *App) modelPath() string {
	return filepath.Join(a.dataDir, "whisper-models", a.modelFile)
}

func (a *App) modelFileFor(name string) string {
	for _, m := range whisperModels {
		if m.Name == name {
			return m.File
		}
	}
	return "ggml-tiny.bin"
}

func (a *App) DownloadWhisperModel(mirrorURL, modelName string) error {
	a.dlMu.Lock()
	if a.dlActive {
		a.dlMu.Unlock()
		return fmt.Errorf("download already in progress")
	}
	a.dlActive = true
	a.dlModel = modelName
	a.dlProgress = 0
	a.dlMu.Unlock()

	cleanup := func() {
		a.dlMu.Lock()
		a.dlActive = false
		a.dlProgress = -1
		a.dlModel = ""
		a.dlMu.Unlock()
	}
	defer cleanup()

	a.modelFile = a.modelFileFor(modelName)
	modelDir := filepath.Join(a.dataDir, "whisper-models")
	os.MkdirAll(modelDir, 0755)
	modelPath := a.modelPath()
	tmpPath := modelPath + ".tmp"
	os.Remove(tmpPath)

	url := mirrorURL + "/ggerganov/whisper.cpp/resolve/main/" + a.modelFile
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
				a.dlMu.Lock()
				a.dlProgress = pct
				a.dlMu.Unlock()
				wailsRuntime.EventsEmit(a.ctx, "whisper:download-progress", pct)
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

func (a *App) GetDownloadProgress() string {
	a.dlMu.Lock()
	defer a.dlMu.Unlock()
	if a.dlProgress < 0 {
		return ""
	}
	return fmt.Sprintf(`{"model":"%s","progress":%d}`, a.dlModel, a.dlProgress)
}

func (a *App) findWhisperSidecar() string {
	locations := []string{
		filepath.Join(a.dataDir, "sidecar", "whisper-sidecar"),
		"sidecar/whisper-sidecar",
		"./sidecar/whisper-sidecar",
		filepath.Join(a.dataDir, "sidecar", "whisper-sidecar.exe"),
	}
	if goRuntime.GOOS == "darwin" {
		locations = append([]string{"../sidecar/whisper-sidecar"}, locations...)
		if bundlePath := a.bundleResources(); bundlePath != "" {
			locations = append([]string{filepath.Join(bundlePath, "whisper-sidecar")}, locations...)
		}
	}
	for _, p := range locations {
		fmt.Println("DEBUG findWhisperSidecar: checking", p)
		if _, err := os.Stat(p); err == nil {
			fmt.Println("DEBUG findWhisperSidecar: found at", p)
			return p
		}
	}
	fmt.Println("DEBUG findWhisperSidecar: NOT FOUND")
	return ""
}

func (a *App) bundleResources() string {
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
