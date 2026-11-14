# 应用内更新下载韧性修复

## 背景 / Intent

应用内更新在慢速或抖动网络下会在 10% 以内失败。根因已复现：

- `internal/system/update_service.go` 创建 `github.Provider` 时未传 `HTTPClient`。
- Wails v3.1.0（以及 v3.2 nightly）的 GitHub provider 默认使用
  `&http.Client{Timeout: 30 * time.Second}`。Go 的 `Client.Timeout` 覆盖整个请求，
  包括读完 15.6 MB 响应体。
- 30 秒内下不完就被中断，报
  `context deadline exceeded (Client.Timeout or context cancellation while reading body)`；
  没有重试，也没有断点续传。

本机残留的 `/Applications/wails-update-3995218616/.artifact` 只有 861,587 字节（5.5%），
与上述故障一致。当前网络可直接在数秒内下完同一个 zip，说明 release 资源本身正常。

## 目标 / Goals

- 下载耗时不再受固定总时长限制（15.6 MB 在 30 KB/s 下约需 9 分钟也能完成）。
- 单次网络停滞有上限：连续 60 秒收不到数据才判定失败，避免界面永久卡住。
- 连接中断后可从已下载字节处续传，最多重试 4 次，指数退避。
- 续传必须保持字节连续，确保 updater 边下载边计算的 SHA-256 仍然有效。
- 行为变化只发生在 `internal/system`；不改发布流程、前端和 Wails 绑定。

## 非目标 / Non-goals

- 不替换 Wails updater，不改 `DownloadAndInstall` / `Restart` 流程。
- 不实现系统代理（macOS `scutil --proxy`）自动发现。
- 不改变更新检查、版本比较、安装后重启逻辑。
- 不处理 Windows / Linux 的特殊网络差异。

## 反目标 / Anti-goals

- 不能在服务端不支持 Range 时把重复字节写进目标文件。
- 不能让重试掩盖真正不可恢复的错误（404 / 校验失败 / 磁盘错误）。
- 不能让失败路径留下临时文件。

## 方案 / Approaches Considered

**A. 只替换 HTTP client（无总超时 + 空闲超时）。** 改动最小，解决 30 秒硬上限；
但连接一旦断开仍需从 0 重下，对频繁抖动的网络帮助有限。

**B. 只加 Range 重试，继续用默认 client。** 30 秒总超时仍在，长下载照样会被掐断，
无法单独成立。

**C. A + B（选用）。** 自定义 client 解决总超时；Provider 包装器实现 Range 续传，
覆盖断线场景。改动集中在两个新文件加一个初始化点，测试可用本地 `httptest` 完整覆盖。

## 设计 / Design

### 1. 下载专用 HTTP client

在 `internal/system/update_http.go` 新增 `newUpdateHTTPClient()`：

- 克隆 `http.DefaultTransport`。
- `DialContext`：连接超时 15s，KeepAlive 30s。
- `TLSHandshakeTimeout` 15s、`ResponseHeaderTimeout` 30s、`IdleConnTimeout` 90s。
- `http.Client` 不设置 `Timeout`（即无整体上限）。
- 包装 `net.Conn`：每次 `Read` 前设置 60s 读截止时间，收到数据即续期。
  这是“空闲超时”而不是“总超时”，真正的卡死仍会在 60s 后返回错误。

### 2. 可续传的 provider 包装器

在 `internal/system/update_provider.go` 新增 `resilientProvider`，实现
`updater.Provider`：

- `Name()` / `Check()` 直接委托给内部 `*github.Provider`。
- `Download()` 自行发送下载请求，`Rel.Metadata["github.asset.url"]` 取地址：
  - 首次请求不带 Range，接受 200；记录响应 `ETag`。
  - 读取过程中若发生网络错误、`io.ErrUnexpectedEOF` 或 5xx/429，且仍有重试次数：
    等待 1s / 2s / 4s / 8s，带 `Range: bytes=<written>-` 与
    `If-Range: <ETag>` 重试。
  - 续传响应必须是 206，且 `Content-Range` 起点等于已写字节数；否则立即失败，
    绝不把重复前缀写入目标流。
  - 服务端返回 200 且 `written > 0` 时同样立即失败（无法回退已写字节）。
  - `onProgress(written, total)` 全程使用总大小，进度单调。
  - 正常 EOF 时若 `total > 0` 且 `written != total`，视为失败。
- 重试参数（次数、退避、空闲超时）做成结构体字段，测试可注入更短的值。

### 3. 接线

`NewUpdateService` 中：

```go
client := newUpdateHTTPClient(idleTimeout)
base, err := github.New(github.Config{... HTTPClient: client})
provider := &resilientProvider{base: base, client: client, ...}
```

`updater.Config.Providers` 使用包装器。

## 测试 / Tests

`internal/system/update_provider_test.go`，使用 `httptest`：

1. **慢速/停滞下载**：服务端先发 10%，停 300ms，再发完。默认 client（30s）在测试里
   用短超时等价模拟，包装器用 1s 空闲超时 → 必须完整下载且 SHA-256 与源一致。
2. **中途断开两次**：服务端在 30% / 70% 主动断开，支持 Range；包装器续传成功，
   字节与源完全一致。
3. **服务端忽略 Range**：续传请求返回 200 → 返回明确错误，且不追加重复数据。
4. **空闲超时**：服务端发 10% 后永久停住 → 在约一个空闲超时后失败，而不是无限挂起。

现有 `go vet ./...` 与 `go test ./internal/system/...` 必须通过。

## 风险 / Risks

- GitHub 资源链接带签名且较短有效期（约 1 小时）；一次下载内的重试通常仍在有效期内。
  过期后重试会得到 403，包装器会把错误原样返回，用户可重新点击下载获取新链接。
- 默认 `Transport` 在 GUI 应用中不读取 macOS 系统代理；这是既有行为，本次不改。
- 空闲超时 60s 是折中值；可在 `update_service.go` 一处调整。
