package tts

import (
	"context"
	"encoding/base64"
	"log/slog"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	// InstallProgressEvent 是离线语音包下载/解压的 Wails 事件名。
	InstallProgressEvent = "tts:install-progress"
	// EngineFallbackEvent 是 Edge-TTS 连续失败后降级时的事件名，前端收到后可弹 toast。
	// payload: { reason: string }
	EngineFallbackEvent = "tts:engine-fallback"

	edgeFailThreshold = 3 // 连续失败 N 次后才发降级事件，避免网络抖动频繁打扰。
	edgeCooldown      = 30 * time.Second

	// 整段朗读一次合成的文本较长，放宽本地合成超时。
	localSynthTimeout = 45 * time.Second
	installTimeout    = 15 * time.Minute
)

// Service 是暴露给前端的 TTS 统一调度器：Edge 在线优先，失败后使用 data/tts
// 下的本地 C++ 二进制，最后返回 fallback 让前端使用浏览器原生语音。
type Service struct {
	app     *application.App
	dataDir string
	edge    *edgeClient
	local   *localEngine

	mu             sync.Mutex
	edgeFailStreak int
	edgeFallbackAt time.Time
	edgeNotified   bool // 冷却期内只发一次降级事件
}

func NewService(app *application.App, dataDir string) *Service {
	return &Service{
		app:     app,
		dataDir: dataDir,
		edge:    &edgeClient{},
		local:   newLocalEngine(dataDir),
	}
}

func (s *Service) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	return nil
}

func (s *Service) ServiceShutdown() error {
	s.edge.Close()
	return nil
}

// SynthesizeSentence 合成单句音频。优先在线 Edge-TTS，其次本地 Piper/Sherpa。
// 两个引擎都不可用时返回 Engine=fallback，前端自动使用 window.speechSynthesis。
func (s *Service) SynthesizeSentence(text string, voice string) SynthesizeResult {
	text = strings.TrimSpace(text)
	if text == "" {
		return SynthesizeResult{Engine: EngineFallback, Error: "句子为空"}
	}

	if isLocalVoice(voice, s.local) {
		if result, ok := s.synthesizeLocal(text, voice); ok {
			return result
		}
		if result, ok := s.synthesizeEdge(text, DefaultEdgeVoice); ok {
			return result
		}
	} else {
		if result, ok := s.synthesizeEdge(text, voice); ok {
			return result
		}
		localVoice := voice
		if localVoice == "" || edgeVoicePattern.MatchString(localVoice) {
			localVoice = DefaultLocalVoice
		}
		if result, ok := s.synthesizeLocal(text, localVoice); ok {
			return result
		}
	}

	return SynthesizeResult{
		Engine: EngineFallback,
		Error:  "在线与离线语音暂不可用，已切换到浏览器语音",
	}
}

func (s *Service) synthesizeEdge(text, voice string) (SynthesizeResult, bool) {
	audio, err := s.edge.synthesize(context.Background(), text, voice)
	if err != nil || len(audio) == 0 {
		s.logger().Debug("edge tts failed", "error", err)
		s.recordEdgeFail(err)
		return SynthesizeResult{}, false
	}
	s.recordEdgeOK()
	return SynthesizeResult{
		AudioBase64: base64.StdEncoding.EncodeToString(audio),
		MimeType:    "audio/mpeg",
		Engine:      EngineEdge,
		Voice:       normalizeEdgeVoice(voice),
	}, true
}

// recordEdgeFail 记录 Edge 失败并在连续达阈值后发降级事件。
// 冷却期（edgeCooldown）内只发一次，避免网络抖动反复推送。
func (s *Service) recordEdgeFail(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.edgeFailStreak++
	now := time.Now()
	if now.Sub(s.edgeFallbackAt) < edgeCooldown {
		return
	}
	if s.edgeFailStreak >= edgeFailThreshold && !s.edgeNotified {
		s.edgeFallbackAt = now
		s.edgeNotified = true
		reason := "Edge-TTS 连续失败，已自动切换"
		if err != nil {
			reason += "：" + err.Error()
		}
		if s.app != nil && s.app.Event != nil {
			s.app.Event.Emit(EngineFallbackEvent, map[string]string{"reason": reason})
		}
		s.logger().Warn("edge tts degraded to fallback", "streak", s.edgeFailStreak, "error", err)
	}
}

func (s *Service) recordEdgeOK() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.edgeFailStreak = 0
	s.edgeNotified = false
}

func (s *Service) synthesizeLocal(text, voice string) (SynthesizeResult, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), localSynthTimeout)
	defer cancel()
	audio, err := s.local.synthesize(ctx, text, voice)
	if err != nil || len(audio) == 0 {
		s.logger().Debug("local tts failed", "error", err)
		return SynthesizeResult{}, false
	}
	model := s.local.modelForVoice(voice)
	return SynthesizeResult{
		AudioBase64: base64.StdEncoding.EncodeToString(audio),
		MimeType:    "audio/wav",
		Engine:      EngineLocal,
		Voice:       strings.TrimSuffix(filepath.Base(model), ".onnx"),
	}, true
}

// TTSStatus 返回本地引擎安装状态和可选发音，供精听页设置面板展示。
// EdgeAvailable 字段反映最近一次 Edge 连续失败计数是否已达阈值——
// 前端可据此在 UI 上标注「在线引擎当前不可用」。
func (s *Service) TTSStatus() EngineStatus {
	models := s.local.models()
	binary := s.local.binaryPath()
	s.mu.Lock()
	edgeAvailable := s.edgeFailStreak < edgeFailThreshold
	s.mu.Unlock()
	return EngineStatus{
		LocalBinaryReady: binary != "",
		LocalBinaryPath:  binary,
		LocalModels:      models,
		EdgeVoices:       append([]Voice(nil), edgeVoices...),
		DefaultVoice:     DefaultEdgeVoice,
		EdgeAvailable:    edgeAvailable,
	}
}

// InstallLocalTTS 下载 Piper 可执行文件和指定语音模型；进度通过 Wails 事件推送。
func (s *Service) InstallLocalTTS(voice string) InstallResult {
	ctx, cancel := context.WithTimeout(context.Background(), installTimeout)
	defer cancel()

	emit := func(progress InstallProgress) {
		if s.app != nil && s.app.Event != nil {
			s.app.Event.Emit(InstallProgressEvent, progress)
		}
	}
	if err := s.installLocal(ctx, voice, emit); err != nil {
		s.logger().Warn("install local tts", "voice", voice, "error", err)
		return InstallResult{OK: false, Error: err.Error(), Status: s.TTSStatus()}
	}
	return InstallResult{OK: true, Status: s.TTSStatus()}
}

func (s *Service) logger() *slog.Logger {
	if s.app != nil && s.app.Logger != nil {
		return s.app.Logger
	}
	return slog.Default()
}

func isLocalVoice(voice string, local *localEngine) bool {
	voice = strings.TrimSpace(voice)
	if voice == "" {
		return false
	}
	id := strings.TrimSuffix(filepath.Base(voice), ".onnx")
	for _, model := range local.models() {
		if strings.EqualFold(model.ID, id) {
			return true
		}
	}
	return false
}
