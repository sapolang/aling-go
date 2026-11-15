package bootstrap

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveDataDirMigratesLegacyDir(t *testing.T) {
	root := t.TempDir()
	oldDir := filepath.Join(root, legacyAppDataDirName)
	if err := os.MkdirAll(oldDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(oldDir, "userData.db"), []byte("data"), 0o644); err != nil {
		t.Fatal(err)
	}

	got := resolveDataDir(root)

	want := filepath.Join(root, appDataDirName)
	if got != want {
		t.Fatalf("数据目录 = %q, want %q", got, want)
	}
	data, err := os.ReadFile(filepath.Join(got, "userData.db"))
	if err != nil || string(data) != "data" {
		t.Fatalf("迁移后数据不完整: %v", err)
	}
	if _, err := os.Stat(oldDir); !os.IsNotExist(err) {
		t.Fatal("旧目录应已被改名")
	}
}

func TestResolveDataDirKeepsExistingNewDir(t *testing.T) {
	root := t.TempDir()
	newDir := filepath.Join(root, appDataDirName)
	oldDir := filepath.Join(root, legacyAppDataDirName)
	for _, dir := range []string{newDir, oldDir} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}

	if got := resolveDataDir(root); got != newDir {
		t.Fatalf("数据目录 = %q, want %q", got, newDir)
	}
	// 新目录已存在说明已经启动过，此时不应再动旧目录
	if _, err := os.Stat(oldDir); err != nil {
		t.Fatalf("旧目录不应被处理: %v", err)
	}
}

func TestResolveDataDirWithoutLegacyDir(t *testing.T) {
	root := t.TempDir()
	if got := resolveDataDir(root); got != filepath.Join(root, appDataDirName) {
		t.Fatalf("数据目录 = %q", got)
	}
}
