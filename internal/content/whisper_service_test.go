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

func TestParseWhisperSegmentLine(t *testing.T) {
	tests := []struct {
		name      string
		line      string
		wantOK    bool
		wantStart float64
		wantEnd   float64
		wantText  string
	}{
		{
			name:      "标准行",
			line:      "[00:00:01.000 --> 00:00:05.500]  Hello world",
			wantOK:    true,
			wantStart: 1.0,
			wantEnd:   5.5,
			wantText:  "Hello world",
		},
		{
			name:      "带毫秒",
			line:      "[00:01:23.456 --> 00:01:28.999]  a longer Chinese text here",
			wantOK:    true,
			wantStart: 83.456,
			wantEnd:   88.999,
			wantText:  "a longer Chinese text here",
		},
		{
			name:   "非字幕行（stderr 被误送进来）",
			line:   "whisper_full_with_state: processing 'foo.wav' ...",
			wantOK: false,
		},
		{
			name:   "空文本段",
			line:   "[00:00:10.000 --> 00:00:15.000]",
			wantOK: false,
		},
		{
			name:   "无方括号",
			line:   "00:00:01.000 --> 00:00:05.500  foo",
			wantOK: false,
		},
		{
			name:   "时间戳非法",
			line:   "[00:60:00.000 --> 00:60:05.000]  bad",
			wantOK: false,
		},
		{
			name:      "含 CR 的 Windows 输出",
			line:      "[00:00:01.000 --> 00:00:02.000]  hi\r",
			wantOK:    true,
			wantStart: 1.0,
			wantEnd:   2.0,
			wantText:  "hi",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			item, ok := parseWhisperSegmentLine(tt.line)
			if ok != tt.wantOK {
				t.Fatalf("ok = %v, want %v (item=%+v)", ok, tt.wantOK, item)
			}
			if !ok {
				return
			}
			if item.StartTime != tt.wantStart {
				t.Errorf("start = %v, want %v", item.StartTime, tt.wantStart)
			}
			if item.EndTime != tt.wantEnd {
				t.Errorf("end = %v, want %v", item.EndTime, tt.wantEnd)
			}
			if item.Text != tt.wantText {
				t.Errorf("text = %q, want %q", item.Text, tt.wantText)
			}
		})
	}
}

func TestParseWhisperTimestamp(t *testing.T) {
	tests := []struct {
		input string
		want  float64
		ok    bool
	}{
		{"00:00:00.000", 0, true},
		{"00:00:01.500", 1.5, true},
		{"00:01:30.000", 90, true},
		{"01:02:03.456", 3723.456, true},
		{"00:00:00,000", 0, true}, // SRT 风格逗号
		{"", 0, false},
		{"abc", 0, false},
		{"00:60:00.000", 0, false}, // 非法分
		{"00:00:60.000", 0, false}, // 非法秒
	}
	for _, tt := range tests {
		got, ok := parseWhisperTimestamp(tt.input)
		if ok != tt.ok {
			t.Errorf("%q: ok = %v, want %v", tt.input, ok, tt.ok)
			continue
		}
		if !ok {
			continue
		}
		if got != tt.want {
			t.Errorf("%q: got %v, want %v", tt.input, got, tt.want)
		}
	}
}

func TestParseYtDlpProgress(t *testing.T) {
	tests := []struct {
		line   string
		want   int
		wantOK bool
	}{
		{"[download]  42.5% of 3.45MiB at 1.23MiB/s ETA 00:02", 43, true},
		{"[download] 100% of 3.45MiB", 100, true},
		{"[download]   0.0% of ~3.45MiB", 0, true},
		{"[info] Some info message", 0, false},
		{"[download] Downloading webpage", 0, false}, // 有 [download] 但没百分比
		{"[download]  99.9%", 100, true},
		{"", 0, false},
	}
	for _, tt := range tests {
		got, ok := parseYtDlpProgress(tt.line)
		if ok != tt.wantOK {
			t.Errorf("%q: ok=%v, want %v", tt.line, ok, tt.wantOK)
			continue
		}
		if !ok {
			continue
		}
		if got != tt.want {
			t.Errorf("%q: got %d, want %d", tt.line, got, tt.want)
		}
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
