//go:build !darwin && !windows

package system

// readSystemProxy has no system-wide proxy source on other platforms;
// ProxyFromEnvironment (http_proxy/https_proxy) is the conventional mechanism.
func readSystemProxy() *systemProxy { return nil }
