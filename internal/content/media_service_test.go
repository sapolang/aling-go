package content

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

func newTestMediaService(t *testing.T) (*MediaService, string) {
	t.Helper()
	dir := t.TempDir()
	return &MediaService{dataDir: dir, thumbSem: make(chan struct{}, 2)}, dir
}

func writeMediaFile(t *testing.T, dir, name string, size int) (string, []byte) {
	t.Helper()
	path := filepath.Join(dir, name)
	content := make([]byte, size)
	for i := range content {
		content[i] = byte('a' + i%26)
	}
	if err := os.WriteFile(path, content, 0644); err != nil {
		t.Fatalf("写入测试文件失败: %v", err)
	}
	return path, content
}

func registerLibraryFiles(t *testing.T, dataDir string, paths ...string) {
	t.Helper()
	files := make([]LibraryFile, 0, len(paths))
	for _, p := range paths {
		files = append(files, LibraryFile{Path: p, Name: filepath.Base(p)})
	}
	data, err := json.Marshal(LibraryData{Files: files})
	if err != nil {
		t.Fatalf("编码媒体库失败: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, "library.json"), data, 0644); err != nil {
		t.Fatalf("写入媒体库失败: %v", err)
	}
}

func serveMedia(t *testing.T, svc *MediaService, filePath, rangeHeader string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/media/"+url.PathEscape(filePath), nil)
	if rangeHeader != "" {
		req.Header.Set("Range", rangeHeader)
	}
	rec := httptest.NewRecorder()
	svc.handleMediaStream(rec, req)
	return rec
}

func TestHandleMediaStreamRange(t *testing.T) {
	svc, dataDir := newTestMediaService(t)
	file, content := writeMediaFile(t, t.TempDir(), "lesson.mp4", 1000)
	registerLibraryFiles(t, dataDir, file)

	tests := []struct {
		name        string
		rangeHeader string
		wantStatus  int
		wantStart   int
		wantEnd     int
	}{
		{name: "无 Range 返回完整文件", wantStatus: http.StatusOK, wantStart: 0, wantEnd: 999},
		{name: "bytes=0-", rangeHeader: "bytes=0-", wantStatus: http.StatusPartialContent, wantStart: 0, wantEnd: 999},
		{name: "bytes=100-", rangeHeader: "bytes=100-", wantStatus: http.StatusPartialContent, wantStart: 100, wantEnd: 999},
		{name: "bytes=0-99", rangeHeader: "bytes=0-99", wantStatus: http.StatusPartialContent, wantStart: 0, wantEnd: 99},
		{name: "bytes=-500", rangeHeader: "bytes=-500", wantStatus: http.StatusPartialContent, wantStart: 500, wantEnd: 999},
		{name: "越界 Range", rangeHeader: "bytes=5000-", wantStatus: http.StatusRequestedRangeNotSatisfiable},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := serveMedia(t, svc, file, tt.rangeHeader)
			if rec.Code != tt.wantStatus {
				t.Fatalf("状态码 = %d, 期望 %d", rec.Code, tt.wantStatus)
			}
			if tt.wantStatus == http.StatusRequestedRangeNotSatisfiable {
				if got := rec.Header().Get("Content-Range"); got != "bytes */1000" {
					t.Fatalf("Content-Range = %q, 期望 %q", got, "bytes */1000")
				}
				return
			}
			wantBody := content[tt.wantStart : tt.wantEnd+1]
			if !bytes.Equal(rec.Body.Bytes(), wantBody) {
				t.Fatalf("响应体长度 = %d, 期望 %d", rec.Body.Len(), len(wantBody))
			}
			if got := rec.Header().Get("Content-Length"); got != strconv.Itoa(len(wantBody)) {
				t.Fatalf("Content-Length = %q, 期望 %d", got, len(wantBody))
			}
			if tt.wantStatus == http.StatusPartialContent {
				wantRange := fmt.Sprintf("bytes %d-%d/1000", tt.wantStart, tt.wantEnd)
				if got := rec.Header().Get("Content-Range"); got != wantRange {
					t.Fatalf("Content-Range = %q, 期望 %q", got, wantRange)
				}
			}
			if got := rec.Header().Get("Last-Modified"); got == "" {
				t.Fatal("缺少 Last-Modified 响应头")
			}
		})
	}
}

// 前端把绝对路径整体编码进路径段，确认经过 ServeMux 后仍能正确解析。
func TestMediaMuxServesEncodedAbsolutePath(t *testing.T) {
	svc, dataDir := newTestMediaService(t)
	file, content := writeMediaFile(t, t.TempDir(), "lesson 1.mp4", 32)
	registerLibraryFiles(t, dataDir, file)

	req := httptest.NewRequest(http.MethodGet, "/media/"+url.PathEscape(file), nil)
	rec := httptest.NewRecorder()
	svc.mediaMux().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("状态码 = %d, 期望 %d", rec.Code, http.StatusOK)
	}
	if !bytes.Equal(rec.Body.Bytes(), content) {
		t.Fatalf("响应体长度 = %d, 期望 %d", rec.Body.Len(), len(content))
	}
}

func TestHandleThumbPathAllowlist(t *testing.T) {
	svc, dataDir := newTestMediaService(t)
	libraryVideo, _ := writeMediaFile(t, t.TempDir(), "lesson.mp4", 16)
	libraryAudio, _ := writeMediaFile(t, t.TempDir(), "lesson.mp3", 16)
	registerLibraryFiles(t, dataDir, libraryVideo, libraryAudio)
	outsideVideo, _ := writeMediaFile(t, dataDir, "secret.mp4", 16)

	tests := []struct {
		name     string
		path     string
		wantCode int
	}{
		{name: "未登记的绝对路径", path: outsideVideo, wantCode: http.StatusForbidden},
		{name: "带 .. 的路径", path: dataDir + "/../secret.mp4", wantCode: http.StatusForbidden},
		{name: "相对路径", path: "lesson.mp4", wantCode: http.StatusForbidden},
		{name: "非视频文件", path: libraryAudio, wantCode: http.StatusForbidden},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/thumb?path="+url.QueryEscape(tt.path), nil)
			rec := httptest.NewRecorder()
			svc.handleThumb(rec, req)
			if rec.Code != tt.wantCode {
				t.Fatalf("状态码 = %d, 期望 %d", rec.Code, tt.wantCode)
			}
		})
	}
}

func TestHandleMediaStreamPathAllowlist(t *testing.T) {
	svc, dataDir := newTestMediaService(t)
	transcoded := filepath.Join(dataDir, "transcoded")
	if err := os.MkdirAll(transcoded, 0755); err != nil {
		t.Fatalf("创建转码目录失败: %v", err)
	}

	libraryFile, _ := writeMediaFile(t, t.TempDir(), "lesson.mp4", 16)
	registerLibraryFiles(t, dataDir, libraryFile)
	transcodedFile, _ := writeMediaFile(t, transcoded, "cache.mp4", 16)
	// dataDir 根目录不在放行范围内
	outsideFile, _ := writeMediaFile(t, dataDir, "secret.mp4", 16)

	escapeLink := filepath.Join(transcoded, "escape.mp4")
	if err := os.Symlink(outsideFile, escapeLink); err != nil {
		t.Fatalf("创建符号链接失败: %v", err)
	}

	tests := []struct {
		name     string
		path     string
		wantCode int
	}{
		{name: "媒体库文件", path: libraryFile, wantCode: http.StatusOK},
		{name: "转码缓存文件", path: transcodedFile, wantCode: http.StatusOK},
		{name: "未登记的绝对路径", path: outsideFile, wantCode: http.StatusForbidden},
		{name: "带 .. 的路径", path: transcoded + "/../secret.mp4", wantCode: http.StatusForbidden},
		{name: "系统文件", path: "/etc/passwd", wantCode: http.StatusForbidden},
		{name: "相对路径", path: "etc/passwd", wantCode: http.StatusForbidden},
		{name: "指向范围外的符号链接", path: escapeLink, wantCode: http.StatusForbidden},
		{name: "目录", path: transcoded, wantCode: http.StatusNotFound},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := serveMedia(t, svc, tt.path, "")
			if rec.Code != tt.wantCode {
				t.Fatalf("状态码 = %d, 期望 %d", rec.Code, tt.wantCode)
			}
		})
	}
}
