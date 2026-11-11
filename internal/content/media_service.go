package content

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"

	"aling-go/internal/core"
)

var mimeTypes = map[string]string{
	".mp4":  "video/mp4",
	".mp3":  "audio/mpeg",
	".wav":  "audio/wav",
	".m4a":  "audio/mp4",
	".m4v":  "video/mp4",
	".mkv":  "video/x-matroska",
	".mov":  "video/quicktime",
	".webm": "video/webm",
	".flac": "audio/flac",
	".ogg":  "audio/ogg",
	".aac":  "audio/aac",
}

type MediaService struct {
	app           *application.App
	dataDir       string
	mediaPort     int
	mediaListener net.Listener
	// B站取流与在线播客依赖订阅 Cookie 和带代理配置的 HTTP 客户端，由 bootstrap 注入
	biliCookieFn   func() string
	remoteClientFn func() *http.Client
}

func NewMediaService(app *application.App, dataDir string) *MediaService {
	return &MediaService{app: app, dataDir: dataDir}
}

func (s *MediaService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	s.startMediaServer()
	return nil
}

func (s *MediaService) ServiceShutdown() error {
	if s.mediaListener != nil {
		_ = s.mediaListener.Close()
	}
	return nil
}

// --- Media streaming ---

func (s *MediaService) startMediaServer() {
	mux := http.NewServeMux()
	mux.HandleFunc("/media/", s.handleMediaStream)
	mux.HandleFunc("/podcast-stream", s.handlePodcastStream)
	mux.HandleFunc("/yt-embed", s.handleYTEmbed)
	mux.HandleFunc("/bili-stream", s.handleBiliStream)

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		s.app.Logger.Error("Media server failed", "error", err)
		return
	}
	s.mediaListener = listener
	s.mediaPort = listener.Addr().(*net.TCPAddr).Port
	go func() { _ = http.Serve(listener, mux) }()
}

func (s *MediaService) GetMediaPort() int {
	return s.mediaPort
}

func (s *MediaService) handleMediaStream(w http.ResponseWriter, r *http.Request) {
	rawPath := strings.TrimPrefix(r.URL.Path, "/media/")
	filePath, err := url.QueryUnescape(rawPath)
	if err != nil {
		http.Error(w, "invalid path", 400)
		return
	}

	if strings.Contains(filePath, "..") || !filepath.IsAbs(filePath) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	stat, err := os.Stat(filePath)
	if err != nil {
		http.Error(w, "file not found", 404)
		return
	}

	ext := strings.ToLower(filepath.Ext(filePath))
	mime := mimeTypes[ext]
	if mime == "" {
		mime = "application/octet-stream"
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Accept-Ranges", "bytes")

	fileSize := stat.Size()

	if rangeHeader := r.Header.Get("Range"); rangeHeader != "" {
		var start, end int64 = 0, fileSize - 1
		if _, err := fmt.Sscanf(rangeHeader, "bytes=%d-%d", &start, &end); err == nil {
			if end == 0 || end >= fileSize {
				end = fileSize - 1
			}
		} else {
			if strings.HasPrefix(rangeHeader, "bytes=") {
				parts := strings.SplitN(rangeHeader[6:], "-", 2)
				if len(parts) == 2 && parts[0] == "" {
					suffix, _ := strconv.ParseInt(parts[1], 10, 64)
					if suffix > 0 && suffix <= fileSize {
						start = fileSize - suffix
					}
				}
			}
		}
		if start < 0 {
			start = 0
		}
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, fileSize))
		w.Header().Set("Content-Length", strconv.FormatInt(end-start+1, 10))
		w.WriteHeader(206)

		f, err := os.Open(filePath)
		if err != nil {
			http.Error(w, "file not found", 404)
			return
		}
		defer f.Close()
		_, _ = f.Seek(start, 0)
		_, _ = io.CopyN(w, f, end-start+1)
		return
	}

	w.Header().Set("Content-Length", strconv.FormatInt(fileSize, 10))
	w.WriteHeader(200)
	f, err := os.Open(filePath)
	if err != nil {
		http.Error(w, "file not found", 404)
		return
	}
	defer f.Close()
	_, _ = io.Copy(w, f)
}

// handlePodcastStream 代理已订阅节目的在线音频，避免 HTTP 混合内容并复用订阅代理设置。
// 只接受数据库中的节目 ID，不代理前端提供的任意 URL；仅转发播放请求，不落盘。
func (s *MediaService) handlePodcastStream(w http.ResponseWriter, r *http.Request) {
	if s.remoteClientFn == nil {
		http.Error(w, "podcast stream not initialized", http.StatusServiceUnavailable)
		return
	}
	episodeID, err := strconv.ParseInt(r.URL.Query().Get("id"), 10, 64)
	if err != nil || episodeID <= 0 {
		http.Error(w, "invalid episode id", http.StatusBadRequest)
		return
	}
	var raw string
	if err := core.DB.QueryRow(`SELECT audio_url FROM feed_episodes WHERE id = ?`, episodeID).Scan(&raw); err != nil || raw == "" {
		http.Error(w, "episode not found", http.StatusNotFound)
		return
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		http.Error(w, "invalid audio url", http.StatusBadRequest)
		return
	}

	// 流式播放不能使用订阅请求的 60 秒整体超时，连接会随页面关闭而取消。
	baseClient := s.remoteClientFn()
	client := *baseClient
	client.Timeout = 0
	doRequest := func(target string) (*http.Response, error) {
		req, reqErr := http.NewRequestWithContext(r.Context(), http.MethodGet, target, nil)
		if reqErr != nil {
			return nil, reqErr
		}
		if rangeHeader := r.Header.Get("Range"); rangeHeader != "" {
			req.Header.Set("Range", rangeHeader)
		}
		req.Header.Set("User-Agent", "Aling/1.0 (Podcast Player)")
		return client.Do(req)
	}

	resp, err := doRequest(parsed.String())
	// 部分 RSS 仍写 HTTP，代理会返回 502；同地址的 HTTPS 通常可用。
	if parsed.Scheme == "http" && (err != nil || resp.StatusCode == http.StatusBadGateway) {
		if resp != nil {
			_ = resp.Body.Close()
		}
		httpsURL := *parsed
		httpsURL.Scheme = "https"
		resp, err = doRequest(httpsURL.String())
	}
	if err != nil {
		http.Error(w, "upstream request failed", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	for _, header := range []string{"Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "Last-Modified", "ETag"} {
		if value := resp.Header.Get(header); value != "" {
			w.Header().Set(header, value)
		}
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

// --- YouTube 中转页 ---

var ytVideoIDRe = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)

// handleYTEmbed 输出一个 http 源下的中转页再嵌入 YouTube 播放器。
// WKWebView 在 wails:// 页面里加载子 frame 不带 Referer，YouTube 会报错误 153，
// 通过 127.0.0.1 的 http 页面中转后 Referer 正常，同时把播放进度回传给外层页面。
func (s *MediaService) handleYTEmbed(w http.ResponseWriter, r *http.Request) {
	videoID := r.URL.Query().Get("v")
	if !ytVideoIDRe.MatchString(videoID) {
		http.Error(w, "invalid video id", http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	// 页面自身从 URL 读取 videoId，避免把请求参数拼接进 HTML
	_, _ = io.WriteString(w, ytEmbedPage)
}

const ytEmbedPage = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
  #player { width: 100%; height: 100%; }
</style>
</head>
<body>
<div id="player"></div>
<script>
  var player = null;
  var videoId = new URLSearchParams(location.search).get('v') || '';
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) videoId = '';

  function postStatus() {
    if (!player || typeof player.getCurrentTime !== 'function') return;
    parent.postMessage({
      source: 'yt-embed',
      event: 'status',
      currentTime: player.getCurrentTime() || 0,
      duration: player.getDuration() || 0,
      state: player.getPlayerState()
    }, '*');
  }

  var tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(tag);

  function onYouTubeIframeAPIReady() {
    player = new YT.Player('player', {
      videoId: videoId,
      playerVars: {
        rel: 0,
        modestbranding: 1,
        playsinline: 1,
        origin: location.origin
      },
      events: {
        onReady: function () {
          postStatus();
          setInterval(postStatus, 250);
        },
        onStateChange: postStatus
      }
    });
  }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.source !== 'aling' || !player) return;
    if (d.command === 'play') player.playVideo();
    else if (d.command === 'pause') player.pauseVideo();
    postStatus();
  });
</script>
</body>
</html>`

// --- Thumbnail ---

func (s *MediaService) GetVideoThumbnail(filePath string) string {
	cacheDir := filepath.Join(s.dataDir, "aling", "thumbnails")
	_ = os.MkdirAll(cacheDir, 0755)
	cacheKey := md5Hash(filePath)
	thumbPath := filepath.Join(cacheDir, cacheKey+".jpg")

	if data, err := os.ReadFile(thumbPath); err == nil {
		return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(data)
	}

	ffmpeg := findFFmpeg(s.dataDir, s.app.Logger)
	if ffmpeg == "" {
		return ""
	}

	cmd := exec.Command(ffmpeg, "-i", filePath, "-ss", "00:00:05", "-vframes", "1", "-q:v", "2", "-update", "1", thumbPath)
	_ = cmd.Run()

	data, err := os.ReadFile(thumbPath)
	if err != nil {
		return ""
	}
	return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(data)
}

const waveformSampleCount = 1000

func (s *MediaService) GetWaveformData(filePath string) []float64 {
	cacheDir := filepath.Join(s.dataDir, "aling", "waveforms")
	_ = os.MkdirAll(cacheDir, 0755)
	cacheKey := md5Hash(filePath)
	cachePath := filepath.Join(cacheDir, cacheKey+".json")

	if data, err := os.ReadFile(cachePath); err == nil {
		var result []float64
		if json.Unmarshal(data, &result) == nil {
			return result
		}
	}

	ffmpeg := findFFmpeg(s.dataDir, s.app.Logger)
	if ffmpeg == "" {
		s.app.Logger.Debug("GetWaveformData ffmpeg not found")
		return nil
	}

	// 内置精简编译的 ffmpeg 不支持 f32le pipe 输出，改为生成临时 WAV 文件再解析
	tmpFile, err := os.CreateTemp("", "aling-wave-*.wav")
	if err != nil {
		s.app.Logger.Debug("GetWaveformData temp file error", "error", err)
		return nil
	}
	tmpPath := tmpFile.Name()
	_ = tmpFile.Close()
	defer func() { _ = os.Remove(tmpPath) }()

	cmd := exec.Command(ffmpeg,
		"-i", filePath,
		"-ac", "1",
		"-ar", "1000",
		"-f", "wav",
		tmpPath,
	)
	if out, err := cmd.CombinedOutput(); err != nil {
		s.app.Logger.Debug("GetWaveformData ffmpeg error", "error", err, "output", string(out))
		return nil
	}

	samples, err := readWavPCM16(tmpPath)
	if err != nil {
		s.app.Logger.Debug("GetWaveformData wav parse error", "error", err)
		return nil
	}
	if len(samples) == 0 {
		return nil
	}

	sampleCount := len(samples)
	samplesPerSegment := float64(sampleCount) / float64(waveformSampleCount)
	result := make([]float64, waveformSampleCount)

	for i := 0; i < waveformSampleCount; i++ {
		start := int(float64(i) * samplesPerSegment)
		end := int(float64(i+1) * samplesPerSegment)
		if end > sampleCount {
			end = sampleCount
		}
		if start >= end {
			result[i] = 0
			continue
		}
		peak := float64(0)
		for j := start; j < end; j++ {
			val := math.Abs(float64(samples[j]) / 32768.0)
			if val > peak {
				peak = val
			}
		}
		result[i] = peak
	}

	maxVal := float64(0)
	for _, v := range result {
		if v > maxVal {
			maxVal = v
		}
	}
	if maxVal > 0 {
		for i := range result {
			result[i] = result[i] / maxVal
		}
	}

	jsonBytes, err := json.Marshal(result)
	if err == nil {
		_ = os.WriteFile(cachePath, jsonBytes, 0644)
	}

	return result
}

// readWavPCM16 按 WAV chunk 结构读取 PCM16 采样（兼容 fmt/data 之外的其他 chunk）
func readWavPCM16(path string) ([]int16, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer func() { _ = f.Close() }()

	var riff [12]byte
	if _, err := io.ReadFull(f, riff[:]); err != nil {
		return nil, err
	}
	if string(riff[0:4]) != "RIFF" || string(riff[8:12]) != "WAVE" {
		return nil, fmt.Errorf("not a WAVE file")
	}

	var bitsPerSample uint16 = 16
	for {
		var hdr [8]byte
		if _, err := io.ReadFull(f, hdr[:]); err != nil {
			return nil, err
		}
		chunkSize := binary.LittleEndian.Uint32(hdr[4:8])
		switch string(hdr[0:4]) {
		case "fmt ":
			buf := make([]byte, chunkSize)
			if _, err := io.ReadFull(f, buf); err != nil {
				return nil, err
			}
			if len(buf) >= 16 {
				bitsPerSample = binary.LittleEndian.Uint16(buf[14:16])
			}
		case "data":
			if bitsPerSample != 16 {
				return nil, fmt.Errorf("unsupported bits per sample: %d", bitsPerSample)
			}
			raw := make([]byte, chunkSize)
			if _, err := io.ReadFull(f, raw); err != nil {
				return nil, err
			}
			// PCM16 采样即小端序有符号 16 位整数，位模式等价转换
			samples := make([]int16, len(raw)/2)
			for i := range samples {
				samples[i] = int16(binary.LittleEndian.Uint16(raw[i*2 : i*2+2])) //nolint:gosec // G115: 位模式转换，非数值截断
			}
			return samples, nil
		default:
			if _, err := f.Seek(int64(chunkSize), io.SeekCurrent); err != nil {
				return nil, err
			}
		}
		// chunk 按偶数字节对齐
		if chunkSize%2 == 1 {
			if _, err := f.Seek(1, io.SeekCurrent); err != nil {
				return nil, err
			}
		}
	}
}
