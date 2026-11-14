package system

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/wailsapp/wails/v3/pkg/updater"
)

const (
	defaultUpdateMaxAttempts = 4
	defaultUpdateRetryDelay  = time.Second
)

// resilientProvider wraps the GitHub provider's Check and replaces its
// Download with a resumable loop. Wails' built-in download has no retry and
// runs under a 30s total client timeout, so a slow or flaky link aborts the
// transfer mid-stream.
type resilientProvider struct {
	base           updater.Provider
	client         *http.Client
	maxAttempts    int
	retryBaseDelay time.Duration
}

func newResilientProvider(base updater.Provider, client *http.Client) *resilientProvider {
	return &resilientProvider{
		base:           base,
		client:         client,
		maxAttempts:    defaultUpdateMaxAttempts,
		retryBaseDelay: defaultUpdateRetryDelay,
	}
}

func (p *resilientProvider) Name() string { return p.base.Name() }

func (p *resilientProvider) Check(ctx context.Context, req updater.CheckRequest) (*updater.Release, error) {
	return p.base.Check(ctx, req)
}

// Download streams the release asset to dst. If the connection fails, it
// resumes from the last written byte using an HTTP Range request and
// If-Range, so the updater's streaming hash stays valid. A server that ignores
// Range is treated as an error rather than appending duplicate bytes.
func (p *resilientProvider) Download(ctx context.Context, rel *updater.Release, dst io.Writer, onProgress func(written, total int64)) error {
	urlStr, ok := assetURL(rel)
	if !ok {
		return errors.New("github: release metadata missing asset URL")
	}

	total := rel.Artifact.Size
	var written int64
	var etag string

	attempts := p.maxAttempts
	if attempts < 1 {
		attempts = 1
	}

	for attempt := 0; attempt < attempts; attempt++ {
		resp, err := p.request(ctx, urlStr, written, etag)
		if err != nil {
			if ctxErr := ctx.Err(); ctxErr != nil {
				return ctxErr
			}
			if attempt+1 >= attempts {
				return fmt.Errorf("github: download: %w", err)
			}
			if werr := sleepWithContext(ctx, nextUpdateRetryDelay(p.retryBaseDelay, attempt)); werr != nil {
				return werr
			}
			continue
		}

		if attempt == 0 && resp.StatusCode == http.StatusOK {
			etag = resp.Header.Get("ETag")
		}

		if statusErr := checkDownloadStatus(resp, written); statusErr != nil {
			retryable := isRetryableStatus(resp.StatusCode)
			_ = resp.Body.Close()
			if retryable && attempt+1 < attempts {
				if werr := sleepWithContext(ctx, nextUpdateRetryDelay(p.retryBaseDelay, attempt)); werr != nil {
					return werr
				}
				continue
			}
			return statusErr
		}

		if total == 0 {
			total = responseTotal(resp, written)
		}

		var writeErr, readErr error
		written, writeErr, readErr = streamDownload(resp.Body, dst, written, total, onProgress)
		_ = resp.Body.Close()

		if writeErr != nil {
			return writeErr
		}
		if readErr == nil {
			if total > 0 && written != total {
				readErr = io.ErrUnexpectedEOF
			} else {
				return nil
			}
		}
		if ctxErr := ctx.Err(); ctxErr != nil {
			return ctxErr
		}
		if attempt+1 >= attempts {
			return fmt.Errorf("github: download: %w", readErr)
		}
		if werr := sleepWithContext(ctx, nextUpdateRetryDelay(p.retryBaseDelay, attempt)); werr != nil {
			return werr
		}
	}

	return errors.New("github: download: retries exhausted")
}

func assetURL(rel *updater.Release) (string, bool) {
	if rel == nil || rel.Metadata == nil {
		return "", false
	}
	urlStr, ok := rel.Metadata["github.asset.url"].(string)
	if !ok || urlStr == "" {
		return "", false
	}
	return urlStr, true
}

func (p *resilientProvider) request(ctx context.Context, urlStr string, offset int64, etag string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, urlStr, nil)
	if err != nil {
		return nil, err
	}
	// The public repository needs no Authorization header; keeping it out also
	// means the cross-host redirect to release-assets.githubusercontent.com
	// cannot leak one.
	req.Header.Set("Accept", "application/octet-stream")
	if offset > 0 {
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-", offset))
		if etag != "" {
			req.Header.Set("If-Range", etag)
		}
	}
	return p.client.Do(req)
}

func checkDownloadStatus(resp *http.Response, written int64) error {
	switch {
	case written == 0 && resp.StatusCode == http.StatusOK:
		return nil
	case written > 0 && resp.StatusCode == http.StatusPartialContent:
		start, ok := contentRangeStart(resp.Header.Get("Content-Range"))
		if !ok {
			return fmt.Errorf("github: download: malformed Content-Range %q", resp.Header.Get("Content-Range"))
		}
		if start != written {
			return fmt.Errorf("github: download: Content-Range starts at %d, want %d", start, written)
		}
		return nil
	case written > 0 && resp.StatusCode == http.StatusOK:
		return fmt.Errorf("github: download: server ignored Range request at offset %d; cannot resume", written)
	case resp.StatusCode >= 200 && resp.StatusCode < 300:
		return nil
	default:
		return fmt.Errorf("github: download: HTTP %d", resp.StatusCode)
	}
}

func isRetryableStatus(code int) bool {
	switch code {
	case http.StatusRequestTimeout, http.StatusTooManyRequests,
		http.StatusInternalServerError, http.StatusBadGateway,
		http.StatusServiceUnavailable, http.StatusGatewayTimeout:
		return true
	default:
		return false
	}
}

func responseTotal(resp *http.Response, written int64) int64 {
	if resp.StatusCode == http.StatusPartialContent {
		if _, total, ok := contentRange(resp.Header.Get("Content-Range")); ok && total > 0 {
			return total
		}
		return 0
	}
	if resp.ContentLength > 0 {
		return written + resp.ContentLength
	}
	return 0
}

// streamDownload copies body to dst, reporting progress. It separates write
// errors (not retryable) from read errors (retryable).
func streamDownload(body io.Reader, dst io.Writer, written, total int64, onProgress func(int64, int64)) (int64, error, error) {
	buf := make([]byte, 64*1024)
	for {
		n, readErr := body.Read(buf)
		if n > 0 {
			writtenNow, writeErr := dst.Write(buf[:n])
			written += int64(writtenNow)
			if onProgress != nil {
				onProgress(written, total)
			}
			if writeErr != nil {
				return written, writeErr, nil
			}
			if writtenNow != n {
				return written, io.ErrShortWrite, nil
			}
		}
		if readErr == io.EOF {
			return written, nil, nil
		}
		if readErr != nil {
			return written, nil, readErr
		}
	}
}

func contentRangeStart(header string) (int64, bool) {
	start, _, ok := contentRange(header)
	return start, ok
}

func contentRange(header string) (start, total int64, ok bool) {
	var end int64
	if _, err := fmt.Sscanf(header, "bytes %d-%d/%d", &start, &end, &total); err != nil {
		return 0, 0, false
	}
	if total <= 0 || end < start {
		return 0, 0, false
	}
	return start, total, true
}

func nextUpdateRetryDelay(base time.Duration, attempt int) time.Duration {
	if base <= 0 {
		return 0
	}
	return base << attempt
}

func sleepWithContext(ctx context.Context, d time.Duration) error {
	if d <= 0 {
		return ctx.Err()
	}
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
