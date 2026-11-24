// YouTube 在线视频的字幕获取。
//
// 原先直接抓 watch 页的 timedtext 地址，YouTube 加上 pot 签名校验后已失效（返回空内容），
// 这里改为交给 yt-dlp 取字幕；视频本身没有字幕轨道时，下载音轨交给本地 Whisper 转录。
package content

import (
	"bufio"
	"context"
	"fmt"
	"html"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	goRuntime "runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"aling-go/internal/proc"
)

// youtubeSubtitleLangPriority 字幕语言优先级，取第一个命中的轨道
var youtubeSubtitleLangPriority = []string{
	"en", "en-US", "en-GB", "en-orig", "zh-Hans", "zh-Hant", "zh", "zh-CN", "zh-TW",
}

// ytDlpSubtitleLangs 交给 yt-dlp 的候选语种，只取少量避免触发 YouTube 限流
const ytDlpSubtitleLangs = "en,zh-Hans,zh-Hant"

var vttTagRe = regexp.MustCompile(`<[^>]+>`)

// findYtDlp 保留 PATH 优先级，未安装到系统时回退到随应用发布或开发目录里的 sidecar。
func findYtDlp(dataDir string) string {
	if p, err := exec.LookPath("yt-dlp"); err == nil {
		return p
	}
	return firstExisting(ytDlpCandidates(dataDir, executableDir(), bundleResources(), goRuntime.GOOS))
}

// ytDlpCandidates 返回除 PATH 之外的 yt-dlp 查找路径。
// Windows 安装包把 yt-dlp.exe 放在 exe 同目录，因此 exe 目录排在相对路径之前。
func ytDlpCandidates(dataDir, exeDir, bundlePath, goos string) []string {
	if goos == "darwin" {
		locations := []string{
			"/opt/homebrew/bin/yt-dlp",
			"/usr/local/bin/yt-dlp",
			"/usr/bin/yt-dlp",
			filepath.Join(dataDir, "sidecar", "yt-dlp"),
			"sidecar/yt-dlp",
			"./sidecar/yt-dlp",
		}
		locations = append([]string{"../sidecar/yt-dlp"}, locations...)
		if bundlePath != "" {
			locations = append([]string{filepath.Join(bundlePath, "yt-dlp")}, locations...)
		}
		return locations
	}

	locations := []string{filepath.Join(dataDir, "sidecar", "yt-dlp.exe")}
	if exeDir != "" {
		locations = append(locations, filepath.Join(exeDir, "yt-dlp.exe"))
	}
	return append(locations,
		"sidecar/yt-dlp.exe",
		"./sidecar/yt-dlp.exe",
	)
}

// runYtDlp 执行 yt-dlp，代理复用订阅拉取的配置。
// onProgress 非空时，会解析 stdout 中的 [download] xx.x% 行回调百分比；
// 字幕下载等不需要进度的场景传 nil。
//
// yt-dlp 把进度和普通日志写到 stdout，错误写到 stderr，因此两个流都要并行读完：
// 只读 stderr 会拿不到进度，只读 stdout 又会在长时间下载时让 stderr 管道写满。
func (s *PlatformService) runYtDlp(timeout time.Duration, onProgress func(int), args ...string) error {
	bin := findYtDlp(s.dataDir)
	if bin == "" {
		return fmt.Errorf("未找到 yt-dlp，发布版请重新安装应用，开发环境请运行 make sidecar")
	}
	// --newline 让 yt-dlp 每行输出一个进度，便于流式解析；--no-warnings 减少噪音
	base := []string{"--no-warnings", "--no-playlist", "--no-mtime", "--newline"}
	if proxy := strings.TrimSpace(s.feed.GetProxy()); proxy != "" {
		base = append(base, "--proxy", proxy)
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := proc.CommandContext(ctx, bin, append(base, args...)...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("yt-dlp stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("yt-dlp stderr pipe: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("启动 yt-dlp 失败: %w", err)
	}

	var (
		wg       sync.WaitGroup
		errLines []string
	)
	wg.Add(2)

	// stderr: 只保留尾部少量行用于报错展示，避免长视频占内存
	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stderr)
		scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for scanner.Scan() {
			errLines = append(errLines, scanner.Text())
			if len(errLines) > 20 {
				errLines = errLines[len(errLines)-20:]
			}
		}
	}()

	// stdout: 解析下载百分比并透传给前端
	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		lastPct := -1
		for scanner.Scan() {
			if onProgress == nil {
				continue
			}
			if pct, ok := parseYtDlpProgress(scanner.Text()); ok && pct != lastPct {
				lastPct = pct
				onProgress(pct)
			}
		}
	}()

	wg.Wait()

	if err := cmd.Wait(); err != nil {
		msg := strings.TrimSpace(strings.Join(errLines, "\n"))
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

// parseYtDlpProgress 从 yt-dlp 输出行里解析下载百分比。
// 典型行：[download]  42.5% of 3.45MiB at 1.23MiB/s ETA 00:02
func parseYtDlpProgress(line string) (int, bool) {
	line = strings.TrimSpace(line)
	if !strings.HasPrefix(line, "[download]") {
		return 0, false
	}
	rest := strings.TrimSpace(strings.TrimPrefix(line, "[download]"))
	// 取第一个 % 前的数字
	end := strings.IndexByte(rest, '%')
	if end <= 0 {
		return 0, false
	}
	pctStr := strings.TrimSpace(rest[:end])
	var pct float64
	if _, err := fmt.Sscanf(pctStr, "%f", &pct); err != nil {
		return 0, false
	}
	return int(math.Round(pct)), true
}

// fetchYouTubeSubtitlesViaYtDlp 用 yt-dlp 下载字幕文件，不下载视频
func (s *PlatformService) fetchYouTubeSubtitlesViaYtDlp(videoID string) ([]SubtitleCue, error) {
	dir, err := os.MkdirTemp("", "aling-yt-sub-*")
	if err != nil {
		return nil, err
	}
	defer func() { _ = os.RemoveAll(dir) }()

	runErr := s.runYtDlp(90*time.Second, nil,
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

// platformSubtitleEventKey 返回增量字幕事件使用的稳定标识。
// 必须与前端 store 的 historyKey 约定一致（yt:<videoID> / bili:<bvid>），
// 否则前端会把它当成切换媒体后的过期事件丢弃。
func platformSubtitleEventKey(kind platformKind, id string) string {
	switch kind {
	case platformYouTube:
		return "yt:" + id
	case platformBilibili:
		return "bili:" + id
	}
	return id
}

// transcribeYouTubeAudio 没有字幕时下载音轨，交给本地 Whisper 转录
func (s *PlatformService) transcribeYouTubeAudio(videoID string) ([]SubtitleCue, error) {
	url := "https://www.youtube.com/watch?v=" + videoID
	return s.transcribeAudio(url, platformSubtitleEventKey(platformYouTube, videoID))
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
	url := "https://www.bilibili.com/video/" + bvid
	return s.transcribeAudio(url, platformSubtitleEventKey(platformBilibili, bvid), extraArgs...)
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

// onlineAudioDir 返回在线音轨的缓存目录，按事件 key 区分。
// 目录会保留转好的 WAV，重新转录时可直接复用，无需再次下载或分离音轨。
func (s *PlatformService) onlineAudioDir(eventKey string) string {
	return filepath.Join(s.dataDir, "aling", "temp-audio", "online-"+md5Hash(eventKey))
}

// downloadedAudio 返回目录中已下载完成的音轨。yt-dlp 下载中写 .part，
// 完成后才改名为最终文件，因此非 .part 且非空的文件即为完整下载结果。
func downloadedAudio(dir string) string {
	files, _ := filepath.Glob(filepath.Join(dir, "audio.*"))
	for _, file := range files {
		if strings.HasSuffix(file, ".part") {
			continue
		}
		if fi, err := os.Stat(file); err == nil && fi.Size() > 0 {
			return file
		}
	}
	return ""
}

// removeDownloadedAudio 删除下载的原始音轨，只保留转好的 WAV。
// 原始容器只为转码服务，转录成功后不再需要，留着会明显占用空间。
func removeDownloadedAudio(dir string) {
	files, _ := filepath.Glob(filepath.Join(dir, "audio.*"))
	for _, file := range files {
		if strings.HasSuffix(file, ".part") {
			continue
		}
		_ = os.Remove(file)
	}
}

func (s *PlatformService) transcribeAudio(videoURL, eventKey string, extraArgs ...string) ([]SubtitleCue, error) {
	if err := s.checkWhisperReady(); err != nil {
		return nil, err
	}

	dir := s.onlineAudioDir(eventKey)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, err
	}

	// 优先复用已转好的 WAV：重新转录时既不用再下载音频，也不用再分离音轨
	wavPath := filepath.Join(dir, "audio-16k.wav")
	if fi, err := os.Stat(wavPath); err != nil || fi.Size() == 0 {
		rawPath := downloadedAudio(dir)
		if rawPath == "" {
			// Whisper 只需要 16kHz 单声道，优先选低码率音轨减少下载量；逐级回退保证总有东西可下。
			// 不使用 --no-part，让 yt-dlp 在中断后用 .part 续传，且只有下载完整才改名为最终文件。
			args := []string{
				"-f", "bestaudio[abr<=64]/bestaudio[abr<=128]/bestaudio/best",
				"-o", filepath.Join(dir, "audio.%(ext)s"),
			}
			args = append(args, extraArgs...)
			args = append(args, videoURL)

			// 下载阶段：把 yt-dlp 的百分比透传给前端，避免长时间无反馈
			s.app.Event.Emit("whisper:progress", whisperProgress{Progress: 0, Status: "downloading"})
			downloadCB := func(pct int) {
				s.app.Event.Emit("whisper:progress", whisperProgress{Progress: pct, Status: "downloading"})
			}
			if err := s.runYtDlp(15*time.Minute, downloadCB, args...); err != nil {
				return nil, err
			}

			if rawPath = downloadedAudio(dir); rawPath == "" {
				return nil, fmt.Errorf("下载音频失败")
			}
		}

		// 下载到的多为 webm/opus，内置 whisper 只带 miniaudio，解码不了这类封装
		// 转码阶段很快（几秒），不单独发进度，统一标为准备转录
		s.app.Event.Emit("whisper:progress", whisperProgress{Progress: 0, Status: "transcribing"})
		if err := s.transcodeToWav(rawPath, wavPath); err != nil {
			return nil, err
		}
	}

	cues, err := s.transcribePreparedAudioFile(wavPath, eventKey)
	if err != nil {
		return nil, err
	}
	// 转录成功后删掉体积更大的原始音轨，保留 WAV 供「重新转录」复用
	removeDownloadedAudio(dir)
	return cues, nil
}

// transcodeToWav 把下载到的音轨转成 whisper 需要的 16kHz 单声道 PCM。
// 先写 .part 再改名，避免中断留下非空但不完整的 WAV 被下次当成缓存复用。
func (s *PlatformService) transcodeToWav(input, output string) error {
	ffmpeg := findFFmpeg(s.dataDir, s.app.Logger)
	if ffmpeg == "" {
		return fmt.Errorf("缺少 ffmpeg，无法转码音轨")
	}
	tmpPath := output + ".part"
	defer func() { _ = os.Remove(tmpPath) }()
	if err := os.Remove(output); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("清理旧音轨失败: %w", err)
	}
	cmd := proc.Command(ffmpeg, "-y", "-i", input, "-vn", "-ar", "16000", "-ac", "1", "-sample_fmt", "s16", tmpPath)
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
	if fi, statErr := os.Stat(tmpPath); statErr != nil || fi.Size() == 0 {
		return fmt.Errorf("音轨转码失败: 输出文件为空")
	}
	if err := os.Rename(tmpPath, output); err != nil {
		return fmt.Errorf("保存音轨转码结果失败: %w", err)
	}
	return nil
}

func (s *PlatformService) transcribeAudioFile(path, eventKey string) ([]SubtitleCue, error) {
	items, err := s.whisper.TranscribeWithKey(path, eventKey)
	return subtitleCuesFromItems(items, err)
}

// transcribePreparedAudioFile 转录已转好的 16kHz WAV，跳过 Whisper 内部的再次解码。
func (s *PlatformService) transcribePreparedAudioFile(wavPath, eventKey string) ([]SubtitleCue, error) {
	items, err := s.whisper.TranscribePreparedWav(wavPath, eventKey)
	return subtitleCuesFromItems(items, err)
}

func subtitleCuesFromItems(items []SubtitleItem, err error) ([]SubtitleCue, error) {
	if err != nil {
		return nil, err
	}
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
