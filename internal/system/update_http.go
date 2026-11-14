package system

import (
	"context"
	"net"
	"net/http"
	"time"
)

// newUpdateHTTPClient returns a client tuned for large asset downloads.
// Unlike Wails' default updater client (30s total timeout, which aborts the
// body read mid-stream), it has no overall deadline; idleTimeout is applied
// per read so a truly stalled connection still fails.
func newUpdateHTTPClient(idleTimeout time.Duration) *http.Client {
	dialer := &net.Dialer{Timeout: 15 * time.Second, KeepAlive: 30 * time.Second}

	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
		conn, err := dialer.DialContext(ctx, network, addr)
		if err != nil {
			return nil, err
		}
		return &idleTimeoutConn{Conn: conn, timeout: idleTimeout}, nil
	}
	transport.TLSHandshakeTimeout = 15 * time.Second
	transport.ResponseHeaderTimeout = 30 * time.Second
	transport.IdleConnTimeout = 90 * time.Second
	transport.ExpectContinueTimeout = time.Second

	return &http.Client{Transport: transport}
}

// idleTimeoutConn refreshes the read/write deadline on every operation, which
// turns a fixed total timeout into an inactivity timeout.
type idleTimeoutConn struct {
	net.Conn
	timeout time.Duration
}

func (c *idleTimeoutConn) Read(p []byte) (int, error) {
	if err := c.SetReadDeadline(time.Now().Add(c.timeout)); err != nil {
		return 0, err
	}
	return c.Conn.Read(p)
}

func (c *idleTimeoutConn) Write(p []byte) (int, error) {
	if err := c.SetWriteDeadline(time.Now().Add(c.timeout)); err != nil {
		return 0, err
	}
	return c.Conn.Write(p)
}
