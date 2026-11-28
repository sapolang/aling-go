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
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"

	"aling-go/internal/config"
	"aling-go/internal/proc"
	"aling-go/internal/tools"

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
	app     *application.App
	dataDir string
	store   *config.Store
	// cfgMu 保护 modelFile 与 whisperLang：UI goroutine 写入、转录 goroutine 读取
	cfgMu       sync.RWMutex
	modelFile   string
	whisperLang string
	gpuDisabled atomic.Bool
	dlMu        sync.Mutex
	dlActive    bool
	dlProgress  int
	dlModel     string
}

func NewWhisperService(app *application.App, dataDir string, store *config.Store) *WhisperService {
	s := &WhisperService{
		app:         app,
		dataDir:     dataDir,
		store:       store,
		modelFile:   "ggml-tiny.bin",
		whisperLang: "auto",
		dlProgress:  -1,
	}
	st := store.Settings()
	if st.WhisperModel != "" {
		s.modelFile = st.WhisperModel
	}
	if st.WhisperLang != "" {
		s.whisperLang = st.WhisperLang
	}
	return s
}

func (s *WhisperService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	return nil
}
func (s *WhisperService) ServiceShutdown() error { return nil }

// --- Transcribe ---

// Transcribe 转录本地文件，增量事件的 key 为文件路径（供前端过滤）。
//
// 失败时返回 error：Wails 会把绑定方法的 error 变成前端 promise 的 reject，
// 这是失败原因唯一能到达界面的通道 —— 发布版不写日志，Windows 上也没有控制台，
// 只记日志会让“转录失败”和“没识别到语音”在界面上完全一样。
func (s *WhisperService) Transcribe(filePath string) ([]SubtitleItem, error) {
	return s.transcribeWithKey(filePath, filePath)
}

// TranscribeWithKey 转录文件，但用自定义 key 作为事件标识。
// 播客/在线视频等场景下，实际转的是临时 WAV 文件，但前端用原始 URL 过滤事件，
// 因此需要把原始标识作为 key 穿透下去。
func (s *WhisperService) TranscribeWithKey(filePath, key string) ([]SubtitleItem, error) {
	return s.transcribeFile(filePath, key, true)
}

// TranscribePreparedWav 转录已经按 Whisper 要求转好的 16kHz 单声道 WAV，
// 跳过 extractAudio 的再次解码与临时缓存。调用方需保证 WAV 格式符合要求。
func (s *WhisperService) TranscribePreparedWav(wavPath, key string) ([]SubtitleItem, error) {
	return s.transcribeFile(wavPath, key, false)
}

func (s *WhisperService) transcribeWithKey(filePath, key string) ([]SubtitleItem, error) {
	return s.transcribeFile(filePath, key, true)
}

// transcribeFile 转录文件；extract 为 true 时先用 ffmpeg 解出 16kHz 单声道 WAV。
func (s *WhisperService) transcribeFile(filePath, key string, extract bool) ([]SubtitleItem, error) {
	s.app.Logger.Debug("Transcribe start", "filePath", filePath, "key", key, "extract", extract)
	wavPath := filePath
	decodeFailed := false
	if extract {
		wavPath = extractAudio(s.dataDir, s.app.Logger, filePath)
		s.app.Logger.Debug("Transcribe wavPath", "wavPath", wavPath)
		// ffmpeg 解不出音频时仍把原文件交给 whisper 试一次（来源本身可能就是 16kHz WAV），
		// 但要记下这个前提：失败时原因多半是解码而不是识别。
		if wavPath == "" {
			s.app.Logger.Debug("Transcribe extractAudio returned empty, using original file")
			decodeFailed = true
			wavPath = filePath
		}
	}

	// Metal 后端一旦失败，后续转录直接走 CPU，避免每次都先崩溃并产生一条系统崩溃报告
	if s.gpuDisabled.Load() {
		items, err := s.runWhisper(wavPath, key, "-ng")
		if err != nil {
			return nil, s.transcriptionError(err, decodeFailed)
		}
		return items, nil
	}

	items, err := s.runWhisper(wavPath, key)
	if err != nil {
		s.app.Logger.Info("GPU transcription failed, retrying without GPU", "error", err)
		s.gpuDisabled.Store(true)
		// 第一次尝试可能已经推送了部分段落；重试前让前端丢掉这些增量，
		// 否则 GPU/CPU 两次解码结果会短暂混在一起。
		s.app.Event.Emit("whisper:segments", whisperSegmentsEvent{Key: key, Reset: true})
		items, err = s.runWhisper(wavPath, key, "-ng")
	}
	if err != nil {
		return nil, s.transcriptionError(err, decodeFailed)
	}
	return items, nil
}

// transcriptionError 记录失败原因，并补上“解码失败”这个前置环节的信息：
// ffmpeg 没转出 WAV 时，whisper 的报错只会是读不了音频，看不出问题出在解码。
func (s *WhisperService) transcriptionError(err error, decodeFailed bool) error {
	s.app.Logger.Info("Transcription failed", "error", err, "decodeFailed", decodeFailed)
	return wrapTranscriptionError(err, decodeFailed)
}

// wrapTranscriptionError 是 transcriptionError 的纯函数部分，便于单测。
func wrapTranscriptionError(err error, decodeFailed bool) error {
	if err == nil || !decodeFailed {
		return err
	}
	return fmt.Errorf("音频解码失败（ffmpeg 未能转出 WAV）: %w", err)
}

// summarizeStderr 把 whisper 的 stderr 压成可直接展示的短摘要。
// whisper 的进度是覆盖式输出（`\r` 不换行），整段拼进错误消息会变成一大段重复文本；
// 而错误消息现在会作为前端 promise 的 reject 弹给用户，长度必须有界。
func summarizeStderr(text string) string {
	const (
		maxLines = 6
		maxWidth = 200
	)
	lines := make([]string, 0, maxLines)
	for _, line := range strings.Split(strings.ReplaceAll(text, "\r", "\n"), "\n") {
		if line = strings.TrimSpace(line); line != "" {
			if runes := []rune(line); len(runes) > maxWidth {
				line = string(runes[:maxWidth]) + "…"
			}
			lines = append(lines, line)
		}
	}
	if len(lines) == 0 {
		return ""
	}
	if len(lines) > maxLines {
		lines = lines[len(lines)-maxLines:]
	}
	return strings.Join(lines, " | ")
}

// runWhisper 执行一次 whisper-sidecar，cacheKey 用于定位输出文件和事件分发。
// 返回值始终以最终 JSON 为权威；同时通过 whisper:segments 事件增量推送。
func (s *WhisperService) runWhisper(wavPath, cacheKey string, extraArgs ...string) ([]SubtitleItem, error) {
	sidecar := s.findWhisperSidecar()
	if sidecar == "" {
		return nil, fmt.Errorf("未找到本地转录组件 whisper-sidecar，发布版请重新安装应用，开发环境请运行 make sidecar")
	}

	modelPath := s.modelPath()
	outDir := filepath.Join(s.dataDir, "temp-transcript")
	if err := os.MkdirAll(outDir, 0755); err != nil {
		return nil, fmt.Errorf("创建转录临时目录失败: %w", err)
	}
	outFile := filepath.Join(outDir, md5Hash(cacheKey))
	// 上一次失败的残留会让下面的读取误判为成功
	_ = os.Remove(outFile + ".json")

	args := []string{"-f", wavPath, "-m", modelPath, "-oj", "-of", outFile, "-pp", "-l", s.currentWhisperLang()}
	args = append(args, extraArgs...)
	cmd := proc.Command(sidecar, args...)
	s.app.Logger.Debug("Transcribe cmd", "cmd", cmd.String())

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("读取 whisper 输出失败: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("读取 whisper 日志失败: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("启动 whisper 失败: %w", err)
	}

	var (
		stderrMu    sync.Mutex
		stderrLines []string
		readDone    sync.WaitGroup
	)
	readDone.Add(2)

	// stderr: 进度条 + 系统信息
	go func() {
		defer readDone.Done()
		scanner := bufio.NewScanner(stderr)
		scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
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

	// stdout: 逐 segment 增量输出，格式 "[hh:mm:ss.mmm --> hh:mm:ss.mmm]  text"
	go func() {
		defer readDone.Done()
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		var count int
		for scanner.Scan() {
			line := scanner.Text()
			if item, ok := parseWhisperSegmentLine(line); ok {
				count++
				s.app.Logger.Debug("whisper segment streamed", "n", count, "start", item.StartTime)
				s.app.Event.Emit("whisper:segments", whisperSegmentsEvent{
					Key:   cacheKey,
					Items: []SubtitleItem{item},
				})
			}
		}
		if count == 0 {
			s.app.Logger.Warn("whisper stdout produced no parseable segments")
		}
	}()

	// StderrPipe/StdoutPipe 文档要求读完管道后才能调用 Wait
	readDone.Wait()
	waitErr := cmd.Wait()

	data, err := os.ReadFile(outFile + ".json")
	if err != nil {
		stderrMu.Lock()
		stderrText := strings.Join(stderrLines, "\n")
		stderrMu.Unlock()
		if stderrText != "" {
			// 完整 stderr 只进日志；错误消息会一路弹到界面上，必须压成短摘要
			s.app.Logger.Debug("whisper stderr", "text", stderrText)
			return nil, fmt.Errorf("whisper 退出异常（%v），stderr: %s", waitErr, summarizeStderr(stderrText))
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
		return nil, fmt.Errorf("解析 whisper 输出失败: %w", err)
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

// whisperSegmentsEvent 是 whisper:segments 事件载荷：增量推送时只包含一条，
// 用数组是为了将来支持一次多条；key 用于前端过滤掉切换文件后的过期事件；
// Reset 用于通知前端清空当前 key 已接收的增量。
type whisperSegmentsEvent struct {
	Key   string         `json:"key"`
	Items []SubtitleItem `json:"items"`
	// Reset 为 true 表示丢弃该 key 已推送的增量（例如 GPU 失败后改用 CPU 重试）。
	Reset bool `json:"reset,omitempty"`
}

// parseWhisperSegmentLine 解析 whisper-cli stdout 的单行输出。
// 格式固定为 "[hh:mm:ss.mmm --> hh:mm:ss.mmm]  text content"，
// 不匹配或文本为空时返回 ok=false，调用方应忽略该日志行。
func parseWhisperSegmentLine(line string) (SubtitleItem, bool) {
	line = strings.TrimRight(line, "\r\n")
	if !strings.HasPrefix(line, "[") {
		return SubtitleItem{}, false
	}
	// 时间戳格式 hh:mm:ss.mmm，中间以 " --> " 分隔
	rest := line[1:]
	end := strings.Index(rest, "]")
	if end < 0 {
		return SubtitleItem{}, false
	}
	timestamps := strings.TrimSpace(rest[:end])
	text := strings.TrimSpace(rest[end+1:])
	if text == "" {
		return SubtitleItem{}, false
	}
	parts := strings.SplitN(timestamps, "-->", 2)
	if len(parts) != 2 {
		return SubtitleItem{}, false
	}
	start, ok1 := parseWhisperTimestamp(strings.TrimSpace(parts[0]))
	endTs, ok2 := parseWhisperTimestamp(strings.TrimSpace(parts[1]))
	if !ok1 || !ok2 {
		return SubtitleItem{}, false
	}
	return SubtitleItem{
		StartTime: start,
		EndTime:   endTs,
		Text:      text,
	}, true
}

// parseWhisperTimestamp 解析 hh:mm:ss.mmm 为秒数。精度只到毫秒，多余的小数会被丢弃。
func parseWhisperTimestamp(ts string) (float64, bool) {
	ts = strings.TrimSpace(ts)
	if ts == "" {
		return 0, false
	}
	// 允许 "." 或 "," 作为毫秒分隔符（SRT 用 ","，whisper stdout 用 "."）
	ts = strings.Replace(ts, ",", ".", 1)
	var h, m int
	var s float64
	if _, err := fmt.Sscanf(ts, "%d:%d:%f", &h, &m, &s); err != nil {
		return 0, false
	}
	if m < 0 || m >= 60 || s < 0 || s >= 60 {
		return 0, false
	}
	return float64(h)*3600 + float64(m)*60 + s, true
}

// --- Whisper status / model ---

func (s *WhisperService) WhisperStatus() WhisperStatus {
	modelFile := s.currentModelFile()
	_, err := os.Stat(filepath.Join(s.dataDir, "whisper-models", modelFile))
	return WhisperStatus{
		Loaded:  err == nil,
		Loading: false,
		Model:   modelFile,
	}
}

func (s *WhisperService) SetWhisperModel(name string) {
	modelFile := s.modelFileFor(name)
	s.cfgMu.Lock()
	s.modelFile = modelFile
	s.cfgMu.Unlock()
	if err := s.store.UpdateSettings(func(st *config.Settings) {
		st.WhisperModel = modelFile
	}); err != nil {
		s.app.Logger.Warn("save whisper model", "error", err)
	}
}

func (s *WhisperService) GetWhisperLang() string {
	return s.currentWhisperLang()
}

func (s *WhisperService) SetWhisperLang(lang string) {
	s.cfgMu.Lock()
	s.whisperLang = lang
	s.cfgMu.Unlock()
	if err := s.store.UpdateSettings(func(st *config.Settings) {
		st.WhisperLang = lang
	}); err != nil {
		s.app.Logger.Warn("save whisper lang", "error", err)
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

	modelFile := s.modelFileFor(modelName)
	urls := make([]string, 0, len(whisperModelSources))
	for _, src := range whisperModelSources {
		urls = append(urls, src.Base+"/"+modelFile)
	}
	fetch := func(url, tmpPath string) error {
		s.app.Logger.Info("downloading whisper model", "url", url, "model", modelName)
		if err := s.downloadFromURL(url, tmpPath); err != nil {
			s.app.Logger.Info("download source failed, trying next", "url", url, "error", err)
			return err
		}
		return nil
	}
	return s.downloadModel(modelName, urls, fetch)
}

// downloadModel 依次尝试各个下载地址。只有校验通过且重命名成功后才会切换当前模型，
// 避免下载失败后 WhisperStatus 与转录仍指向一个不存在的模型文件。
func (s *WhisperService) downloadModel(modelName string, urls []string, fetch func(url, tmpPath string) error) error {
	modelFile := s.modelFileFor(modelName)
	modelDir := filepath.Join(s.dataDir, "whisper-models")
	_ = os.MkdirAll(modelDir, 0755)
	modelPath := filepath.Join(modelDir, modelFile)
	tmpPath := modelPath + ".tmp"

	var lastErr error
	for _, url := range urls {
		if err := fetch(url, tmpPath); err != nil {
			lastErr = err
			continue
		}
		if err := verifyModelSHA256(tmpPath, modelFile); err != nil {
			_ = os.Remove(tmpPath)
			return err
		}
		if err := os.Rename(tmpPath, modelPath); err != nil {
			return err
		}
		s.cfgMu.Lock()
		s.modelFile = modelFile
		s.cfgMu.Unlock()
		return nil
	}
	return fmt.Errorf("all download sources failed: %w", lastErr)
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

func verifyModelSHA256(path, modelFile string) error {
	want := ""
	for _, m := range whisperModels {
		if m.File == modelFile {
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
	return filepath.Join(s.dataDir, "whisper-models", s.currentModelFile())
}

func (s *WhisperService) currentModelFile() string {
	s.cfgMu.RLock()
	defer s.cfgMu.RUnlock()
	return s.modelFile
}

func (s *WhisperService) currentWhisperLang() string {
	s.cfgMu.RLock()
	defer s.cfgMu.RUnlock()
	return s.whisperLang
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
	p := tools.FindWhisper(s.dataDir)
	if p != "" {
		s.app.Logger.Debug("findWhisperSidecar found", "path", p)
	} else {
		s.app.Logger.Debug("findWhisperSidecar not found")
	}
	return p
}
