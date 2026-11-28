package tts

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"

	"aling-go/internal/proc"
)

// localEngine 调用应用数据目录中的独立 Piper / Sherpa-ONNX 二进制。
// 主程序不链接任何 TTS 动态库，子进程崩溃不会拖垮 Go 进程。
type localEngine struct {
	dataDir string
}

type piperConfig struct {
	Audio struct {
		SampleRate int `json:"sample_rate"`
		Channels   int `json:"channels"`
	} `json:"audio"`
}

func newLocalEngine(dataDir string) *localEngine {
	return &localEngine{dataDir: dataDir}
}

func (e *localEngine) ttsDir() string {
	return filepath.Join(e.dataDir, "tts")
}

func (e *localEngine) binaryPath() string {
	return firstExisting(e.piperCandidates())
}

func (e *localEngine) piperCandidates() []string {
	names := []string{"piper"}
	if runtime.GOOS == "windows" {
		names = []string{"piper.exe"}
	}
	dirs := []string{
		filepath.Join(e.ttsDir(), "piper-dist"),
		// Piper 官方压缩包内含 piper/ 顶层目录，解压后二进制位于 piper-dist/piper/piper。
		filepath.Join(e.ttsDir(), "piper-dist", "piper"),
		filepath.Join(e.ttsDir(), "piper"),
		e.ttsDir(),
	}
	var out []string
	for _, dir := range dirs {
		for _, name := range names {
			out = append(out, filepath.Join(dir, name))
		}
	}
	return out
}

func (e *localEngine) sherpaCandidates() []string {
	names := []string{"sherpa-onnx-offline-tts"}
	if runtime.GOOS == "windows" {
		names = []string{"sherpa-onnx-offline-tts.exe"}
	}
	dirs := []string{
		filepath.Join(e.ttsDir(), "sherpa"),
		filepath.Join(e.ttsDir(), "sherpa-onnx"),
		e.ttsDir(),
	}
	var out []string
	for _, dir := range dirs {
		for _, name := range names {
			out = append(out, filepath.Join(dir, name))
		}
	}
	return out
}

// models 扫描 data/tts 下的 .onnx 模型，作为本地可选发音。
func (e *localEngine) models() []Voice {
	seen := map[string]bool{}
	var models []Voice
	root := e.ttsDir()
	_ = filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return nil
		}
		if !strings.EqualFold(filepath.Ext(path), ".onnx") {
			return nil
		}
		id := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
		if id == "" || seen[id] {
			return nil
		}
		seen[id] = true
		models = append(models, Voice{ID: id, Name: id, Engine: EngineLocal})
		return nil
	})
	sort.Slice(models, func(i, j int) bool { return models[i].ID < models[j].ID })
	return models
}

// modelForVoice 先按发音 ID 匹配，找不到时回退到默认模型或第一个可用模型。
func (e *localEngine) modelForVoice(voice string) string {
	id := strings.TrimSuffix(filepath.Base(strings.TrimSpace(voice)), ".onnx")
	models := e.models()
	if id != "" {
		for _, model := range models {
			if strings.EqualFold(model.ID, id) {
				return e.findModelPath(model.ID)
			}
		}
	}
	if path := e.findModelPath(DefaultLocalVoice); path != "" {
		return path
	}
	if len(models) > 0 {
		return e.findModelPath(models[0].ID)
	}
	return ""
}

func (e *localEngine) findModelPath(id string) string {
	if id == "" || id != filepath.Base(id) {
		return ""
	}
	candidates := []string{
		filepath.Join(e.ttsDir(), "models", id+".onnx"),
		filepath.Join(e.ttsDir(), id+".onnx"),
		filepath.Join(e.ttsDir(), "piper-dist", id+".onnx"),
	}
	if path := firstExisting(candidates); path != "" {
		return path
	}
	var found string
	_ = filepath.WalkDir(e.ttsDir(), func(path string, entry os.DirEntry, err error) error {
		if err != nil || entry.IsDir() || found != "" {
			return nil
		}
		if strings.EqualFold(filepath.Base(path), id+".onnx") {
			found = path
		}
		return nil
	})
	return found
}

// synthesize 优先用 Piper 的 --output-raw 管道取 PCM；失败时尝试 Sherpa-ONNX。
func (e *localEngine) synthesize(ctx context.Context, text, voice string) ([]byte, error) {
	model := e.modelForVoice(voice)
	if model == "" {
		return nil, fmt.Errorf("本地 TTS 尚未安装语音模型")
	}

	var errors []string
	if piper := e.binaryPath(); piper != "" {
		audio, err := e.synthesizePiper(ctx, piper, model, text)
		if err == nil && len(audio) > 0 {
			return audio, nil
		}
		if err != nil {
			errors = append(errors, "Piper: "+err.Error())
		}
	}
	if sherpa := firstExisting(e.sherpaCandidates()); sherpa != "" {
		audio, err := e.synthesizeSherpa(ctx, sherpa, model, text)
		if err == nil && len(audio) > 0 {
			return audio, nil
		}
		if err != nil {
			errors = append(errors, "Sherpa: "+err.Error())
		}
	}
	if len(errors) == 0 {
		errors = append(errors, "未找到本地 TTS 二进制")
	}
	return nil, fmt.Errorf("%s", strings.Join(errors, "；"))
}

func (e *localEngine) synthesizePiper(ctx context.Context, binary, model, text string) ([]byte, error) {
	args := []string{"--model", model, "--output-raw"}
	if config := model + ".json"; fileExists(config) {
		args = append(args, "--config", config)
	}
	if espeak := e.espeakDataDir(binary); espeak != "" {
		args = append(args, "--espeak_data", espeak)
	}

	cmd := proc.CommandContext(ctx, binary, args...)
	cmd.Stdin = strings.NewReader(text + "\n")
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	runErr := cmd.Run()
	if runErr == nil && stdout.Len() > 0 {
		sampleRate, channels := readPiperAudioFormat(model)
		return wrapPCMAsWAV(stdout.Bytes(), sampleRate, channels)
	}
	if runErr != nil && !looksLikeUnknownOption(stderr.String()) {
		return nil, fmt.Errorf("%v: %s", runErr, summarizeProcessError(stderr.String()))
	}

	// 兼容不支持 --output-raw 的旧版 Piper：让它写临时 WAV，读完立即删除。
	audio, err := e.synthesizePiperFile(ctx, binary, model, text, args)
	if err != nil {
		if runErr != nil {
			return nil, fmt.Errorf("%v: %s", runErr, summarizeProcessError(stderr.String()))
		}
		return nil, err
	}
	return audio, nil
}

func (e *localEngine) synthesizePiperFile(ctx context.Context, binary, model, text string, baseArgs []string) ([]byte, error) {
	if err := os.MkdirAll(e.ttsDir(), 0o755); err != nil {
		return nil, err
	}
	tmp, err := os.CreateTemp(e.ttsDir(), "piper-*.wav")
	if err != nil {
		return nil, err
	}
	tmpPath := tmp.Name()
	_ = tmp.Close()
	defer func() { _ = os.Remove(tmpPath) }()

	args := make([]string, 0, len(baseArgs)+2)
	for _, arg := range baseArgs {
		if arg != "--output-raw" {
			args = append(args, arg)
		}
	}
	args = append(args, "--output_file", tmpPath)

	cmd := proc.CommandContext(ctx, binary, args...)
	cmd.Stdin = strings.NewReader(text + "\n")
	var stderr bytes.Buffer
	cmd.Stdout = &stderr
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("%v: %s", err, summarizeProcessError(stderr.String()))
	}
	return os.ReadFile(tmpPath)
}

func (e *localEngine) synthesizeSherpa(ctx context.Context, binary, model, text string) ([]byte, error) {
	dir := filepath.Dir(model)
	tokens := firstExisting([]string{
		filepath.Join(dir, "tokens.txt"),
		filepath.Join(e.ttsDir(), "tokens.txt"),
	})
	if tokens == "" {
		return nil, fmt.Errorf("缺少 tokens.txt")
	}
	if err := os.MkdirAll(e.ttsDir(), 0o755); err != nil {
		return nil, err
	}
	tmp, err := os.CreateTemp(e.ttsDir(), "sherpa-*.wav")
	if err != nil {
		return nil, err
	}
	tmpPath := tmp.Name()
	_ = tmp.Close()
	defer func() { _ = os.Remove(tmpPath) }()

	args := []string{
		"--model=" + model,
		"--tokens=" + tokens,
		"--output-filename=" + tmpPath,
	}
	if voices := firstExisting([]string{filepath.Join(dir, "voices.bin"), filepath.Join(e.ttsDir(), "voices.bin")}); voices != "" {
		args = append(args, "--voices="+voices)
	}
	if dataDir := firstExistingDir([]string{filepath.Join(dir, "espeak-ng-data"), filepath.Join(e.ttsDir(), "espeak-ng-data")}); dataDir != "" {
		args = append(args, "--data-dir="+dataDir)
	}
	args = append(args, text)

	cmd := proc.CommandContext(ctx, binary, args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("%v: %s", err, summarizeProcessError(stderr.String()))
	}
	return os.ReadFile(tmpPath)
}

func (e *localEngine) espeakDataDir(binary string) string {
	dirs := []string{
		filepath.Join(filepath.Dir(binary), "espeak-ng-data"),
		filepath.Join(e.ttsDir(), "piper-dist", "espeak-ng-data"),
		filepath.Join(e.ttsDir(), "piper-dist", "piper", "espeak-ng-data"),
		filepath.Join(e.ttsDir(), "espeak-ng-data"),
	}
	return firstExistingDir(dirs)
}

func readPiperAudioFormat(model string) (sampleRate, channels int) {
	sampleRate, channels = 22050, 1
	data, err := os.ReadFile(model + ".json")
	if err != nil {
		return
	}
	var cfg piperConfig
	if json.Unmarshal(data, &cfg) != nil {
		return
	}
	if cfg.Audio.SampleRate > 0 {
		sampleRate = cfg.Audio.SampleRate
	}
	if cfg.Audio.Channels > 0 {
		channels = cfg.Audio.Channels
	}
	return
}

func looksLikeUnknownOption(stderr string) bool {
	lower := strings.ToLower(stderr)
	for _, marker := range []string{"unknown option", "unrecognized", "invalid option", "unknown argument", "usage:"} {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	return false
}

func summarizeProcessError(stderr string) string {
	text := strings.TrimSpace(stderr)
	text = strings.ReplaceAll(text, "\r", "\n")
	lines := strings.Split(text, "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		if line == "" {
			continue
		}
		if len([]rune(line)) > 240 {
			line = string([]rune(line)[:240]) + "…"
		}
		return line
	}
	return "无错误输出"
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func dirExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

func firstExisting(paths []string) string {
	for _, path := range paths {
		if fileExists(path) {
			return path
		}
	}
	return ""
}

func firstExistingDir(paths []string) string {
	for _, path := range paths {
		if dirExists(path) {
			return path
		}
	}
	return ""
}
