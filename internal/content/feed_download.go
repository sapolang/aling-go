package content

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"aling-go/internal/store/userdb"
)

// --- 下载 ---

// EpisodeDownload 下载指定节目音频到本地，并登记进媒体库
func (s *FeedService) EpisodeDownload(episodeID int64) EpisodeDownloadResult {
	info, err := q().GetEpisodeDownloadInfo(context.Background(), episodeID)
	if err != nil {
		return EpisodeDownloadResult{Error: "节目不存在"}
	}
	feedID, title, audioURL, localPath := info.FeedID, info.Title, info.AudioUrl, info.LocalPath
	if localPath != "" {
		if _, statErr := os.Stat(localPath); statErr == nil {
			return EpisodeDownloadResult{OK: true, Path: localPath}
		}
	}
	if audioURL == "" {
		return EpisodeDownloadResult{Error: "该节目没有可下载的音频地址"}
	}

	dir := filepath.Join(s.dataDir, "podcasts", strconv.FormatInt(feedID, 10))
	if err := os.MkdirAll(dir, 0755); err != nil {
		return EpisodeDownloadResult{Error: "创建下载目录失败: " + err.Error()}
	}

	req, err := http.NewRequest(http.MethodGet, audioURL, nil)
	if err != nil {
		return EpisodeDownloadResult{Error: "音频地址无效"}
	}
	req.Header.Set("User-Agent", "Aling/1.0 (Podcast Subscriber)")

	resp, err := s.httpClient().Do(req)
	if err != nil {
		// 网络层错误（超时、连接拒绝等），尝试将 http 升级为 https 重试一次
		if strings.HasPrefix(audioURL, "http://") {
			httpsURL := "https://" + strings.TrimPrefix(audioURL, "http://")
			if req2, e2 := http.NewRequest(http.MethodGet, httpsURL, nil); e2 == nil {
				req2.Header.Set("User-Agent", "Aling/1.0 (Podcast Subscriber)")
				if resp2, e3 := s.httpClient().Do(req2); e3 == nil {
					resp = resp2
					err = nil
					audioURL = httpsURL
				}
			}
		}
	}
	if err != nil {
		return EpisodeDownloadResult{Error: "下载失败，请检查网络或配置代理: " + err.Error()}
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return EpisodeDownloadResult{Error: downloadStatusError(resp.StatusCode, resp.Status)}
	}
	// 有些视频源返回 200 但内容其实是网页，直接落盘会得到一个打不开的假音频
	if isWebPageContentType(resp.Header.Get("Content-Type")) {
		return EpisodeDownloadResult{
			Error: "该节目没有可直接下载的音频文件（服务器返回的是网页），请在浏览器中打开或使用在线精听",
		}
	}

	ext := audioExtFromURL(audioURL, resp.Header.Get("Content-Type"))
	name := sanitizeFileName(title)
	if name == "" {
		name = strconv.FormatInt(episodeID, 10)
	}
	dest := filepath.Join(dir, name+"."+ext)

	tmp := dest + ".part"
	out, err := os.Create(tmp)
	if err != nil {
		return EpisodeDownloadResult{Error: "创建文件失败: " + err.Error()}
	}

	total := resp.ContentLength
	var written int64
	buf := make([]byte, 64*1024)
	lastPct := -1
	for {
		n, rerr := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := out.Write(buf[:n]); werr != nil {
				_ = out.Close()
				_ = os.Remove(tmp)
				return EpisodeDownloadResult{Error: "写入失败: " + werr.Error()}
			}
			written += int64(n)
			if total > 0 {
				pct := int(written * 100 / total)
				if pct != lastPct {
					lastPct = pct
					s.app.Event.Emit("feed:download-progress", map[string]any{
						"episodeId": episodeID,
						"pct":       pct,
					})
				}
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			_ = out.Close()
			_ = os.Remove(tmp)
			return EpisodeDownloadResult{Error: "下载中断: " + rerr.Error()}
		}
	}
	if err := out.Close(); err != nil {
		_ = os.Remove(tmp)
		return EpisodeDownloadResult{Error: "保存文件失败: " + err.Error()}
	}
	if err := os.Rename(tmp, dest); err != nil {
		_ = os.Remove(tmp)
		return EpisodeDownloadResult{Error: "保存文件失败: " + err.Error()}
	}

	_ = q().SetEpisodeLocalPath(context.Background(), userdb.SetEpisodeLocalPathParams{
		LocalPath: dest,
		ID:        episodeID,
	})
	if s.library != nil {
		s.library.ImportFiles([]string{dest}, "")
	}
	s.app.Event.Emit("feed:download-progress", map[string]any{"episodeId": episodeID, "pct": 100})

	return EpisodeDownloadResult{OK: true, Path: dest}
}

// isVideoMediaURL 判断 media:content 指向的是视频播放页而非音频直链。
// YouTube/B站 的视频页需要走在线精听，下载下来只会得到 HTML。
func isVideoMediaURL(rawURL, mediaType string) bool {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return false
	}
	mt := strings.ToLower(strings.TrimSpace(mediaType))
	if strings.HasPrefix(mt, "video/") || strings.Contains(mt, "shockwave-flash") {
		return true
	}
	u, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	host := strings.ToLower(u.Hostname())
	for _, videoHost := range []string{"youtube.com", "youtu.be", "bilibili.com", "b23.tv"} {
		if host == videoHost || strings.HasSuffix(host, "."+videoHost) {
			return !isAudioExt(filepath.Ext(u.Path))
		}
	}
	return false
}

// isWebPageContentType 判断响应是否为网页而非音频文件
func isWebPageContentType(contentType string) bool {
	ct := strings.ToLower(strings.TrimSpace(contentType))
	if i := strings.Index(ct, ";"); i >= 0 {
		ct = strings.TrimSpace(ct[:i])
	}
	return strings.HasPrefix(ct, "text/") ||
		strings.Contains(ct, "html") ||
		strings.Contains(ct, "json") ||
		strings.Contains(ct, "xml")
}

// audioExtFromURL 依据 URL 后缀或 Content-Type 判断音频扩展名
func audioExtFromURL(rawURL, contentType string) string {
	ct := strings.ToLower(contentType)
	switch {
	case strings.Contains(ct, "mpeg"), strings.Contains(ct, "mp3"):
		return "mp3"
	case strings.Contains(ct, "mp4"), strings.Contains(ct, "m4a"), strings.Contains(ct, "x-m4a"):
		return "m4a"
	case strings.Contains(ct, "aac"):
		return "aac"
	case strings.Contains(ct, "ogg"), strings.Contains(ct, "opus"):
		return "ogg"
	case strings.Contains(ct, "wav"):
		return "wav"
	case strings.Contains(ct, "flac"):
		return "flac"
	}

	if u, err := url.Parse(rawURL); err == nil {
		ext := filepath.Ext(u.Path)
		if isAudioExt(ext) {
			return extOf(ext)
		}
	}
	return "mp3"
}

// sanitizeFileName 去掉路径分隔符等非法字符，限制长度避免超出文件系统限制
func sanitizeFileName(name string) string {
	replacer := strings.NewReplacer(
		"/", "_", "\\", "_", ":", "_", "*", "_", "?", "_",
		"\"", "_", "<", "_", ">", "_", "|", "_", "\n", " ", "\r", " ", "\t", " ",
	)
	cleaned := strings.TrimSpace(replacer.Replace(name))
	cleaned = strings.Join(strings.Fields(cleaned), " ")
	runes := []rune(cleaned)
	if len(runes) > 80 {
		cleaned = string(runes[:80])
	}
	return cleaned
}

// downloadStatusError 根据 HTTP 状态码生成更友好的错误提示，
// 帮助用户区分是源站问题、代理问题还是权限问题。
func downloadStatusError(code int, status string) string {
	switch {
	case code == http.StatusBadGateway || code == http.StatusServiceUnavailable || code == http.StatusGatewayTimeout:
		return "下载失败: HTTP " + status + "（无法连接到音频服务器，若使用了代理请尝试切换节点或调整代理规则）"
	case code == http.StatusForbidden:
		return "下载失败: HTTP " + status + "（服务器拒绝访问，该音频可能已下架或仅限特定地区）"
	case code == http.StatusNotFound:
		return "下载失败: HTTP " + status + "（音频文件不存在，节目可能已更新地址，请刷新订阅源后重试）"
	case code >= 500:
		return "下载失败: HTTP " + status + "（服务器内部错误，请稍后重试）"
	default:
		return "下载失败: HTTP " + status
	}
}
