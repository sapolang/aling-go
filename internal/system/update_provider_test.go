package system

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/wailsapp/wails/v3/pkg/updater"
)

const testAssetSize = 300 * 1024

func testPayload() []byte {
	b := make([]byte, testAssetSize)
	for i := range b {
		b[i] = byte(i % 251)
	}
	return b
}

func testRelease(url string, size int64) *updater.Release {
	return &updater.Release{
		Version:  "0.2.0",
		Artifact: updater.Artifact{Filename: "aling-go-test.zip", Size: size},
		Metadata: map[string]any{"github.asset.url": url},
	}
}

type stubProvider struct {
	name  string
	check func(updater.CheckRequest) (*updater.Release, error)
}

func (s *stubProvider) Name() string { return s.name }
func (s *stubProvider) Check(_ context.Context, req updater.CheckRequest) (*updater.Release, error) {
	return s.check(req)
}
func (s *stubProvider) Download(context.Context, *updater.Release, io.Writer, func(int64, int64)) error {
	return errors.New("stub Download must not be called")
}

type errorWriter struct {
	err error
}

func (w errorWriter) Write([]byte) (int, error) { return 0, w.err }

func TestResilientProviderDelegatesCheck(t *testing.T) {
	want := testRelease("https://example.invalid/a.zip", 1)
	base := &stubProvider{name: "github", check: func(updater.CheckRequest) (*updater.Release, error) {
		return want, nil
	}}
	p := newResilientProvider(base, newUpdateHTTPClient(time.Second))
	if p.Name() != "github" {
		t.Fatalf("Name() = %q, want github", p.Name())
	}
	got, err := p.Check(context.Background(), updater.CheckRequest{})
	if err != nil || got != want {
		t.Fatalf("Check() = %v, %v; want %v, nil", got, err, want)
	}
}

func TestResilientProviderDownloadSurvivesStall(t *testing.T) {
	payload := testPayload()
	stall := len(payload) / 10
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
		w.Header().Set("ETag", `"v1"`)
		_, _ = w.Write(payload[:stall])
		w.(http.Flusher).Flush()
		time.Sleep(300 * time.Millisecond)
		_, _ = w.Write(payload[stall:])
	}))
	defer srv.Close()

	var buf bytes.Buffer
	p := newResilientProvider(&stubProvider{name: "github"}, newUpdateHTTPClient(time.Second))
	var maxWritten int64
	err := p.Download(context.Background(), testRelease(srv.URL, int64(len(payload))), &buf, func(w, _ int64) {
		maxWritten = w
	})
	if err != nil {
		t.Fatalf("Download() error = %v", err)
	}
	if !bytes.Equal(buf.Bytes(), payload) {
		t.Fatal("downloaded bytes differ from payload")
	}
	if maxWritten != int64(len(payload)) {
		t.Fatalf("max progress = %d, want %d", maxWritten, len(payload))
	}
}

func TestResilientProviderResumesAfterDisconnect(t *testing.T) {
	payload := testPayload()
	var requests int32
	var mu sync.Mutex
	var ranges []string
	var ifRanges []string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		i := atomic.AddInt32(&requests, 1)
		mu.Lock()
		ranges = append(ranges, r.Header.Get("Range"))
		ifRanges = append(ifRanges, r.Header.Get("If-Range"))
		mu.Unlock()

		start := 0
		if rh := r.Header.Get("Range"); rh != "" {
			if _, err := fmt.Sscanf(rh, "bytes=%d-", &start); err != nil {
				panic(http.ErrAbortHandler)
			}
			w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, len(payload)-1, len(payload)))
			w.Header().Set("Content-Length", strconv.Itoa(len(payload)-start))
			w.WriteHeader(http.StatusPartialContent)
		} else {
			w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
			w.Header().Set("ETag", `"v1"`)
		}

		limit := len(payload)
		switch i {
		case 1:
			limit = len(payload) * 3 / 10
		case 2:
			limit = len(payload) * 7 / 10
		}
		_, _ = w.Write(payload[start:limit])
		w.(http.Flusher).Flush()
		if limit < len(payload) {
			time.Sleep(100 * time.Millisecond)
			panic(http.ErrAbortHandler)
		}
	}))
	defer srv.Close()

	var buf bytes.Buffer
	p := newResilientProvider(&stubProvider{name: "github"}, newUpdateHTTPClient(time.Second))
	p.retryBaseDelay = time.Millisecond
	err := p.Download(context.Background(), testRelease(srv.URL, int64(len(payload))), &buf, func(int64, int64) {})
	if err != nil {
		t.Fatalf("Download() error = %v", err)
	}
	if got := atomic.LoadInt32(&requests); got != 3 {
		t.Fatalf("requests = %d, want 3", got)
	}
	mu.Lock()
	defer mu.Unlock()
	if ranges[1] != fmt.Sprintf("bytes=%d-", len(payload)*3/10) {
		t.Fatalf("second Range = %q", ranges[1])
	}
	if ranges[2] != fmt.Sprintf("bytes=%d-", len(payload)*7/10) {
		t.Fatalf("third Range = %q", ranges[2])
	}
	if ifRanges[1] != `"v1"` || ifRanges[2] != `"v1"` {
		t.Fatalf("If-Range = %q, %q; want %q", ifRanges[1], ifRanges[2], `"v1"`)
	}
	if !bytes.Equal(buf.Bytes(), payload) {
		t.Fatal("resumed bytes differ from payload")
	}
}

func TestResilientProviderRejectsIgnoredRange(t *testing.T) {
	payload := testPayload()
	var requests int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		i := atomic.AddInt32(&requests, 1)
		w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
		if i == 1 {
			_, _ = w.Write(payload[:len(payload)/2])
			w.(http.Flusher).Flush()
			time.Sleep(100 * time.Millisecond)
			panic(http.ErrAbortHandler)
		}
		// Ignore Range: always return the full body with 200.
		_, _ = w.Write(payload)
	}))
	defer srv.Close()

	var buf bytes.Buffer
	p := newResilientProvider(&stubProvider{name: "github"}, newUpdateHTTPClient(time.Second))
	p.maxAttempts = 2
	p.retryBaseDelay = time.Millisecond
	err := p.Download(context.Background(), testRelease(srv.URL, int64(len(payload))), &buf, func(int64, int64) {})
	if err == nil {
		t.Fatal("expected error when server ignores Range")
	}
	if !strings.Contains(err.Error(), "Range") {
		t.Fatalf("error = %v, want it to mention Range", err)
	}
	if buf.Len() != len(payload)/2 {
		t.Fatalf("buffer grew to %d bytes, want %d (no duplicate data)", buf.Len(), len(payload)/2)
	}
}

func TestResilientProviderRejectsWrongContentRange(t *testing.T) {
	payload := testPayload()
	var requests int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		i := atomic.AddInt32(&requests, 1)
		if i == 1 {
			w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
			_, _ = w.Write(payload[:len(payload)/2])
			w.(http.Flusher).Flush()
			time.Sleep(100 * time.Millisecond)
			panic(http.ErrAbortHandler)
		}
		// Always claim the range starts at 0, not at the requested offset.
		w.Header().Set("Content-Range", fmt.Sprintf("bytes 0-%d/%d", len(payload)-1, len(payload)))
		w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write(payload)
	}))
	defer srv.Close()

	var buf bytes.Buffer
	p := newResilientProvider(&stubProvider{name: "github"}, newUpdateHTTPClient(time.Second))
	p.maxAttempts = 2
	p.retryBaseDelay = time.Millisecond
	err := p.Download(context.Background(), testRelease(srv.URL, int64(len(payload))), &buf, func(int64, int64) {})
	if err == nil || !strings.Contains(err.Error(), "Content-Range starts at") {
		t.Fatalf("error = %v, want Content-Range offset error", err)
	}
	if buf.Len() != len(payload)/2 {
		t.Fatalf("buffer grew to %d bytes, want %d (no misaligned data)", buf.Len(), len(payload)/2)
	}
}

func TestResilientProviderIdleTimeout(t *testing.T) {
	payload := testPayload()
	stall := len(payload) / 10
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
		_, _ = w.Write(payload[:stall])
		w.(http.Flusher).Flush()
		select {
		case <-time.After(500 * time.Millisecond):
		case <-r.Context().Done():
		}
		_, _ = w.Write(payload[stall:])
	}))
	defer srv.Close()

	var buf bytes.Buffer
	p := newResilientProvider(&stubProvider{name: "github"}, newUpdateHTTPClient(100*time.Millisecond))
	p.maxAttempts = 1
	start := time.Now()
	err := p.Download(context.Background(), testRelease(srv.URL, int64(len(payload))), &buf, func(int64, int64) {})
	if err == nil {
		t.Fatal("expected idle timeout error")
	}
	if elapsed := time.Since(start); elapsed > 5*time.Second {
		t.Fatalf("idle timeout took %v, want ~100ms", elapsed)
	}
}

func TestResilientProviderCanceledContext(t *testing.T) {
	payload := testPayload()
	stall := len(payload) / 10
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
		_, _ = w.Write(payload[:stall])
		w.(http.Flusher).Flush()
		select {
		case <-time.After(2 * time.Second):
		case <-r.Context().Done():
		}
	}))
	defer srv.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		time.Sleep(100 * time.Millisecond)
		cancel()
	}()

	var buf bytes.Buffer
	p := newResilientProvider(&stubProvider{name: "github"}, newUpdateHTTPClient(5*time.Second))
	p.maxAttempts = 1
	start := time.Now()
	err := p.Download(ctx, testRelease(srv.URL, int64(len(payload))), &buf, func(int64, int64) {})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("error = %v, want context.Canceled", err)
	}
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Fatalf("canceled download took %v, want < 2s", elapsed)
	}
}

func TestResilientProviderDoesNotRetryWriteError(t *testing.T) {
	payload := testPayload()
	var requests int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&requests, 1)
		w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
		_, _ = w.Write(payload)
	}))
	defer srv.Close()

	diskErr := errors.New("disk full")
	p := newResilientProvider(&stubProvider{name: "github"}, newUpdateHTTPClient(time.Second))
	p.retryBaseDelay = time.Millisecond
	err := p.Download(context.Background(), testRelease(srv.URL, int64(len(payload))), errorWriter{err: diskErr}, func(int64, int64) {})
	if !errors.Is(err, diskErr) {
		t.Fatalf("error = %v, want %v", err, diskErr)
	}
	if got := atomic.LoadInt32(&requests); got != 1 {
		t.Fatalf("requests = %d, want 1 (write errors are not retried)", got)
	}
}

func TestResilientProviderMissingAssetURL(t *testing.T) {
	p := newResilientProvider(&stubProvider{name: "github"}, newUpdateHTTPClient(time.Second))
	err := p.Download(context.Background(), &updater.Release{}, &bytes.Buffer{}, func(int64, int64) {})
	if err == nil || !strings.Contains(err.Error(), "asset URL") {
		t.Fatalf("error = %v, want missing asset URL", err)
	}
}

func TestContentRangeStart(t *testing.T) {
	tests := []struct {
		header string
		start  int64
		ok     bool
	}{
		{"bytes 100-999/15579884", 100, true},
		{"bytes 0-0/1", 0, true},
		{"", 0, false},
		{"bytes */100", 0, false},
	}
	for _, tc := range tests {
		start, ok := contentRangeStart(tc.header)
		if ok != tc.ok || start != tc.start {
			t.Errorf("contentRangeStart(%q) = %d, %v; want %d, %v", tc.header, start, ok, tc.start, tc.ok)
		}
	}
}
