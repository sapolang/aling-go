//go:build windows

package system

import "testing"

func TestParseWindowsProxyEnable(t *testing.T) {
	enabled := `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Internet Settings
    ProxyEnable    REG_DWORD    0x1
`
	if !parseWindowsProxyEnable(enabled) {
		t.Fatal("ProxyEnable 0x1 should be enabled")
	}
	disabled := `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Internet Settings
    ProxyEnable    REG_DWORD    0x0
`
	if parseWindowsProxyEnable(disabled) {
		t.Fatal("ProxyEnable 0x0 should be disabled")
	}
}

func TestParseWindowsProxyServer(t *testing.T) {
	out := `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Internet Settings
    ProxyServer    REG_SZ    127.0.0.1:7890
`
	s := parseWindowsProxyServer(out)
	if s == nil || s.http == nil || s.http.String() != "http://127.0.0.1:7890" || s.https == nil {
		t.Fatalf("single proxy = %+v, want http/https 127.0.0.1:7890", s)
	}

	perScheme := `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Internet Settings
    ProxyServer    REG_SZ    http=127.0.0.1:7890;https=127.0.0.1:7891;socks=127.0.0.1:7892
`
	s = parseWindowsProxyServer(perScheme)
	if s == nil || s.http == nil || s.http.String() != "http://127.0.0.1:7890" {
		t.Fatalf("http proxy = %v, want http://127.0.0.1:7890", s)
	}
	if s.https == nil || s.https.String() != "http://127.0.0.1:7891" {
		t.Fatalf("https proxy = %v, want http://127.0.0.1:7891", s)
	}
	if s.socks == nil || s.socks.String() != "socks5://127.0.0.1:7892" {
		t.Fatalf("socks proxy = %v, want socks5://127.0.0.1:7892", s)
	}
}
