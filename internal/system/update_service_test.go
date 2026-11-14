package system

import (
	"testing"
	"time"
)

func TestNewUpdateProviderWrapsGitHub(t *testing.T) {
	p, err := newUpdateProvider(newUpdateHTTPClient(time.Second))
	if err != nil {
		t.Fatalf("newUpdateProvider() error = %v", err)
	}
	if p.Name() != "github" {
		t.Fatalf("Name() = %q, want github", p.Name())
	}
	if _, ok := p.(*resilientProvider); !ok {
		t.Fatalf("provider type = %T, want *resilientProvider", p)
	}
}
