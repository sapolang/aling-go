package tts

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestWrapPCMAsWAV(t *testing.T) {
	pcm := []byte{1, 2, 3, 4}
	wav, err := wrapPCMAsWAV(pcm, 22050, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(wav) != 44+len(pcm) {
		t.Fatalf("WAV 长度 = %d, want %d", len(wav), 44+len(pcm))
	}
	if string(wav[:4]) != "RIFF" || string(wav[8:12]) != "WAVE" || string(wav[36:40]) != "data" {
		t.Fatalf("WAV 头不正确: %q", wav[:44])
	}
	if got := binary.LittleEndian.Uint32(wav[24:28]); got != 22050 {
		t.Fatalf("采样率 = %d", got)
	}
	if got := binary.LittleEndian.Uint32(wav[40:44]); got != uint32(len(pcm)) {
		t.Fatalf("data 长度 = %d", got)
	}
}

func TestWrapPCMRejectsEmpty(t *testing.T) {
	if _, err := wrapPCMAsWAV(nil, 22050, 1); err == nil {
		t.Fatal("空 PCM 应返回错误")
	}
}

func TestSecMSGECStableWithinFiveMinuteWindow(t *testing.T) {
	base := time.Date(2026, 11, 24, 12, 0, 0, 0, time.UTC)
	first := secMSGEC(base)
	second := secMSGEC(base.Add(4 * time.Minute))
	if first != second {
		t.Fatalf("同一 5 分钟窗口令牌应一致: %s != %s", first, second)
	}
	if len(first) != 81 || first != strings.ToUpper(first) || !strings.Contains(first, "-") {
		t.Fatalf("令牌格式不对: %q", first)
	}
	if third := secMSGEC(base.Add(6 * time.Minute)); third == first {
		t.Fatal("跨窗口后令牌应变化")
	}
}

func TestAudioPayload(t *testing.T) {
	header := []byte("Path:audio\r\n")
	message := make([]byte, 2+len(header)+3)
	binary.BigEndian.PutUint16(message[:2], uint16(len(header)))
	copy(message[2:], header)
	copy(message[2+len(header):], []byte{9, 8, 7})
	got := audioPayload(message)
	if string(got) != string([]byte{9, 8, 7}) {
		t.Fatalf("audioPayload = %v", got)
	}
	if audioPayload([]byte{1}) != nil {
		t.Fatal("过短消息应返回 nil")
	}
}

func TestBuildSSMLEscapesTextAndRestrictsVoice(t *testing.T) {
	ssml := buildSSML("A < B & C", normalizeEdgeVoice("bad'voice"))
	if !strings.Contains(ssml, "A &lt; B &amp; C") {
		t.Fatalf("文本未转义: %s", ssml)
	}
	if !strings.Contains(ssml, "name='"+DefaultEdgeVoice+"'") {
		t.Fatalf("非法 voice 未回退: %s", ssml)
	}
}

func TestSafeArchiveTargetRejectsTraversal(t *testing.T) {
	root := t.TempDir()
	if _, err := safeArchiveTarget(root, "../evil"); err == nil {
		t.Fatal("应拒绝 ../ 路径")
	}
	if _, err := safeArchiveTarget(root, "/etc/passwd"); err == nil {
		t.Fatal("应拒绝绝对路径")
	}
	got, err := safeArchiveTarget(root, "piper/espeak-ng-data/file")
	if err != nil {
		t.Fatalf("正常相对路径失败: %v", err)
	}
	if !strings.HasPrefix(got, root) {
		t.Fatalf("目标路径跑出 root: %s", got)
	}
}

func TestPiperAssetForPlatform(t *testing.T) {
	url, name, err := piperAssetForPlatform()
	if err != nil {
		t.Skipf("当前平台无自动安装资产: %v", err)
	}
	if !strings.HasPrefix(url, piperReleaseBase) || name == "" {
		t.Fatalf("资产地址异常: %s %s", url, name)
	}
}

// Piper 官方压缩包会把二进制放在 piper/ 子目录，安装器解压到 piper-dist 后
// 必须仍能找到 piper-dist/piper/piper，否则首次安装会被误判为失败。
func TestPiperBinaryFoundInArchiveLayout(t *testing.T) {
	dataDir := t.TempDir()
	engine := newLocalEngine(dataDir)
	binDir := filepath.Join(dataDir, "tts", "piper-dist", "piper")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}
	name := "piper"
	if runtime.GOOS == "windows" {
		name = "piper.exe"
	}
	binary := filepath.Join(binDir, name)
	if err := os.WriteFile(binary, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	espeakDir := filepath.Join(binDir, "espeak-ng-data")
	if err := os.MkdirAll(espeakDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if got := engine.binaryPath(); got != binary {
		t.Fatalf("binaryPath = %q, want %q", got, binary)
	}
	if got := engine.espeakDataDir(binary); got != espeakDir {
		t.Fatalf("espeakDataDir = %q", got)
	}
}
