package content

import "testing"

func TestDetectFileType(t *testing.T) {
	cases := []struct {
		name string
		want string
	}{
		{"movie.mp4", "video"},
		{"movie.MKV", "video"},
		{"clip.m4v", "video"},
		{"episode.mp3", "audio"},
		{"book.M4B", "audio"},
		{"notes.pdf", "pdf"},
		{"notes.PDF", "pdf"},
		{"archive.zip", ""},
		{"noext", ""},
	}
	for _, c := range cases {
		if got := detectFileType(c.name); got != c.want {
			t.Errorf("detectFileType(%q) = %q, want %q", c.name, got, c.want)
		}
	}
}

func TestMediaMIME(t *testing.T) {
	cases := map[string]string{
		".mp4": "video/mp4",
		"mp3":  "audio/mpeg",
		".m4a": "audio/mp4",
		".pdf": "application/pdf",
		".xyz": "",
	}
	for ext, want := range cases {
		if got := mediaMIME(ext); got != want {
			t.Errorf("mediaMIME(%q) = %q, want %q", ext, got, want)
		}
	}
}

func TestIsAudioExt(t *testing.T) {
	if !isAudioExt("mp3") || !isAudioExt(".FLAC") {
		t.Fatal("expected mp3/flac to be audio")
	}
	if isAudioExt("mp4") || isAudioExt("pdf") || isAudioExt("unknown") {
		t.Fatal("expected mp4/pdf/unknown not to be audio")
	}
}
