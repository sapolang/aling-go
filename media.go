package main

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
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

func (a *App) startMediaServer() {
	mux := http.NewServeMux()
	mux.HandleFunc("/media/", a.handleMediaStream)

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		println("Media server failed:", err.Error())
		return
	}
	a.mediaPort = listener.Addr().(*net.TCPAddr).Port
	go http.Serve(listener, mux)
}

func (a *App) handleMediaStream(w http.ResponseWriter, r *http.Request) {
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
