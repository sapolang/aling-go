package content

import "testing"

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
