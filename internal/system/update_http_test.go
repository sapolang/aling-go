package system

import (
	"net"
	"testing"
	"time"
)

func TestNewUpdateHTTPClientHasNoOverallTimeout(t *testing.T) {
	client := newUpdateHTTPClient(time.Second)
	if client.Timeout != 0 {
		t.Fatalf("client.Timeout = %v, want 0 (no overall timeout)", client.Timeout)
	}
	if client.Transport == nil {
		t.Fatal("client.Transport is nil")
	}
}

func TestIdleTimeoutConnReadDeadline(t *testing.T) {
	c1, c2 := net.Pipe()
	defer c1.Close()
	defer c2.Close()

	conn := &idleTimeoutConn{Conn: c1, timeout: 100 * time.Millisecond}
	start := time.Now()
	_, err := conn.Read(make([]byte, 1))
	if err == nil {
		t.Fatal("expected read to time out")
	}
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Fatalf("read blocked for %v, want ~100ms", elapsed)
	}
}
