package content

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeSubtitleCache(t *testing.T, s *PlatformService, kind platformKind, id string, cues []SubtitleCue) {
	t.Helper()
	raw, err := json.Marshal(cues)
	if err != nil {
		t.Fatal(err)
	}
	cachePath := s.platformSubtitleCachePath(kind, id)
	if err := os.MkdirAll(filepath.Dir(cachePath), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(cachePath, raw, 0644); err != nil {
		t.Fatal(err)
	}
}

// 自动加载只应返回缓存或官方字幕。无缓存且 ID 无效时给出明确提示，
// 而不是悄悄回退到本地转录（那会下载音轨并跑模型）。
func TestSubtitlesByPlatformNeverTranscribes(t *testing.T) {
	s := &PlatformService{dataDir: t.TempDir()}
	id := "video:dQw4w9WgXcQ"
	writeSubtitleCache(t, s, platformYouTube, id, []SubtitleCue{{Start: 0, End: 1.5, Text: "hello"}})

	got := s.subtitlesByPlatform(platformYouTube, id)
	if !got.OK || len(got.Cues) != 1 || got.Cues[0].Text != "hello" {
		t.Fatalf("缓存字幕 = %+v, want hello", got)
	}

	got = s.subtitlesByPlatform(platformYouTube, "video:bad")
	if got.OK || !strings.Contains(got.Error, "没有官方字幕") {
		t.Fatalf("无官方字幕时应提示手动转录, got %+v", got)
	}
}

// 手动转录命中缓存时不应访问网络；订阅视频的 bili:<bvid>:<cid> 也要归一到同一 key。
func TestTranscribeBySourceReusesCache(t *testing.T) {
	s := &PlatformService{dataDir: t.TempDir()}
	writeSubtitleCache(t, s, platformYouTube, "video:dQw4w9WgXcQ", []SubtitleCue{{Start: 0, End: 2, Text: "cached"}})
	writeSubtitleCache(t, s, platformBilibili, "bv:BV1xx411c7mD:123", []SubtitleCue{{Start: 0, End: 3, Text: "分P字幕"}})

	yt := s.TranscribeBySource("youtube", "dQw4w9WgXcQ", false)
	if !yt.OK || len(yt.Cues) != 1 || yt.Cues[0].Text != "cached" {
		t.Fatalf("YouTube 缓存字幕 = %+v, want cached", yt)
	}
	if yt.Platform != "youtube" || yt.VideoID != "video:dQw4w9WgXcQ" {
		t.Fatalf("结果标识 = %q/%q", yt.Platform, yt.VideoID)
	}

	bili := s.TranscribeBySource("bilibili", "bili:BV1xx411c7mD:123", false)
	if !bili.OK || len(bili.Cues) != 1 || bili.Cues[0].Text != "分P字幕" {
		t.Fatalf("B站缓存字幕 = %+v, want 分P字幕", bili)
	}

	bad := s.TranscribeBySource("unknown", "xxx", false)
	if bad.OK || bad.Error == "" {
		t.Fatalf("不支持的平台应返回错误, got %+v", bad)
	}
}
