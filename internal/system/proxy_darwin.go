//go:build darwin

package system

import (
	"context"
	"time"

	"aling-go/internal/proc"
)

// readSystemProxy reads the Wi-Fi/network proxy configured through macOS
// SystemConfiguration (what browsers use). Go's ProxyFromEnvironment only
// looks at env vars, which GUI apps launched from Finder do not inherit.
func readSystemProxy() *systemProxy {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	out, err := proc.CommandContext(ctx, "scutil", "--proxy").Output()
	if err != nil {
		return nil
	}
	return parseSCUtilProxy(string(out))
}
