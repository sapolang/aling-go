package tts

import (
	"bytes"
	"encoding/base64"
	"os"
	"testing"
)

// TestManualEdgeNetwork 会真正访问 Edge-TTS。默认跳过，设置
// ALING_TEST_EDGE=1 后运行，用于确认在线引擎和声音切换仍然可用。
func TestManualEdgeNetwork(t *testing.T) {
	if os.Getenv("ALING_TEST_EDGE") != "1" {
		t.Skip("set ALING_TEST_EDGE=1 to call Edge-TTS")
	}
	const text = "Hello, this is a test of the listening player."
	first := synthesizeForTest(t, text, "en-US-AriaNeural")
	second := synthesizeForTest(t, text, "en-US-GuyNeural")
	if bytes.Equal(first, second) {
		t.Fatal("不同声音返回了完全相同的音频")
	}
}

func synthesizeForTest(t *testing.T, text, voice string) []byte {
	t.Helper()
	service := NewService(nil, t.TempDir())
	result := service.SynthesizeSentence(text, voice)
	if result.Engine != EngineEdge {
		t.Fatalf("engine = %s, error = %s", result.Engine, result.Error)
	}
	audio, err := base64.StdEncoding.DecodeString(result.AudioBase64)
	if err != nil {
		t.Fatal(err)
	}
	if len(audio) < 1024 {
		t.Fatalf("audio too short: %d", len(audio))
	}
	t.Logf("edge audio bytes = %d, voice = %s", len(audio), result.Voice)
	return audio
}
