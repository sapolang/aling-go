//go:build windows

package system

import (
	"context"
	"strings"
	"time"

	"aling-go/internal/proc"
)

const internetSettingsKey = `HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`

// readSystemProxy reads the WinINET proxy configured in the user registry,
// the same setting browsers follow.
func readSystemProxy() *systemProxy {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	enableOut, err := proc.CommandContext(ctx, "reg", "query", internetSettingsKey, "/v", "ProxyEnable").Output()
	if err != nil || !parseWindowsProxyEnable(string(enableOut)) {
		return nil
	}
	serverOut, err := proc.CommandContext(ctx, "reg", "query", internetSettingsKey, "/v", "ProxyServer").Output()
	if err != nil {
		return nil
	}
	return parseWindowsProxyServer(string(serverOut))
}

// parseWindowsProxyEnable parses `reg query ... /v ProxyEnable` output.
func parseWindowsProxyEnable(out string) bool {
	for _, line := range strings.Split(out, "\n") {
		if strings.Contains(line, "ProxyEnable") && strings.Contains(line, "0x1") {
			return true
		}
	}
	return false
}

// parseWindowsProxyServer parses `reg query ... /v ProxyServer` output. The
// value is either `host:port` or a per-scheme list like
// `http=host:port;https=host:port`.
func parseWindowsProxyServer(out string) *systemProxy {
	var value string
	for _, line := range strings.Split(out, "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 3 && strings.EqualFold(fields[0], "ProxyServer") {
			value = fields[len(fields)-1]
			break
		}
	}
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}

	if strings.Contains(value, "=") {
		s := &systemProxy{}
		for _, entry := range strings.Split(value, ";") {
			scheme, hostport, ok := strings.Cut(entry, "=")
			if !ok {
				continue
			}
			switch strings.ToLower(strings.TrimSpace(scheme)) {
			case "http":
				s.http = parseProxyURL(hostport, "http")
			case "https":
				s.https = parseProxyURL(hostport, "http")
			case "socks":
				s.socks = parseProxyURL(hostport, "socks5")
			}
		}
		return s
	}

	proxy := parseProxyURL(value, "http")
	if proxy == nil {
		return nil
	}
	return &systemProxy{http: proxy, https: proxy}
}
