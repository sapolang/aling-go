package content

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeYtDlp 用临时目录里的 sh 脚本冒充 yt-dlp，并通过 PATH 让 findYtDlp 命中。
// 只用于验证输出流路由，脚本本身不关心传入参数。
func fakeYtDlp(t *testing.T, script string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("伪 yt-dlp 依赖 sh 脚本，Windows 不适用")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "yt-dlp")
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"+script), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)
}

func TestRunYtDlpStreamsProgressFromStdout(t *testing.T) {
	// yt-dlp 的进度行走 stdout；错误行才走 stderr。
	fakeYtDlp(t, `echo "[download]  42.5% of 3.00MiB at 1.00MiB/s"
echo "[download] 100% of 3.00MiB"
`)

	s := &PlatformService{feed: &FeedService{}}
	var got []int
	if err := s.runYtDlp(5*time.Second, func(pct int) { got = append(got, pct) }); err != nil {
		t.Fatalf("runYtDlp error: %v", err)
	}

	want := []int{43, 100}
	if len(got) != len(want) {
		t.Fatalf("progress = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("progress = %v, want %v", got, want)
		}
	}
}

func TestRunYtDlpReportsStderrError(t *testing.T) {
	fakeYtDlp(t, `echo "[download]  10.0% of 3.00MiB"
echo "ERROR: [youtube] boom" >&2
exit 1
`)

	s := &PlatformService{feed: &FeedService{}}
	var got []int
	err := s.runYtDlp(5*time.Second, func(pct int) { got = append(got, pct) })
	if err == nil || !strings.Contains(err.Error(), "ERROR: [youtube] boom") {
		t.Fatalf("error = %v, want stderr message", err)
	}
	if len(got) != 1 || got[0] != 10 {
		t.Fatalf("progress = %v, want [10]", got)
	}
}

// 增量字幕事件 key 必须与前端约定一致：
// YouTube 用 yt:<videoID>，B站用 bili:<bvid>，播客用 podcast:<episodeID>。
func TestSubtitleEventKeyMatchesFrontend(t *testing.T) {
	tests := []struct {
		name string
		got  string
		want string
	}{
		{"youtube", platformSubtitleEventKey(platformYouTube, "dQw4w9WgXcQ"), "yt:dQw4w9WgXcQ"},
		{"bilibili", platformSubtitleEventKey(platformBilibili, "BV1xx411c7mD"), "bili:BV1xx411c7mD"},
		{"podcast", podcastSubtitleEventKey(42), "podcast:42"},
	}
	for _, tt := range tests {
		if tt.got != tt.want {
			t.Errorf("%s key = %q, want %q", tt.name, tt.got, tt.want)
		}
	}
}

// 在线音轨缓存按事件 key 固定在同一目录：转录失败后重试要复用已下载的音频，
// 不能因为临时目录名变化而重新下载。
func TestOnlineAudioDirIsStablePerEventKey(t *testing.T) {
	s := &PlatformService{dataDir: t.TempDir()}

	first := s.onlineAudioDir("yt:dQw4w9WgXcQ")
	second := s.onlineAudioDir("yt:dQw4w9WgXcQ")
	other := s.onlineAudioDir("yt:xxxxxxxxxxx")

	if first != second {
		t.Fatalf("同一事件 key 应返回同一目录: %q != %q", first, second)
	}
	if first == other {
		t.Fatalf("不同事件 key 不应共用目录: %q", first)
	}
	if !strings.HasPrefix(first, filepath.Join(s.dataDir, "aling", "temp-audio")) {
		t.Fatalf("缓存目录应位于 temp-audio 下: %q", first)
	}
}

// downloadedAudio 只把 yt-dlp 已完成的音轨当作可复用结果：
// 下载中的 .part、转码后的 wav 以及空文件都不能当作已下载的原始音轨。
func TestDownloadedAudioIgnoresPartialAndTranscoded(t *testing.T) {
	dir := t.TempDir()
	write := func(name string, content string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}

	write("audio.webm.part", "partial")
	write("audio-16k.wav", "wav")
	if got := downloadedAudio(dir); got != "" {
		t.Fatalf("不应把 .part 或 wav 当作已下载音轨: %q", got)
	}

	write("audio.webm", "complete")
	if got := downloadedAudio(dir); got != filepath.Join(dir, "audio.webm") {
		t.Fatalf("应复用已完成的音轨，got %q", got)
	}
}

// 转录成功后只删原始下载音轨，保留 16kHz WAV 供「重新转录」复用；
// 下载中的 .part 应保留以支持续传。
func TestRemoveDownloadedAudioKeepsWavAndPartial(t *testing.T) {
	dir := t.TempDir()
	write := func(name string) string {
		t.Helper()
		path := filepath.Join(dir, name)
		if err := os.WriteFile(path, []byte("x"), 0644); err != nil {
			t.Fatal(err)
		}
		return path
	}

	raw := write("audio.webm")
	part := write("audio.webm.part")
	wav := write("audio-16k.wav")

	removeDownloadedAudio(dir)

	if _, err := os.Stat(raw); !os.IsNotExist(err) {
		t.Fatalf("原始下载音轨应被删除, err = %v", err)
	}
	for name, path := range map[string]string{"WAV": wav, ".part": part} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("%s 不应被删除: %v", name, err)
		}
	}
}

// 转码写入的是 .part 临时文件，真实 ffmpeg 无法从该扩展名推断容器格式；
// 缺少 -f wav 会报 "Error opening output files: Invalid argument"，使本地转录失败。
func TestTranscodeToWavSpecifiesOutputFormat(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("伪 ffmpeg 依赖 sh 脚本，Windows 不适用")
	}
	dir := t.TempDir()
	input := filepath.Join(dir, "audio.webm")
	output := filepath.Join(dir, "audio-16k.wav")
	if err := os.WriteFile(input, []byte("fake audio"), 0644); err != nil {
		t.Fatal(err)
	}

	// 模拟真实 ffmpeg 的约束：输出名不是标准扩展名时，缺少 -f 就拒绝打开输出文件。
	script := `#!/bin/sh
case " $* " in
  *" -f wav "*) ;;
  *) echo "Error opening output files: Invalid argument" >&2; exit 1 ;;
esac
for last; do :; done
printf 'fake-wav' > "$last"
`
	ffmpeg := filepath.Join(dir, "ffmpeg")
	if err := os.WriteFile(ffmpeg, []byte(script), 0755); err != nil {
		t.Fatal(err)
	}

	if err := transcodeToWavWithFFmpeg(ffmpeg, input, output); err != nil {
		t.Fatalf("transcodeToWavWithFFmpeg: %v", err)
	}
	data, err := os.ReadFile(output)
	if err != nil || string(data) != "fake-wav" {
		t.Fatalf("output = %q, err = %v", data, err)
	}
	if _, err := os.Stat(output + ".part"); !os.IsNotExist(err) {
		t.Fatalf("临时 .part 应被清理: %v", err)
	}
}

// fakeFFmpegForWarm 在临时目录放置一个 ffmpeg：它统计调用次数，模拟耗时后产出 WAV。
// 返回 ffmpeg 目录与计数文件路径。
func fakeFFmpegForWarm(t *testing.T, counter string) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("伪 ffmpeg 依赖 sh 脚本，Windows 不适用")
	}
	dir := t.TempDir()
	script := "#!/bin/sh\n" +
		"echo x >> '" + counter + "'\n" +
		"sleep 0.2\n" +
		"for last; do :; done\n" +
		"printf 'fake-wav' > \"$last\"\n"
	path := filepath.Join(dir, "ffmpeg")
	if err := os.WriteFile(path, []byte(script), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)
	return dir
}

// 并发的预热与转录必须共享同一次下载+转码，否则两个任务会同时写 audio-16k.wav。
func TestPrepareOnlineAudioDeduplicatesConcurrentCalls(t *testing.T) {
	dataDir := t.TempDir()
	counter := filepath.Join(t.TempDir(), "ffmpeg-calls")
	fakeFFmpegForWarm(t, counter)

	eventKey := "yt:concurrent"
	dir := filepath.Join(dataDir, "aling", "temp-audio", "online-"+md5Hash(eventKey))
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	// 已有下载好的原始音轨，跳过 yt-dlp，只走转码
	if err := os.WriteFile(filepath.Join(dir, "audio.m4a"), []byte("raw"), 0644); err != nil {
		t.Fatal(err)
	}

	s := &PlatformService{dataDir: dataDir, audioFlights: make(map[string]*audioFlight)}
	const n = 4
	results := make([]string, n)
	errs := make([]error, n)
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			results[i], errs[i] = s.prepareOnlineAudio("https://example.invalid", eventKey)
		}(i)
	}
	wg.Wait()

	for i := 0; i < n; i++ {
		if errs[i] != nil {
			t.Fatalf("call %d error: %v", i, errs[i])
		}
		if results[i] != filepath.Join(dir, "audio-16k.wav") {
			t.Fatalf("call %d wavPath = %q", i, results[i])
		}
	}
	raw, err := os.ReadFile(counter)
	if err != nil {
		t.Fatalf("读取计数失败: %v", err)
	}
	if got := strings.Count(string(raw), "x"); got != 1 {
		t.Fatalf("ffmpeg 调用次数 = %d, want 1", got)
	}
}

// 预热命中已有 WAV 时应立即返回，不再触发 ffmpeg，也不要求 Whisper 模型就绪。
func TestWarmAudioReusesCachedWav(t *testing.T) {
	dataDir := t.TempDir()
	counter := filepath.Join(t.TempDir(), "ffmpeg-calls")
	fakeFFmpegForWarm(t, counter)

	eventKey := "bili:BV1xx411c7mD"
	dir := filepath.Join(dataDir, "aling", "temp-audio", "online-"+md5Hash(eventKey))
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	wav := filepath.Join(dir, "audio-16k.wav")
	if err := os.WriteFile(wav, []byte("cached-wav"), 0644); err != nil {
		t.Fatal(err)
	}

	// feed 与 whisper 均为 nil：预热不依赖它们
	s := &PlatformService{dataDir: dataDir, audioFlights: make(map[string]*audioFlight)}
	res := s.WarmAudio("bilibili", "BV1xx411c7mD")
	if !res.OK || !res.Ready {
		t.Fatalf("预热结果 = %+v, want OK && Ready", res)
	}
	if _, err := os.Stat(counter); !os.IsNotExist(err) {
		t.Fatalf("命中缓存时不应调用 ffmpeg: %v", err)
	}
}

func TestWarmAudioRejectsUnsupportedPlatform(t *testing.T) {
	s := &PlatformService{dataDir: t.TempDir(), audioFlights: make(map[string]*audioFlight)}
	res := s.WarmAudio("vimeo", "123")
	if res.OK || res.Error == "" {
		t.Fatalf("不支持的平台应返回错误: %+v", res)
	}
}
