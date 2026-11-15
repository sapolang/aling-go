package config

import (
	"errors"
	"io"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
)

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// legacyFiles 是旧版本分散存放的配置文件，迁移后应全部删除
var legacyFiles = []string{
	"whisper-model.txt",
	"whisper-lang.txt",
	"feed-config.json",
	"ai-config.json",
}

func writeFile(t *testing.T, dir, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestMigrateLegacyFiles(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "whisper-model.txt", "ggml-base.bin\n")
	writeFile(t, dir, "whisper-lang.txt", "zh")
	writeFile(t, dir, "feed-config.json", `{"proxy":"http://127.0.0.1:7890","bilibiliCookie":"SESSDATA=abc"}`)
	writeFile(t, dir, "ai-config.json", `{"baseUrl":"https://example.com/v1","apiKey":"sk-test","model":"m1"}`)

	s := New(dir, testLogger())

	settings := s.Settings()
	if settings.WhisperModel != "ggml-base.bin" || settings.WhisperLang != "zh" {
		t.Fatalf("whisper 配置未迁移: %+v", settings)
	}
	if settings.FeedProxy != "http://127.0.0.1:7890" {
		t.Fatalf("代理配置未迁移: %+v", settings)
	}
	if settings.AIBaseURL != "https://example.com/v1" || settings.AIModel != "m1" {
		t.Fatalf("AI 配置未迁移: %+v", settings)
	}

	secrets := s.Secrets()
	if secrets.AIAPIKey != "sk-test" || secrets.BilibiliCookie != "SESSDATA=abc" {
		t.Fatalf("敏感配置未迁移: %+v", secrets)
	}

	for _, name := range legacyFiles {
		if _, err := os.Stat(filepath.Join(dir, name)); !errors.Is(err, fs.ErrNotExist) {
			t.Fatalf("旧配置文件应已删除: %s", name)
		}
	}

	// 重启后从新文件读取
	reloaded := New(dir, testLogger())
	if got := reloaded.Settings(); got != settings {
		t.Fatalf("重启后设置不一致: %+v", got)
	}
	if got := reloaded.Secrets(); got != secrets {
		t.Fatalf("重启后敏感设置不一致: %+v", got)
	}
}

func TestMigrationKeepsUnparsableLegacyFile(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "feed-config.json", "not json")

	New(dir, testLogger())

	if _, err := os.Stat(filepath.Join(dir, "feed-config.json")); err != nil {
		t.Fatalf("解析失败的旧文件不应删除: %v", err)
	}
}

func TestNewSettingsTakePrecedenceOverLegacy(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, settingsFile, `{"whisperModel":"ggml-small.bin"}`)
	writeFile(t, dir, "whisper-model.txt", "ggml-base.bin")

	s := New(dir, testLogger())

	if got := s.Settings().WhisperModel; got != "ggml-small.bin" {
		t.Fatalf("新设置应优先于旧文件, got %q", got)
	}
	if _, err := os.Stat(filepath.Join(dir, "whisper-model.txt")); !errors.Is(err, fs.ErrNotExist) {
		t.Fatal("已迁移的旧文件应删除")
	}
}

func TestFilePermissions(t *testing.T) {
	dir := t.TempDir()
	s := New(dir, testLogger())

	if err := s.UpdateSettings(func(st *Settings) { st.WhisperLang = "en" }); err != nil {
		t.Fatal(err)
	}
	if err := s.UpdateSecrets(func(sc *Secrets) { sc.AIAPIKey = "sk-test" }); err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name string
		perm os.FileMode
	}{
		{settingsFile, settingsPerm},
		{secretsFile, secretsPerm},
	}
	for _, c := range cases {
		info, err := os.Stat(filepath.Join(dir, c.name))
		if err != nil {
			t.Fatal(err)
		}
		if got := info.Mode().Perm(); got != c.perm {
			t.Fatalf("%s 权限 = %o, want %o", c.name, got, c.perm)
		}
	}

	data, err := os.ReadFile(filepath.Join(dir, secretsFile))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) == "" {
		t.Fatal("secrets.json 不应为空")
	}
}

func TestUpdateMethodsPersistAcrossReload(t *testing.T) {
	dir := t.TempDir()
	s := New(dir, testLogger())

	if err := s.UpdateSettings(func(st *Settings) {
		st.WhisperModel = "ggml-base.bin"
		st.FeedProxy = "http://127.0.0.1:7890"
		st.AIModel = "deepseek-chat"
	}); err != nil {
		t.Fatal(err)
	}
	if err := s.UpdateSecrets(func(sc *Secrets) { sc.BilibiliCookie = "SESSDATA=abc" }); err != nil {
		t.Fatal(err)
	}

	reloaded := New(dir, testLogger())
	if got := reloaded.Settings().WhisperModel; got != "ggml-base.bin" {
		t.Fatalf("whisper 模型未持久化: %q", got)
	}
	if got := reloaded.Settings().FeedProxy; got != "http://127.0.0.1:7890" {
		t.Fatalf("代理未持久化: %q", got)
	}
	if got := reloaded.Secrets().BilibiliCookie; got != "SESSDATA=abc" {
		t.Fatalf("Cookie 未持久化: %q", got)
	}
}
