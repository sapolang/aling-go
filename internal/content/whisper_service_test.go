package content

import (
	"os"
	"path/filepath"
	"sync"
	"testing"

	"aling-go/internal/config"
)

func TestListWhisperModelsReturnsTypedList(t *testing.T) {
	s := &WhisperService{dataDir: t.TempDir()}

	list := s.ListWhisperModels()
	if len(list) != len(whisperModels) {
		t.Fatalf("模型数量 = %d, want %d", len(list), len(whisperModels))
	}
	for _, m := range list {
		if m.Downloaded {
			t.Fatalf("空目录下不应标记已下载: %+v", m)
		}
	}

	modelDir := filepath.Join(s.dataDir, "whisper-models")
	if err := os.MkdirAll(modelDir, 0755); err != nil {
		t.Fatal(err)
	}
	first := whisperModels[0]
	if err := os.WriteFile(filepath.Join(modelDir, first.File), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}

	list = s.ListWhisperModels()
	if !list[0].Downloaded {
		t.Fatalf("已存在的模型应标记为已下载: %+v", list[0])
	}
}

func TestGetDownloadProgressReturnsTypedState(t *testing.T) {
	s := &WhisperService{dataDir: t.TempDir(), dlProgress: -1}
	if got := s.GetDownloadProgress(); got != nil {
		t.Fatalf("空闲时应返回 nil, got %+v", got)
	}

	s.dlModel = "base"
	s.dlProgress = 42
	got := s.GetDownloadProgress()
	if got == nil || got.Model != "base" || got.Progress != 42 {
		t.Fatalf("下载进度不符: %+v", got)
	}
}

func TestDownloadModelKeepsCurrentModelOnChecksumFailure(t *testing.T) {
	dir := t.TempDir()
	s := &WhisperService{dataDir: dir, modelFile: "ggml-tiny.bin"}
	modelDir := filepath.Join(dir, "whisper-models")
	if err := os.MkdirAll(modelDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(modelDir, "ggml-tiny.bin"), []byte("current"), 0644); err != nil {
		t.Fatal(err)
	}

	err := s.downloadModel("base", []string{"https://example.invalid/ggml-base.bin"}, func(_, tmpPath string) error {
		return os.WriteFile(tmpPath, []byte("corrupted"), 0600)
	})
	if err == nil {
		t.Fatal("SHA256 校验失败应返回错误")
	}

	if got := s.WhisperStatus(); got.Model != "ggml-tiny.bin" || !got.Loaded {
		t.Fatalf("下载失败后应保持原模型, got %+v", got)
	}
	if _, err := os.Stat(filepath.Join(modelDir, "ggml-base.bin")); err == nil {
		t.Fatal("校验失败不应安装模型文件")
	}
}

func TestWhisperConfigConcurrentAccess(t *testing.T) {
	dir := t.TempDir()
	s := &WhisperService{
		dataDir:     dir,
		store:       config.New(dir, nil),
		modelFile:   "ggml-tiny.bin",
		whisperLang: "en",
	}

	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 100; j++ {
				s.SetWhisperModel("base")
				s.SetWhisperLang("zh")
				_ = s.WhisperStatus()
				_ = s.GetWhisperLang()
				_ = s.modelPath()
			}
		}()
	}
	wg.Wait()

	st := s.store.Settings()
	if st.WhisperModel != "ggml-base.bin" || st.WhisperLang != "zh" {
		t.Fatalf("设置未持久化: %+v", st)
	}
}
