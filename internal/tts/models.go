package tts

// TTS 引擎标识，前端据此决定是否回退到 window.speechSynthesis。
const (
	EngineEdge     = "edge"
	EngineLocal    = "local"
	EngineFallback = "fallback"

	DefaultEdgeVoice  = "en-US-AriaNeural"
	DefaultLocalVoice = "en_US-lessac-medium"
)

// SynthesizeResult 是单句合成的结果。音频以 Base64 返回，前端转成内存 Blob URL，
// 不写磁盘；Engine 为 fallback 时表示应使用浏览器原生语音。
type SynthesizeResult struct {
	AudioBase64 string `json:"audioBase64"`
	MimeType    string `json:"mimeType"`
	Engine      string `json:"engine"`
	Voice       string `json:"voice"`
	Error       string `json:"error"`
}

// Voice 是可选择的发音。
type Voice struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Engine string `json:"engine"`
}

// EngineStatus 描述当前可用的合成能力。
type EngineStatus struct {
	LocalBinaryReady bool    `json:"localBinaryReady"`
	LocalBinaryPath  string  `json:"localBinaryPath"`
	LocalModels      []Voice `json:"localModels"`
	EdgeVoices       []Voice `json:"edgeVoices"`
	DefaultVoice     string  `json:"defaultVoice"`
	EdgeAvailable    bool    `json:"edgeAvailable"`
}

// InstallProgress 通过 Wails 事件推送，前端展示下载/解压进度。
type InstallProgress struct {
	Progress int    `json:"progress"`
	Status   string `json:"status"`
	Message  string `json:"message"`
	Voice    string `json:"voice"`
}

// InstallResult 是离线语音包装载结果。
type InstallResult struct {
	OK     bool         `json:"ok"`
	Error  string       `json:"error"`
	Status EngineStatus `json:"status"`
}

var edgeVoices = []Voice{
	{ID: "en-US-AriaNeural", Name: "Aria · 美式女声", Engine: EngineEdge},
	{ID: "en-US-GuyNeural", Name: "Guy · 美式男声", Engine: EngineEdge},
	{ID: "en-US-JennyNeural", Name: "Jenny · 美式女声", Engine: EngineEdge},
	{ID: "en-GB-SoniaNeural", Name: "Sonia · 英式女声", Engine: EngineEdge},
}
