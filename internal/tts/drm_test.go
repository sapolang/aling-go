package tts

import (
	"strings"
	"testing"
)

func TestGenerateSecMSGECV2KnownVector(t *testing.T) {
	const want = "492D7694A183A45E-56E821F95D4579C5B7C7E33DC7303FF379EC36D510213555BBBB9EB17EF15876"
	if got := generateSecMSGECV2(1791888000); got != want {
		t.Fatalf("Sec-MS-GEC v2 = %s, want %s", got, want)
	}
}

func TestGenerateSecMSGECV2Format(t *testing.T) {
	token := generateSecMSGECV2(1791888000)
	parts := strings.Split(token, "-")
	if len(parts) != 2 {
		t.Fatalf("令牌格式不对: %q", token)
	}
	if len(parts[0]) != 16 || len(parts[1]) != 64 {
		t.Fatalf("令牌长度不对: %q", token)
	}
	if token != strings.ToUpper(token) {
		t.Fatalf("令牌应为大写: %q", token)
	}
}

func TestGenerateSecMSGECV2StableWithinWindow(t *testing.T) {
	base := float64(1791888000)
	if first, second := generateSecMSGECV2(base), generateSecMSGECV2(base+240); first != second {
		t.Fatalf("同一 5 分钟窗口令牌应一致: %s != %s", first, second)
	}
	if first, third := generateSecMSGECV2(base), generateSecMSGECV2(base+360); first == third {
		t.Fatal("跨窗口后令牌应变化")
	}
}
