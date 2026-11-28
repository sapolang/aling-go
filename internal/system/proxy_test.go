package system

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func testProxyURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("parse proxy URL %q: %v", raw, err)
	}
	return u
}

func TestProxyForRequestEnvTakesPriority(t *testing.T) {
	envProxy := testProxyURL(t, "http://env-proxy:8080")
	s := &systemProxy{
		http:  testProxyURL(t, "http://system-proxy:7897"),
		https: testProxyURL(t, "http://system-proxy:7897"),
	}
	req := httptest.NewRequest(http.MethodGet, "https://github.com/sapolang/aling-go", nil)

	got, err := proxyForRequest(req, s, func(*http.Request) (*url.URL, error) { return envProxy, nil })
	if err != nil || got == nil || got.String() != envProxy.String() {
		t.Fatalf("proxy = %v, %v; want env proxy %s", got, err, envProxy)
	}
}

func TestProxyForRequestFallsBackToSystemProxy(t *testing.T) {
	s := &systemProxy{
		http:  testProxyURL(t, "http://127.0.0.1:7897"),
		https: testProxyURL(t, "http://127.0.0.1:7897"),
		socks: testProxyURL(t, "socks5://127.0.0.1:7897"),
	}
	noEnv := func(*http.Request) (*url.URL, error) { return nil, nil }

	cases := []struct {
		url  string
		want string
	}{
		{"https://github.com/sapolang/aling-go", "http://127.0.0.1:7897"},
		{"http://github.com/sapolang/aling-go", "http://127.0.0.1:7897"},
		{"ftp://example.com/file", "socks5://127.0.0.1:7897"},
	}
	for _, tc := range cases {
		req := httptest.NewRequest(http.MethodGet, tc.url, nil)
		got, err := proxyForRequest(req, s, noEnv)
		if err != nil || got == nil || got.String() != tc.want {
			t.Errorf("proxy for %s = %v, %v; want %s", tc.url, got, err, tc.want)
		}
	}
}

func TestProxyForRequestUsesSocksWhenNoMatchingProtocol(t *testing.T) {
	s := &systemProxy{socks: testProxyURL(t, "socks5://127.0.0.1:7897")}
	req := httptest.NewRequest(http.MethodGet, "https://github.com/sapolang/aling-go", nil)

	got, err := proxyForRequest(req, s, nil)
	if err != nil || got == nil || got.String() != "socks5://127.0.0.1:7897" {
		t.Fatalf("proxy = %v, %v; want SOCKS fallback", got, err)
	}
}

func TestProxyForRequestSkipsLoopback(t *testing.T) {
	s := &systemProxy{https: testProxyURL(t, "http://127.0.0.1:7897")}
	for _, raw := range []string{"http://localhost:8080/api", "http://127.0.0.1:8080/api"} {
		req := httptest.NewRequest(http.MethodGet, raw, nil)
		got, err := proxyForRequest(req, s, nil)
		if err != nil || got != nil {
			t.Errorf("proxy for %s = %v, %v; want direct", raw, got, err)
		}
	}
}

func TestProxyForRequestPropagatesEnvError(t *testing.T) {
	wantErr := errors.New("proxy probe failed")
	got, err := proxyForRequest(
		httptest.NewRequest(http.MethodGet, "https://github.com/sapolang/aling-go", nil),
		&systemProxy{https: testProxyURL(t, "http://127.0.0.1:7897")},
		func(*http.Request) (*url.URL, error) { return nil, wantErr },
	)
	if err != wantErr || got != nil {
		t.Fatalf("proxy = %v, %v; want error %v", got, err, wantErr)
	}
}

func TestParseSCUtilProxy(t *testing.T) {
	out := `<dictionary> {
  ExceptionsList : <array> {
    0 : 127.0.0.1
    1 : localhost
  }
  FTPPassive : 1
  HTTPEnable : 1
  HTTPPort : 7897
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7897
  HTTPSProxy : 127.0.0.1
  ProxyAutoConfigEnable : 0
  SOCKSEnable : 1
  SOCKSPort : 7897
  SOCKSProxy : 127.0.0.1
}`

	s := parseSCUtilProxy(out)
	if s.http == nil || s.http.String() != "http://127.0.0.1:7897" {
		t.Errorf("http proxy = %v, want http://127.0.0.1:7897", s.http)
	}
	if s.https == nil || s.https.String() != "http://127.0.0.1:7897" {
		t.Errorf("https proxy = %v, want http://127.0.0.1:7897", s.https)
	}
	if s.socks == nil || s.socks.String() != "socks5://127.0.0.1:7897" {
		t.Errorf("socks proxy = %v, want socks5://127.0.0.1:7897", s.socks)
	}
}

func TestParseSCUtilProxyDisabled(t *testing.T) {
	out := `<dictionary> {
  HTTPEnable : 0
  HTTPPort : 7897
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 0
  HTTPSPort : 7897
  HTTPSProxy : 127.0.0.1
  SOCKSEnable : 0
}`
	s := parseSCUtilProxy(out)
	if s.http != nil || s.https != nil || s.socks != nil {
		t.Fatalf("disabled proxy still present: %+v", s)
	}
}

func TestParseProxyURLRejectsBadPort(t *testing.T) {
	for _, raw := range []string{"127.0.0.1:notaport", "127.0.0.1:7890:extra"} {
		if got := parseProxyURL(raw, "http"); got != nil {
			t.Errorf("parseProxyURL(%q) = %v, want nil", raw, got)
		}
	}
	if got := parseProxyURL("proxy.local", "http"); got == nil || got.String() != "http://proxy.local" {
		t.Errorf("parseProxyURL without port = %v, want http://proxy.local", got)
	}
}
