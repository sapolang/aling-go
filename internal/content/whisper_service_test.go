package content

import (
	"os"
	"path/filepath"
	"testing"
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
