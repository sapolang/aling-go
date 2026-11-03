package main

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
		s.mediaListener.Close()
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
	go http.Serve(listener, mux)
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
		http.Error(w, "forbidden", 403)
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
		f.Seek(start, 0)
		io.CopyN(w, f, end-start+1)
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
	io.Copy(w, f)
}

// --- Thumbnail ---

func (s *MediaService) GetVideoThumbnail(filePath string) string {
	cacheDir := filepath.Join(s.dataDir, "aling", "thumbnails")
	os.MkdirAll(cacheDir, 0755)
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
	cmd.Run()

	data, err := os.ReadFile(thumbPath)
	if err != nil {
		return ""
	}
	return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(data)
}

const waveformSampleCount = 1000

func (s *MediaService) GetWaveformData(filePath string) []float64 {
	cacheDir := filepath.Join(s.dataDir, "aling", "waveforms")
	os.MkdirAll(cacheDir, 0755)
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

	cmd := exec.Command(ffmpeg,
		"-i", filePath,
		"-ac", "1",
		"-f", "f32le",
		"-ar", "8000",
		"pipe:1",
	)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		s.app.Logger.Debug("GetWaveformData stdout pipe error", "error", err)
		return nil
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		s.app.Logger.Debug("GetWaveformData stderr pipe error", "error", err)
		return nil
	}

	if err := cmd.Start(); err != nil {
		s.app.Logger.Debug("GetWaveformData start error", "error", err)
		return nil
	}

	go io.Copy(io.Discard, stderr)

	rawBytes, err := io.ReadAll(stdout)
	if err != nil {
		s.app.Logger.Debug("GetWaveformData read error", "error", err)
		return nil
	}

	cmd.Wait()

	if len(rawBytes) == 0 {
		return nil
	}

	sampleCount := len(rawBytes) / 4
	if sampleCount == 0 {
		return nil
	}

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
			bits := binary.LittleEndian.Uint32(rawBytes[j*4 : (j+1)*4])
			val := math.Abs(float64(math.Float32frombits(bits)))
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
		os.WriteFile(cachePath, jsonBytes, 0644)
	}

	return result
}
