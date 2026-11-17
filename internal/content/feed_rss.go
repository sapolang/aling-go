package content

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/mmcdole/gofeed"
	ext "github.com/mmcdole/gofeed/extensions"
)

// --- 订阅源解析 ---

// parseRSS 用 gofeed 解析 RSS 2.0 / Atom 1.0，再映射成统一的 FeedEpisode。
// B 站等平台专属接口不经过这里。
func parseRSS(data []byte) (title, desc, image, siteURL string, episodes []FeedEpisode, err error) {
	feed, perr := gofeed.NewParser().ParseString(string(data))
	if perr != nil {
		return "", "", "", "", nil, fmt.Errorf("解析订阅源失败: %w", perr)
	}
	if strings.TrimSpace(feed.Title) == "" && len(feed.Items) == 0 {
		return "", "", "", "", nil, fmt.Errorf("不是有效的订阅源")
	}

	title = strings.TrimSpace(feed.Title)
	desc = stripHTML(feed.Description)
	if desc == "" && feed.ITunesExt != nil {
		desc = stripHTML(feed.ITunesExt.Summary)
	}
	siteURL = strings.TrimSpace(feed.Link)
	image = feedImageURL(feed)

	for _, it := range feed.Items {
		if it == nil {
			continue
		}
		group := mediaGroup(it)
		link := strings.TrimSpace(it.Link)
		// 播客源有 enclosure（音频直链），视频源可能给出视频直链，
		// YouTube/B站 只有 link（视频页面），三种都要保留，后续按地址类型决定播放方式
		audioURL, mediaURL := episodeMediaURLs(it, group)
		if audioURL == "" && mediaURL == "" && link == "" {
			continue
		}
		guid := strings.TrimSpace(it.GUID)
		if guid == "" {
			switch {
			case audioURL != "":
				guid = audioURL
			case mediaURL != "":
				guid = mediaURL
			default:
				guid = link
			}
		}
		episodes = append(episodes, FeedEpisode{
			Title:       strings.TrimSpace(it.Title),
			Description: stripHTML(itemDescription(it, group)),
			AudioURL:    audioURL,
			MediaURL:    mediaURL,
			Link:        link,
			Duration:    itemDuration(it),
			PublishedAt: itemPublishedAt(it),
			Image:       itemImageURL(it, group, image),
			GUID:        guid,
		})
	}
	return title, desc, image, siteURL, episodes, nil
}

// feedImageURL 取频道封面：标准 image 优先，其次 itunes:image，Atom 源用首条节目封面兜底
func feedImageURL(feed *gofeed.Feed) string {
	image := ""
	if feed.Image != nil {
		image = strings.TrimSpace(feed.Image.URL)
	}
	if image == "" && feed.ITunesExt != nil {
		image = strings.TrimSpace(feed.ITunesExt.Image)
	}
	if image == "" && len(feed.Items) > 0 && feed.Items[0] != nil {
		image = mediaAttr(mediaGroup(feed.Items[0]), "thumbnail", "url")
	}
	// 统一升级为 https，避免 WKWebView 混合内容策略阻止 http 图片加载
	if strings.HasPrefix(image, "http://") {
		image = "https://" + strings.TrimPrefix(image, "http://")
	}
	return image
}

// mediaGroup 取 media:group 节点（YouTube 的 Atom 源用它承载标题、简介、封面与播放地址）
func mediaGroup(it *gofeed.Item) *ext.Extension {
	groups := it.Extensions["media"]["group"]
	if len(groups) == 0 {
		return nil
	}
	return &groups[0]
}

// mediaAttr 读取 media:group 子元素的属性值，如 media:thumbnail 的 url
func mediaAttr(group *ext.Extension, name, attr string) string {
	if group == nil {
		return ""
	}
	nodes := group.Children[name]
	if len(nodes) == 0 {
		return ""
	}
	return strings.TrimSpace(nodes[0].Attrs[attr])
}

// mediaText 读取 media:group 子元素的文本，如 media:description
func mediaText(group *ext.Extension, name string) string {
	if group == nil {
		return ""
	}
	nodes := group.Children[name]
	if len(nodes) == 0 {
		return ""
	}
	return strings.TrimSpace(nodes[0].Value)
}

// extensionAttr 读取条目上扁平扩展节点的属性，如 RSS 的 media:thumbnail
func extensionAttr(it *gofeed.Item, ns, name, attr string) string {
	nodes := it.Extensions[ns][name]
	if len(nodes) == 0 {
		return ""
	}
	return strings.TrimSpace(nodes[0].Attrs[attr])
}

// episodeMediaURLs 提取节目媒体地址：audioURL 用于下载与音频播放，
// mediaURL 是发布方给出的视频直链（如 media:content type="video/mp4"），
// 播放页地址（YouTube/B站 等）两者都不返回。
func episodeMediaURLs(it *gofeed.Item, group *ext.Extension) (audioURL, mediaURL string) {
	// enclosure 优先：音频归 audioURL，视频文件归 mediaURL
	for _, enc := range it.Enclosures {
		if enc == nil {
			continue
		}
		u := strings.TrimSpace(enc.URL)
		if u == "" || isMediaPageURL(u, enc.Type) {
			continue
		}
		if isDirectVideoURL(u, enc.Type) {
			if mediaURL == "" {
				mediaURL = u
			}
			continue
		}
		if audioURL == "" {
			audioURL = u
		}
	}
	if audioURL != "" {
		return audioURL, mediaURL
	}

	// media:content 在 YouTube Atom 里位于 media:group，普通 RSS 直接挂在条目上
	for _, content := range [][2]string{
		{mediaAttr(group, "content", "url"), mediaAttr(group, "content", "type")},
		{extensionAttr(it, "media", "content", "url"), extensionAttr(it, "media", "content", "type")},
	} {
		u, t := content[0], content[1]
		switch {
		case u == "" || isMediaPageURL(u, t):
			continue
		case isDirectVideoURL(u, t):
			if mediaURL == "" {
				mediaURL = u
			}
		case audioURL == "":
			audioURL = u
		}
	}
	return audioURL, mediaURL
}

// itemDescription 按 media:group → description → content 的顺序取简介
func itemDescription(it *gofeed.Item, group *ext.Extension) string {
	if d := mediaText(group, "description"); d != "" {
		return d
	}
	if d := strings.TrimSpace(it.Description); d != "" {
		return d
	}
	return it.Content
}

// itemDuration 取 itunes:duration，兼容 "3600"、"12:34"、"01:02:03"
func itemDuration(it *gofeed.Item) int {
	if it.ITunesExt == nil {
		return 0
	}
	return parseDuration(it.ITunesExt.Duration)
}

// itemPublishedAt 统一成 RFC3339 便于排序，解析失败返回空串
func itemPublishedAt(it *gofeed.Item) string {
	if it.PublishedParsed != nil {
		return it.PublishedParsed.Format(time.RFC3339)
	}
	if it.UpdatedParsed != nil {
		return it.UpdatedParsed.Format(time.RFC3339)
	}
	if t := normalizePubDate(it.Published); t != "" {
		return t
	}
	return normalizePubDate(it.Updated)
}

// itemImageURL 取节目封面：条目自带封面优先，最后用频道封面兜底
func itemImageURL(it *gofeed.Item, group *ext.Extension, feedImage string) string {
	candidates := []string{
		mediaAttr(group, "thumbnail", "url"),
		extensionAttr(it, "media", "thumbnail", "url"),
	}
	if it.Image != nil {
		candidates = append(candidates, strings.TrimSpace(it.Image.URL))
	}
	if it.ITunesExt != nil {
		candidates = append(candidates, strings.TrimSpace(it.ITunesExt.Image))
	}
	candidates = append(candidates, feedImage)
	for _, c := range candidates {
		if c != "" {
			return c
		}
	}
	return ""
}

// stripHTML 粗暴去掉标签与多余空白，用于简介展示
func stripHTML(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	var b strings.Builder
	inTag := false
	for _, r := range s {
		switch {
		case r == '<':
			inTag = true
		case r == '>':
			inTag = false
		case !inTag:
			b.WriteRune(r)
		}
	}
	out := b.String()
	out = strings.ReplaceAll(out, "&nbsp;", " ")
	out = strings.ReplaceAll(out, "&amp;", "&")
	out = strings.ReplaceAll(out, "&lt;", "<")
	out = strings.ReplaceAll(out, "&gt;", ">")
	out = strings.ReplaceAll(out, "&quot;", "\"")
	out = strings.ReplaceAll(out, "&#39;", "'")
	return strings.Join(strings.Fields(out), " ")
}

// parseDuration 支持 "3600"、"12:34"、"01:02:03" 三种 itunes:duration 写法
func parseDuration(raw string) int {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	if n, err := strconv.Atoi(raw); err == nil {
		return n
	}
	parts := strings.Split(raw, ":")
	total := 0
	for _, p := range parts {
		n, err := strconv.Atoi(strings.TrimSpace(p))
		if err != nil {
			return 0
		}
		total = total*60 + n
	}
	return total
}

var pubDateLayouts = []string{
	time.RFC1123Z,
	time.RFC1123,
	time.RFC822Z,
	time.RFC822,
	"Mon, 2 Jan 2006 15:04:05 -0700",
	"Mon, 02 Jan 2006 15:04:05 MST",
	"2006-01-02T15:04:05Z07:00",
	"2006-01-02",
}

// normalizePubDate 统一成 RFC3339 便于排序，解析失败返回空串
func normalizePubDate(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	for _, layout := range pubDateLayouts {
		if t, err := time.Parse(layout, raw); err == nil {
			return t.Format(time.RFC3339)
		}
	}
	return ""
}
