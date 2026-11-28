package tools

import (
	"os"
	"path/filepath"
	"testing"
)

// 通过软链调用时，ExecutableDir 必须返回真实二进制所在目录，
// 否则注册 aling-go 命令后 bundle Resources 里的 sidecar 会找不到。
func TestExecutableDirResolvesSymlink(t *testing.T) {
	dir := t.TempDir()
	realDir := filepath.Join(dir, "Contents", "MacOS")
	if err := os.MkdirAll(realDir, 0755); err != nil {
		t.Fatal(err)
	}
	realExe := filepath.Join(realDir, "aling-go")
	if err := os.WriteFile(realExe, []byte("fake"), 0755); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, "aling-go-link")
	if err := os.Symlink(realExe, link); err != nil {
		t.Fatal(err)
	}

	got := executableDirFrom(link)
	wantReal, err := filepath.EvalSymlinks(realDir)
	if err != nil {
		t.Fatal(err)
	}
	if got != wantReal {
		t.Fatalf("executableDirFrom(link) = %q, want %q", got, wantReal)
	}
}
