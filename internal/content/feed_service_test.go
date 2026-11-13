package content

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

const sampleRSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>6 Minute English</title>
    <link>https://www.bbc.co.uk/programmes/p02pc9tn</link>
    <description>&lt;p&gt;Learn English in 6 minutes&lt;/p&gt;</description>
    <image><url>https://example.com/cover.jpg</url></image>
    <item>
      <title>Episode 1: Coffee</title>
      <description>All about coffee &amp; tea</description>
      <guid isPermaLink="false">ep-1</guid>
      <pubDate>Mon, 04 Nov 2024 09:00:00 +0000</pubDate>
      <enclosure url="https://example.com/ep1.mp3" type="audio/mpeg" length="12345"/>
      <itunes:duration>06:12</itunes:duration>
    </item>
    <item>
      <title>Episode 2: Sleep</title>
      <pubDate>Tue, 05 Nov 2024 09:00:00 +0000</pubDate>
      <enclosure url="https://example.com/ep2.mp3" type="audio/mpeg"/>
      <itunes:duration>3723</itunes:duration>
    </item>
    <item>
      <title>无音频的条目</title>
      <guid>ep-3</guid>
    </item>
  </channel>
</rss>`

func TestParseRSS(t *testing.T) {
	title, desc, image, siteURL, episodes, err := parseRSS([]byte(sampleRSS))
	if err != nil {
		t.Fatalf("parseRSS error: %v", err)
	}
	if title != "6 Minute English" {
		t.Errorf("title = %q", title)
	}
	if desc != "Learn English in 6 minutes" {
		t.Errorf("desc = %q", desc)
	}
	if image != "https://example.com/cover.jpg" {
		t.Errorf("image = %q", image)
	}
	if siteURL != "https://www.bbc.co.uk/programmes/p02pc9tn" {
		t.Errorf("siteURL = %q", siteURL)
	}
	// 没有 enclosure 的条目应被跳过
	if len(episodes) != 2 {
		t.Fatalf("episodes = %d, want 2", len(episodes))
	}
	if episodes[0].GUID != "ep-1" {
		t.Errorf("guid = %q", episodes[0].GUID)
	}
	if episodes[0].Duration != 372 {
		t.Errorf("duration = %d, want 372", episodes[0].Duration)
	}
	if episodes[0].PublishedAt != "2024-11-04T09:00:00Z" {
		t.Errorf("publishedAt = %q", episodes[0].PublishedAt)
	}
	// guid 缺失时回退到音频地址
	if episodes[1].GUID != "https://example.com/ep2.mp3" {
		t.Errorf("guid fallback = %q", episodes[1].GUID)
	}
	if episodes[1].Duration != 3723 {
		t.Errorf("duration = %d, want 3723", episodes[1].Duration)
	}
}

func TestParseRSSRejectsInvalidDocument(t *testing.T) {
	if _, _, _, _, _, err := parseRSS([]byte(`<html><body>not a feed</body></html>`)); err == nil {
		t.Fatal("expected error for non-rss document")
	}
}

const sampleAtom = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
  <link rel="self" href="https://www.youtube.com/feeds/videos.xml?channel_id=UC123"/>
  <link rel="alternate" href="https://www.youtube.com/channel/UC123"/>
  <id>yt:channel:UC123</id>
  <title>Test Channel</title>
  <entry>
    <id>yt:video:abc</id>
    <title>Video One</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=abc"/>
    <published>2024-11-04T09:00:00+00:00</published>
    <updated>2024-11-05T09:00:00+00:00</updated>
    <media:group>
      <media:description>Desc &lt;b&gt;one&lt;/b&gt;</media:description>
      <media:thumbnail url="https://i.ytimg.com/vi/abc/hq.jpg"/>
      <media:content url="https://www.youtube.com/v/abc?version=3" type="application/x-shockwave-flash"/>
    </media:group>
  </entry>
</feed>`

func TestParseAtomYouTubeFeed(t *testing.T) {
	title, _, image, siteURL, episodes, err := parseRSS([]byte(sampleAtom))
	if err != nil {
		t.Fatalf("parseRSS error: %v", err)
	}
	if title != "Test Channel" {
		t.Errorf("title = %q", title)
	}
	// YouTube 的 Atom 源没有 logo，用首条视频封面兜底
	if image != "https://i.ytimg.com/vi/abc/hq.jpg" {
		t.Errorf("image = %q", image)
	}
	if siteURL != "https://www.youtube.com/channel/UC123" {
		t.Errorf("siteURL = %q", siteURL)
	}
	if len(episodes) != 1 {
		t.Fatalf("episodes = %d, want 1", len(episodes))
	}
	ep := episodes[0]
	if ep.Link != "https://www.youtube.com/watch?v=abc" {
		t.Errorf("link = %q", ep.Link)
	}
	// media:content 是视频播放页，不应被当成可下载音频
	if ep.AudioURL != "" {
		t.Errorf("audioURL = %q, want empty", ep.AudioURL)
	}
	if ep.GUID != "yt:video:abc" {
		t.Errorf("guid = %q", ep.GUID)
	}
	if ep.Description != "Desc one" {
		t.Errorf("description = %q", ep.Description)
	}
	if ep.PublishedAt != "2024-11-04T09:00:00Z" {
		t.Errorf("publishedAt = %q", ep.PublishedAt)
	}
	if ep.Image != "https://i.ytimg.com/vi/abc/hq.jpg" {
		t.Errorf("episode image = %q", ep.Image)
	}
}

const sampleRSSWithMedia = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>Pod</title>
    <link>https://example.com</link>
    <description>Pod desc</description>
    <itunes:image href="https://example.com/cover.jpg"/>
    <item>
      <title>Ep with artwork</title>
      <guid>ep-a</guid>
      <pubDate>Tue, 05 Nov 2024 09:00:00 +0000</pubDate>
      <enclosure url="https://example.com/a.mp3" type="audio/mpeg"/>
      <media:thumbnail url="https://example.com/a.jpg"/>
    </item>
    <item>
      <title>Ep without artwork</title>
      <link>https://example.com/ep-b</link>
      <enclosure url="https://example.com/b.mp3" type="audio/mpeg"/>
    </item>
  </channel>
</rss>`

func TestParseRSSEpisodeArtwork(t *testing.T) {
	_, _, image, _, episodes, err := parseRSS([]byte(sampleRSSWithMedia))
	if err != nil {
		t.Fatalf("parseRSS error: %v", err)
	}
	// 频道没有 <image> 时用 itunes:image
	if image != "https://example.com/cover.jpg" {
		t.Errorf("feed image = %q", image)
	}
	if len(episodes) != 2 {
		t.Fatalf("episodes = %d, want 2", len(episodes))
	}
	if episodes[0].Image != "https://example.com/a.jpg" {
		t.Errorf("episode 0 image = %q", episodes[0].Image)
	}
	// 条目没有独立封面时用频道封面兜底
	if episodes[1].Image != "https://example.com/cover.jpg" {
		t.Errorf("episode 1 image = %q", episodes[1].Image)
	}
	if episodes[1].GUID != "https://example.com/b.mp3" {
		t.Errorf("episode 1 guid = %q", episodes[1].GUID)
	}
}

func TestParseDuration(t *testing.T) {
	cases := map[string]int{
		"":          0,
		"90":        90,
		"06:12":     372,
		"01:02:03":  3723,
		"not-a-num": 0,
	}
	for in, want := range cases {
		if got := parseDuration(in); got != want {
			t.Errorf("parseDuration(%q) = %d, want %d", in, got, want)
		}
	}
}

func TestSanitizeFileName(t *testing.T) {
	if got := sanitizeFileName("EP1: Coffee / Tea?"); got != "EP1_ Coffee _ Tea_" {
		t.Errorf("sanitizeFileName = %q", got)
	}
	if got := sanitizeFileName("   "); got != "" {
		t.Errorf("blank name = %q", got)
	}
}

func TestBilibiliProxyUsesServerSideStreamID(t *testing.T) {
	s := &MediaService{mediaPort: 18080}
	for _, raw := range []string{
		"https://example.com/video.mp4",
		"http://upos-sz-mirror.bilivideo.com/video.mp4",
		"https://bilivideo.com.evil.example/video.mp4",
		"https://upos-sz-mirror.bilivideo.com@evil.example/video.mp4",
	} {
		if got := s.biliProxyURL(raw); got != "" {
			t.Errorf("biliProxyURL(%q) = %q, want empty", raw, got)
		}
	}

	upstream := "https://upos-sz-mirror.bilivideo.com/video.mp4?foo=bar"
	proxy := s.biliProxyURL(upstream)
	parsed, err := url.Parse(proxy)
	if err != nil {
		t.Fatalf("parse proxy URL: %v", err)
	}
	if parsed.Query().Get("url") != "" {
		t.Fatalf("proxy URL still exposes upstream URL: %q", proxy)
	}
	id := parsed.Query().Get("id")
	if id == "" {
		t.Fatalf("proxy URL has no stream ID: %q", proxy)
	}
	if s.biliStreamID != id || s.biliUpstream != upstream {
		t.Fatalf("stored stream = (%q, %q), want (%q, %q)", s.biliStreamID, s.biliUpstream, id, upstream)
	}

	s.remoteClientFn = func() *http.Client { return http.DefaultClient }
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/bili-stream?url="+url.QueryEscape("https://example.com/video.mp4"), nil)
	s.handleBiliStream(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("legacy URL parameter status = %d, want %d", recorder.Code, http.StatusBadRequest)
	}
}

func TestDetectPlatformAnchorsURL(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		kind platformKind
		id   string
	}{
		{name: "youtube watch", raw: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", kind: platformYouTube, id: "video:dQw4w9WgXcQ"},
		{name: "youtube watch with params", raw: "https://www.youtube.com/watch?foo=1&v=dQw4w9WgXcQ", kind: platformYouTube, id: "video:dQw4w9WgXcQ"},
		{name: "youtube short", raw: "https://youtu.be/dQw4w9WgXcQ?t=1", kind: platformYouTube, id: "video:dQw4w9WgXcQ"},
		{name: "youtube handle without scheme", raw: "www.youtube.com/@MKBHD", kind: platformYouTube, id: "@MKBHD"},
		{name: "bilibili space", raw: "https://space.bilibili.com/123456", kind: platformBilibili, id: "123456"},
		{name: "fake youtube in query", raw: "https://evil.example/?next=https://www.youtube.com/@MKBHD", kind: platformYouTube, id: ""},
		{name: "fake bilibili in path", raw: "https://evil.example/https://space.bilibili.com/123456", kind: platformBilibili, id: ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			kind, id := DetectPlatform(tt.raw)
			if kind != tt.kind || id != tt.id {
				t.Fatalf("DetectPlatform(%q) = (%v, %q), want (%v, %q)", tt.raw, kind, id, tt.kind, tt.id)
			}
		})
	}
}

func TestExtractYouTubeChannelIDFromCanonicalHref(t *testing.T) {
	const channelID = "UC1234567890123456789012"
	data := []byte(`<html><head><link rel="alternate" href="https://evil.example/"><link rel="canonical" href="https://www.youtube.com/channel/` + channelID + `"></head></html>`)
	got, err := extractYouTubeChannelID(data)
	if err != nil || got != channelID {
		t.Fatalf("extractYouTubeChannelID() = %q, %v; want %q", got, err, channelID)
	}
}

func TestBilibiliMidFromURLBoundaries(t *testing.T) {
	for _, raw := range []string{
		"https://rsshub.app/bilibili/user/video/12345",
		"https://space.bilibili.com/12345",
	} {
		if got := bilibiliMidFromURL(raw); got != "12345" {
			t.Errorf("bilibiliMidFromURL(%q) = %q, want 12345", raw, got)
		}
	}
	fake := "https://evil.example/?next=space.bilibili.com/12345"
	if got := bilibiliMidFromURL(fake); got != "" {
		t.Errorf("bilibiliMidFromURL(%q) = %q, want empty", fake, got)
	}
}
