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
	"strconv"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
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
