# 应用内更新下载韧性修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让应用内更新在慢速或抖动网络下也能下完 15.6 MB 的更新包，并在断线后从已下载位置续传。

**Architecture:** 新增一个下载专用 `http.Client`（无整体超时、60s 空闲超时），再新增一个包装官方 `github.Provider` 的 `resilientProvider`：`Check` 委托，`Download` 用 `Range` + `If-Range` 做最多 4 次续传重试。最后在 `NewUpdateService` 中接线。

**Tech Stack:** Go 1.26.11、Wails v3.1.0 `pkg/updater`、标准库 `net/http` / `net` / `httptest`。

**Spec:** `docs/superpowers/specs/2026-11-14-updater-download-resilience-design.md`

## Global Constraints

- 不新增任何第三方依赖；Wails 保持 v3.1.0。
- 不改前端、Wails 绑定、发布 workflow、`DownloadAndInstall` / `Restart` 流程。
- 默认空闲超时 `60 * time.Second`，重试次数 `4`，退避基数 `1 * time.Second`。
- Go 代码错误信息沿用现有 updater 风格（英文、`github: ...` 前缀）。
- 所有改动必须通过 `gofmt`、`go vet ./...`、`go test ./internal/system/...`。
- 续传时服务端若忽略 `Range`，必须报错，不得向 `dst` 追加重复字节。

## Review Focus

- 服务端对续传请求返回 `200`（忽略 Range）→ 必须报错且目标流字节数不增加。
- 永久停滞的连接 → 必须在约一个空闲超时后返回错误，不能无限挂起。
- `Content-Range` 起点与已写字节数不一致 → 必须报错，避免拼接错位。
- 本地写盘失败 → 必须立即返回，不能当成网络错误重试。
- context 取消（用户退出应用）→ 必须尽快返回 `context.Canceled`，不继续退避。

---

### Task 1: 下载专用 HTTP client（无整体超时 + 空闲超时）

**Files:**
- Create: `internal/system/update_http.go`
- Test: `internal/system/update_http_test.go`

**Interfaces:**
- Consumes: 标准库 `net`、`net/http`、`time`。
- Produces: `func newUpdateHTTPClient(idleTimeout time.Duration) *http.Client`。

- [ ] **Step 1: 写失败测试**

`internal/system/update_http_test.go`：

```go
package system

import (
	"net"
	"testing"
	"time"
)

func TestNewUpdateHTTPClientHasNoOverallTimeout(t *testing.T) {
	client := newUpdateHTTPClient(time.Second)
	if client.Timeout != 0 {
		t.Fatalf("client.Timeout = %v, want 0 (no overall timeout)", client.Timeout)
	}
	if client.Transport == nil {
		t.Fatal("client.Transport is nil")
	}
}

func TestIdleTimeoutConnReadDeadline(t *testing.T) {
	c1, c2 := net.Pipe()
	defer c1.Close()
	defer c2.Close()

	conn := &idleTimeoutConn{Conn: c1, timeout: 100 * time.Millisecond}
	start := time.Now()
	_, err := conn.Read(make([]byte, 1))
	if err == nil {
		t.Fatal("expected read to time out")
	}
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Fatalf("read blocked for %v, want ~100ms", elapsed)
	}
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `go test ./internal/system/ -run 'TestNewUpdateHTTPClient|TestIdleTimeoutConn' -v`
Expected: FAIL，`undefined: newUpdateHTTPClient` / `undefined: idleTimeoutConn`。

- [ ] **Step 3: 实现 `internal/system/update_http.go`**

```go
package system

import (
	"context"
	"net"
	"net/http"
	"time"
)

// newUpdateHTTPClient returns a client tuned for large asset downloads.
// Unlike Wails' default updater client (30s total timeout, which aborts the
// body read mid-stream), it has no overall deadline; idleTimeout is applied
// per read so a truly stalled connection still fails.
func newUpdateHTTPClient(idleTimeout time.Duration) *http.Client {
	dialer := &net.Dialer{Timeout: 15 * time.Second, KeepAlive: 30 * time.Second}

	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
		conn, err := dialer.DialContext(ctx, network, addr)
		if err != nil {
			return nil, err
		}
		return &idleTimeoutConn{Conn: conn, timeout: idleTimeout}, nil
	}
	transport.TLSHandshakeTimeout = 15 * time.Second
	transport.ResponseHeaderTimeout = 30 * time.Second
	transport.IdleConnTimeout = 90 * time.Second
	transport.ExpectContinueTimeout = time.Second

	return &http.Client{Transport: transport}
}

// idleTimeoutConn refreshes the read/write deadline on every operation, which
// turns a fixed total timeout into an inactivity timeout.
type idleTimeoutConn struct {
	net.Conn
	timeout time.Duration
}

func (c *idleTimeoutConn) Read(p []byte) (int, error) {
	if err := c.Conn.SetReadDeadline(time.Now().Add(c.timeout)); err != nil {
		return 0, err
	}
	return c.Conn.Read(p)
}

func (c *idleTimeoutConn) Write(p []byte) (int, error) {
	if err := c.Conn.SetWriteDeadline(time.Now().Add(c.timeout)); err != nil {
		return 0, err
	}
	return c.Conn.Write(p)
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `go test ./internal/system/ -run 'TestNewUpdateHTTPClient|TestIdleTimeoutConn' -v`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add internal/system/update_http.go internal/system/update_http_test.go
git commit -m "fix: 更新下载改用无总超时的空闲超时客户端"
```

---

### Task 2: 可续传的 provider 包装器

**Files:**
- Create: `internal/system/update_provider.go`
- Test: `internal/system/update_provider_test.go`

**Interfaces:**
- Consumes: `updater.Provider`、`updater.Release`、`updater.CheckRequest`、`*http.Client`。
- Produces:
  - `type resilientProvider struct { base updater.Provider; client *http.Client; maxAttempts int; retryBaseDelay time.Duration }`
  - `func newResilientProvider(base updater.Provider, client *http.Client) *resilientProvider`
  - 包装器实现 `updater.Provider`（`Name` / `Check` / `Download`）。

- [ ] **Step 1: 写失败测试**

`internal/system/update_provider_test.go`：

```go
package system

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
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
	return fmt.Errorf("stub Download must not be called")
}
```

> 注意：上面的 `io` 需要补进 import；最终文件以 `gofmt` 结果为准。

```go
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
	var ranges []string
	var ifRanges []string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		i := atomic.AddInt32(&requests, 1)
		ranges = append(ranges, r.Header.Get("Range"))
		ifRanges = append(ifRanges, r.Header.Get("If-Range"))

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
			time.Sleep(20 * time.Millisecond)
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
	if requests != 3 {
		t.Fatalf("requests = %d, want 3", requests)
	}
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
			time.Sleep(20 * time.Millisecond)
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

func TestResilientProviderIdleTimeout(t *testing.T) {
	payload := testPayload()
	stall := len(payload) / 10
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
		_, _ = w.Write(payload[:stall])
		w.(http.Flusher).Flush()
		time.Sleep(500 * time.Millisecond)
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `go test ./internal/system/ -run 'TestResilientProvider|TestContentRangeStart' -v`
Expected: FAIL，`undefined: newResilientProvider` / `undefined: contentRangeStart`。

- [ ] **Step 3: 实现 `internal/system/update_provider.go`**

实现要求（签名与行为固定，循环体按下面要点写）：

```go
const (
	defaultUpdateMaxAttempts = 4
	defaultUpdateRetryDelay  = time.Second
)

type resilientProvider struct {
	base           updater.Provider
	client         *http.Client
	maxAttempts    int
	retryBaseDelay time.Duration
}

func newResilientProvider(base updater.Provider, client *http.Client) *resilientProvider
```

- `Name()` 直接返回 `base.Name()`；`Check(ctx, req)` 直接委托 `base.Check`。
- `Download`：
  1. 从 `rel.Metadata["github.asset.url"]` 取 URL；缺失时报
     `github: release metadata missing asset URL`。
  2. `total := rel.Artifact.Size`；`written` 从 0 开始；`etag` 初值空。
  3. 循环 `attempt := 0, 1, ... < p.maxAttempts`：
     - 构造 GET 请求，`Accept: application/octet-stream`；
       `written > 0` 时加 `Range: bytes=<written>-`，`etag != ""` 时加 `If-Range: <etag>`。
     - 请求失败：`ctx.Err() != nil` 立即返回；否则还有次数就退避重试。
     - 第一次且响应 200 时记录 `etag = resp.Header.Get("ETag")`。
     - 状态校验见下方 `contentRangeStart` 规则；不可重试状态直接返回。
     - 流式写入：`n > 0` 时写 `dst`，`written += n`，调用 `onProgress(written, total)`；
       写失败立即返回（不重试）；`n` 与读到的字节数不一致返回 `io.ErrShortWrite`。
     - 读到 EOF：若 `total > 0 && written != total` 视为 `io.ErrUnexpectedEOF` 并可重试；
       否则返回 nil。
     - 读错误：`ctx.Err() != nil` 立即返回；否则还有次数就退避重试。
  4. 退避：第 `attempt` 次等待 `p.retryBaseDelay << attempt`（1x、2x、4x、8x），
     等待必须响应 `ctx.Done()`。
  5. 重试耗尽时返回 `github: download: <err>`。
- 状态规则：
  - `written == 0 && 200` → 继续。
  - `written > 0 && 206` → `contentRangeStart(resp.Header.Get("Content-Range"))`
    必须成功且等于 `written`，否则返回明确错误。
  - `written > 0 && 200` → 返回包含 `Range` 的错误：
    `github: download: server ignored Range request at offset N; cannot resume`。
  - 408 / 429 / 500 / 502 / 503 / 504 → 可重试；其余非 2xx 直接返回 `github: download: HTTP N`。
- 辅助函数：
  - `func contentRangeStart(header string) (int64, bool)`：解析 `bytes <start>-<end>/<total>`。
  - `func nextUpdateRetryDelay(base time.Duration, attempt int) time.Duration`。
  - `func sleepWithContext(ctx context.Context, d time.Duration) error`。

- [ ] **Step 4: 跑测试确认通过**

Run: `go test ./internal/system/ -run 'TestResilientProvider|TestContentRangeStart' -v`
Expected: PASS（约 1 秒内）。

- [ ] **Step 5: 提交**

```bash
git add internal/system/update_provider.go internal/system/update_provider_test.go
git commit -m "fix: 更新下载支持 Range 断点续传与重试"
```

---

### Task 3: 接入 UpdateService

**Files:**
- Modify: `internal/system/update_service.go:46-71`
- Test: `internal/system/update_service_test.go`（新建）

**Interfaces:**
- Consumes: Task 1 的 `newUpdateHTTPClient`、Task 2 的 `newResilientProvider`。
- Produces: `func newUpdateProvider(client *http.Client) (updater.Provider, error)`。

- [ ] **Step 1: 写失败测试**

`internal/system/update_service_test.go`：

```go
package system

import (
	"testing"
	"time"

	"github.com/wailsapp/wails/v3/pkg/updater"
)

func TestNewUpdateProviderWrapsGitHub(t *testing.T) {
	p, err := newUpdateProvider(newUpdateHTTPClient(time.Second))
	if err != nil {
		t.Fatalf("newUpdateProvider() error = %v", err)
	}
	if p.Name() != "github" {
		t.Fatalf("Name() = %q, want github", p.Name())
	}
	if _, ok := p.(*resilientProvider); !ok {
		t.Fatalf("provider type = %T, want *resilientProvider", p)
	}
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `go test ./internal/system/ -run TestNewUpdateProviderWrapsGitHub -v`
Expected: FAIL，`undefined: newUpdateProvider`。

- [ ] **Step 3: 修改 `internal/system/update_service.go`**

新增常量与辅助函数，并把 `NewUpdateService` 改为使用包装器：

```go
const updateIdleTimeout = 60 * time.Second

func newUpdateProvider(client *http.Client) (updater.Provider, error) {
	base, err := github.New(github.Config{
		Repository:    updateRepo,
		ChecksumAsset: "SHA256SUMS",
		HTTPClient:    client,
	})
	if err != nil {
		return nil, err
	}
	return newResilientProvider(base, client), nil
}
```

`NewUpdateService` 中原来的 `github.New(...)` 替换为：

```go
client := newUpdateHTTPClient(updateIdleTimeout)
provider, err := newUpdateProvider(client)
if err != nil {
	svc.initErr = err
	return svc
}
```

其余 `updater.Config` 保持不变，`Providers` 仍传 `provider`。
补上 `net/http` import。

- [ ] **Step 4: 跑测试确认通过**

Run: `go test ./internal/system/ -run TestNewUpdateProviderWrapsGitHub -v`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add internal/system/update_service.go internal/system/update_service_test.go
git commit -m "fix: 更新服务接入可续传下载 provider"
```

---

### Task 4: 全量验证与变更记录

**Files:**
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: Task 1–3 的全部产出。
- Produces: 无新接口。

- [ ] **Step 1: 跑格式化与静态检查**

Run: `gofmt -l internal/system && go vet ./...`
Expected: `gofmt -l` 无输出；`go vet` 退出码 0。

- [ ] **Step 2: 跑测试**

Run: `go test ./internal/system/...`
Expected: 全部 PASS。

- [ ] **Step 3: 更新 `CHANGELOG.md`**

在 `## [Unreleased]` 下新增：

```markdown
### Fixed
- 应用内更新不再受 30 秒下载总超时限制，支持慢速网络下的 Range 断点续传与重试
```

- [ ] **Step 4: 提交**

```bash
git add CHANGELOG.md
git commit -m "docs: 记录更新下载韧性修复"
```

---

## Self-Review

- **Spec coverage:** 自定义 client（Task 1）、空闲超时（Task 1）、Range 续传与重试（Task 2）、忽略 Range 保护（Task 2）、接线（Task 3）、验证与记录（Task 4）均有对应任务。
- **Step scan:** 每个测试步骤给出了测试名、断言与精确值；每个实现步骤给出了签名和必须处理的边界。
- **Type consistency:** `newUpdateHTTPClient(time.Duration) *http.Client`、`newResilientProvider(updater.Provider, *http.Client) *resilientProvider`、`newUpdateProvider(*http.Client) (updater.Provider, error)` 在任务间一致。
- **Review Focus:** 忽略 Range、永久停滞、Content-Range 错位、写盘失败、context 取消均在 Task 2 的测试或实现规则中有覆盖。
