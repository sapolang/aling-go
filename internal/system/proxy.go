package system

import (
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
)

// systemProxy holds the proxy URLs discovered from OS-level settings.
// Any field may be nil when that protocol has no configured proxy.
type systemProxy struct {
	http  *url.URL
	https *url.URL
	socks *url.URL
}

var (
	systemProxyOnce  sync.Once
	systemProxyCache *systemProxy
)

// cachedSystemProxy reads OS proxy settings at most once. Proxy settings do
// not change during a single update check, and scutil/reg queries are process
// spawns we do not want on every Range retry.
func cachedSystemProxy() *systemProxy {
	systemProxyOnce.Do(func() {
		systemProxyCache = readSystemProxy()
		if systemProxyCache == nil {
			systemProxyCache = &systemProxy{}
		}
	})
	return systemProxyCache
}

// ProxyFunc returns a Transport.Proxy function for HTTP clients that should
// follow the same proxy as the browser. Environment variables keep the
// highest priority (including their NO_PROXY semantics); when they are absent
// we fall back to the OS proxy settings.
func ProxyFunc() func(*http.Request) (*url.URL, error) {
	return func(req *http.Request) (*url.URL, error) {
		return proxyForRequest(req, cachedSystemProxy(), http.ProxyFromEnvironment)
	}
}

// SystemProxyURL returns the OS-configured proxy as a URL string, for tools
// that take an explicit --proxy flag (e.g. yt-dlp). Env vars are ignored here:
// those tools already read them themselves.
func SystemProxyURL() string {
	s := cachedSystemProxy()
	if s == nil {
		return ""
	}
	if s.https != nil {
		return s.https.String()
	}
	if s.http != nil {
		return s.http.String()
	}
	if s.socks != nil {
		return s.socks.String()
	}
	return ""
}

// proxyForRequest is separable from the platform probe so the selection
// rules can be unit-tested without touching the host's proxy configuration.
func proxyForRequest(req *http.Request, s *systemProxy, envProxy func(*http.Request) (*url.URL, error)) (*url.URL, error) {
	if req == nil || req.URL == nil {
		return nil, nil
	}
	if envProxy != nil {
		p, err := envProxy(req)
		if err != nil || p != nil {
			return p, err
		}
	}
	if s == nil || isLoopbackHost(req.URL.Hostname()) {
		return nil, nil
	}

	switch req.URL.Scheme {
	case "https":
		if s.https != nil {
			return s.https, nil
		}
	case "http":
		if s.http != nil {
			return s.http, nil
		}
	}
	return s.socks, nil
}

func isLoopbackHost(host string) bool {
	h := strings.Trim(host, "[]")
	return h == "localhost" || h == "127.0.0.1" || h == "::1" || strings.EqualFold(h, "ip6-localhost")
}

// parseProxyURL turns a host[:port] pair into a proxy URL. A missing port is
// left off so net/http applies the scheme's default port.
func parseProxyURL(hostport, scheme string) *url.URL {
	hostport = strings.TrimSpace(hostport)
	if hostport == "" {
		return nil
	}
	if strings.Contains(hostport, ":") {
		if _, port, err := net.SplitHostPort(hostport); err != nil || !isNumeric(port) {
			return nil
		}
	}
	return &url.URL{Scheme: scheme, Host: hostport}
}

func isNumeric(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// parseSCUtilProxy parses `scutil --proxy` output on macOS. Lines look like
// `HTTPProxy : 127.0.0.1`, with nested arrays printed as `ExceptionsList : <`.
func parseSCUtilProxy(out string) *systemProxy {
	values := make(map[string]string)
	for _, line := range strings.Split(out, "\n") {
		key, value, ok := strings.Cut(strings.TrimSpace(line), ":")
		if !ok {
			continue
		}
		values[strings.TrimSpace(key)] = strings.TrimSpace(value)
	}

	enabled := func(key string) bool {
		return values[key] == "1" || strings.EqualFold(values[key], "true")
	}
	withPort := func(hostKey, portKey, scheme string) *url.URL {
		host, port := values[hostKey], values[portKey]
		if host == "" || !isNumeric(port) {
			return nil
		}
		return parseProxyURL(net.JoinHostPort(host, port), scheme)
	}

	s := &systemProxy{}
	if enabled("HTTPEnable") {
		s.http = withPort("HTTPProxy", "HTTPPort", "http")
	}
	if enabled("HTTPSEnable") {
		s.https = withPort("HTTPSProxy", "HTTPSPort", "http")
	}
	if enabled("SOCKSEnable") {
		s.socks = withPort("SOCKSProxy", "SOCKSPort", "socks5")
	}
	return s
}
