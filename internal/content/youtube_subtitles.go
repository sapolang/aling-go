// YouTube 在线视频的字幕获取。
//
// 原先直接抓 watch 页的 timedtext 地址，YouTube 加上 pot 签名校验后已失效（返回空内容），
// 这里改为交给 yt-dlp 取字幕；视频本身没有字幕轨道时，下载音轨交给本地 Whisper 转录。
package content

import (
	"context"
	"fmt"
	"html"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"regexp"
)

// youtubeSubtitleLangPriority 字幕语言优先级，取第一个命中的轨道
var youtubeSubtitleLangPriority = []string{
	"en", "en-US", "en-GB", "en-orig", "zh-Hans", "zh-Hant", "zh", "zh-CN", "zh-TW",
}

// ytDlpSubtitleLangs 交给 yt-dlp 的候选语种，只取少量避免触发 YouTube 限流
const ytDlpSubtitleLangs = "en,zh-Hans,zh-Hant"

var vttTagRe = regexp.MustCompile(`<[^>]+>`)

// findYtDlp 优先用 PATH 里的 yt-dlp，兼容常见的 Homebrew 安装位置
func findYtDlp() string {
	if p, err := exec.LookPath("yt-dlp"); err == nil {
		return p
	}
	for _, p := range []string{"/opt/homebrew/bin/yt-dlp", "/usr/local/bin/yt-dlp", "/usr/bin/yt-dlp"} {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

// runYtDlp 执行 yt-dlp，代理复用订阅拉取的配置
func (s *PlatformService) runYtDlp(timeout time.Duration, args ...string) error {
	bin := findYtDlp()
	if bin == "" {
		return fmt.Errorf("未找到 yt-dlp，请先安装（brew install yt-dlp）")
	}
	base := []string{"--no-warnings", "--no-progress", "--no-playlist", "--no-mtime"}
	if proxy := strings.TrimSpace(s.feed.GetProxy()); proxy != "" {
		base = append(base, "--proxy", proxy)
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, bin, append(base, args...)...).CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if i := strings.LastIndex(msg, "\n"); i >= 0 {
			msg = msg[i+1:]
		}
		if msg == "" {
			msg = err.Error()
		}
		if strings.TrimSpace(s.feed.GetProxy()) == "" {
			msg += "（如网络受限，请在播客页配置代理）"
		}
		return fmt.Errorf("yt-dlp 执行失败: %s", msg)
	}
	return nil
}

// fetchYouTubeSubtitlesViaYtDlp 用 yt-dlp 下载字幕文件，不下载视频
func (s *PlatformService) fetchYouTubeSubtitlesViaYtDlp(videoID string) ([]SubtitleCue, error) {
	dir, err := os.MkdirTemp("", "aling-yt-sub-*")
	if err != nil {
		return nil, err
	}
	defer func() { _ = os.RemoveAll(dir) }()

	runErr := s.runYtDlp(90*time.Second,
		"--skip-download", "--write-subs", "--write-auto-subs",
		"--sub-langs", ytDlpSubtitleLangs, "--sub-format", "vtt",
		"-o", filepath.Join(dir, "%(id)s"),
		"https://www.youtube.com/watch?v="+videoID,
	)

	files, _ := filepath.Glob(filepath.Join(dir, "*.vtt"))
	if len(files) == 0 {
		if runErr != nil {
			return nil, runErr
		}
		return nil, fmt.Errorf("YouTube 上没有可用字幕")
	}

	raw, err := os.ReadFile(pickSubtitleFile(files))
	if err != nil {
		return nil, fmt.Errorf("读取字幕文件失败: %w", err)
	}
	return parseVTT(raw)
}

// pickSubtitleFile 按语言优先级从 <id>.<lang>.vtt 里挑一个
func pickSubtitleFile(files []string) string {
	byLang := make(map[string]string, len(files))
	for _, f := range files {
		name := strings.TrimSuffix(filepath.Base(f), ".vtt")
		if i := strings.LastIndex(name, "."); i >= 0 {
			byLang[name[i+1:]] = f
		} else {
			byLang[name] = f
		}
	}
	for _, lang := range youtubeSubtitleLangPriority {
		if f, ok := byLang[lang]; ok {
			return f
		}
	}
	return files[0]
}

// transcribeYouTubeAudio 没有字幕时下载音轨，交给本地 Whisper 转录
func (s *PlatformService) transcribeYouTubeAudio(videoID string) ([]SubtitleCue, error) {
	return s.transcribeAudio("https://www.youtube.com/watch?v=" + videoID)
}

// transcribeBilibiliAudio 通过临时 Netscape Cookie 文件携带登录态，避免把 Cookie 暴露在进程参数中。
func (s *PlatformService) transcribeBilibiliAudio(bvid string) ([]SubtitleCue, error) {
	var extraArgs []string
	cookiePath, err := bilibiliYtDlpCookieFile(s.feed.bilibiliCookie())
	if err != nil {
		return nil, err
	}
	if cookiePath != "" {
		defer func() { _ = os.Remove(cookiePath) }()
		extraArgs = append(extraArgs, "--cookies", cookiePath)
	}
	return s.transcribeAudio("https://www.bilibili.com/video/"+bvid, extraArgs...)
}

func bilibiliYtDlpCookieFile(cookie string) (string, error) {
	if strings.TrimSpace(cookie) == "" {
		return "", nil
	}
	var content strings.Builder
	content.WriteString("# Netscape HTTP Cookie File\n")
	for _, part := range strings.Split(cookie, ";") {
		kv := strings.SplitN(strings.TrimSpace(part), "=", 2)
		if len(kv) != 2 || kv[0] == "" || strings.ContainsAny(kv[0]+kv[1], "\t\r\n") {
			continue
		}
		fmt.Fprintf(&content, ".bilibili.com\tTRUE\t/\tFALSE\t0\t%s\t%s\n", kv[0], kv[1])
	}

	f, err := os.CreateTemp("", "aling-bili-cookies-*")
	if err != nil {
		return "", fmt.Errorf("创建临时 Cookie 文件失败: %w", err)
	}
	path := f.Name()
	if _, err := f.WriteString(content.String()); err != nil {
		_ = f.Close()
		_ = os.Remove(path)
		return "", fmt.Errorf("写入临时 Cookie 文件失败: %w", err)
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(path)
		return "", fmt.Errorf("关闭临时 Cookie 文件失败: %w", err)
	}
	return path, nil
}

func (s *PlatformService) checkWhisperReady() error {
	if s.whisper == nil {
		return fmt.Errorf("本地转录服务不可用")
	}
	if s.whisper.findWhisperSidecar() == "" {
		return fmt.Errorf("缺少本地转录组件 whisper-sidecar")
	}
	if _, err := os.Stat(s.whisper.modelPath()); err != nil {
		return fmt.Errorf("尚未下载 Whisper 模型，请先在设置里下载")
	}
	return nil
}

func (s *PlatformService) transcribeAudio(videoURL string, extraArgs ...string) ([]SubtitleCue, error) {
	if err := s.checkWhisperReady(); err != nil {
		return nil, err
	}

	dir, err := os.MkdirTemp("", "aling-online-audio-*")
	if err != nil {
		return nil, err
	}
	defer func() { _ = os.RemoveAll(dir) }()

	args := []string{
		"-f", "bestaudio/best", "--no-part",
		"-o", filepath.Join(dir, "audio.%(ext)s"),
	}
	args = append(args, extraArgs...)
	args = append(args, videoURL)
	if err := s.runYtDlp(15*time.Minute, args...); err != nil {
		return nil, err
	}

	files, _ := filepath.Glob(filepath.Join(dir, "audio.*"))
	if len(files) == 0 {
		return nil, fmt.Errorf("下载音频失败")
	}
	// 下载到的多为 webm/opus，内置 whisper 只带 miniaudio，解码不了这类封装
	wavPath := filepath.Join(dir, "audio-16k.wav")
	if err := s.transcodeToWav(files[0], wavPath); err != nil {
		return nil, err
	}
	return s.transcribeAudioFile(wavPath)
}

// transcodeToWav 把下载到的音轨转成 whisper 需要的 16kHz 单声道 PCM
func (s *PlatformService) transcodeToWav(input, output string) error {
	ffmpeg := findFFmpeg(s.dataDir, s.app.Logger)
	if ffmpeg == "" {
		return fmt.Errorf("缺少 ffmpeg，无法转码音轨")
	}
	cmd := exec.Command(ffmpeg, "-y", "-i", input, "-vn", "-ar", "16000", "-ac", "1", "-sample_fmt", "s16", output)
	out, err := cmd.CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if i := strings.LastIndex(msg, "\n"); i >= 0 {
			msg = msg[i+1:]
		}
		if msg == "" {
			msg = err.Error()
		}
		return fmt.Errorf("音轨转码失败: %s", msg)
	}
	if fi, statErr := os.Stat(output); statErr != nil || fi.Size() == 0 {
		return fmt.Errorf("音轨转码失败: 输出文件为空")
	}
	return nil
}

func (s *PlatformService) transcribeAudioFile(path string) ([]SubtitleCue, error) {
	items := s.whisper.Transcribe(path)
	cues := make([]SubtitleCue, 0, len(items))
	for _, it := range items {
		if it.Text == "" {
			continue
		}
		cues = append(cues, SubtitleCue{Start: it.StartTime, End: it.EndTime, Text: it.Text})
	}
	if len(cues) == 0 {
		return nil, fmt.Errorf("本地转录没有返回结果")
	}
	return cues, nil
}

// parseVTT 解析 WebVTT。
// YouTube 的字幕是「滚动式」：每个 cue 会重复上一行再加新行，另有 0.01 秒的收尾 cue，
// 这里跳过收尾 cue、去掉与上一条重复的行，得到干净的字幕条目。
func parseVTT(raw []byte) ([]SubtitleCue, error) {
	lines := strings.Split(strings.ReplaceAll(string(raw), "\r\n", "\n"), "\n")
	cues := make([]SubtitleCue, 0, 128)
	var (
		start, end float64
		texts      []string
		active     bool
	)
	prevText := ""
	flush := func() {
		if !active {
			return
		}
		active = false
		textLines := texts
		texts = nil
		// 0.01 秒的 cue 是滚动字幕的补全标记，不产生新内容
		if end-start <= 0.02 {
			return
		}
		// 滚动字幕里前面的行都是上一条的重复，只保留最后一行（新内容）
		if len(textLines) > 1 {
			textLines = textLines[len(textLines)-1:]
		}
		text := strings.TrimSpace(strings.Join(textLines, " "))
		if text == "" || text == prevText {
			return
		}
		prevText = text
		cues = append(cues, SubtitleCue{Start: start, End: end, Text: text})
	}

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.Contains(trimmed, "-->") {
			flush()
			parts := strings.SplitN(trimmed, "-->", 2)
			start = parseVTTTime(parts[0])
			end = 0
			if fields := strings.Fields(strings.TrimSpace(parts[1])); len(fields) > 0 {
				end = parseVTTTime(fields[0])
			}
			active = true
			continue
		}
		if !active {
			continue
		}
		if trimmed == "" {
			// 时间行后面常跟一个空行，此时还不该结束 cue
			if len(texts) > 0 {
				flush()
			}
			continue
		}
		if text := strings.TrimSpace(vttTagRe.ReplaceAllString(trimmed, "")); text != "" {
			texts = append(texts, html.UnescapeString(text))
		}
	}
	flush()

	if len(cues) == 0 {
		return nil, fmt.Errorf("字幕文件为空")
	}
	return cues, nil
}

// parseVTTTime 解析 00:00:01.234 / 01:02.345 形式的时间戳
func parseVTTTime(s string) float64 {
	parts := strings.Split(strings.TrimSpace(s), ":")
	if len(parts) < 2 {
		return 0
	}
	var h, m int
	var sec float64
	switch len(parts) {
	case 3:
		h, _ = strconv.Atoi(parts[0])
		m, _ = strconv.Atoi(parts[1])
		sec, _ = strconv.ParseFloat(parts[2], 64)
	default:
		m, _ = strconv.Atoi(parts[0])
		sec, _ = strconv.ParseFloat(parts[1], 64)
	}
	return float64(h*3600+m*60) + sec
}
