//go:build darwin

package tools

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func mustSymlink(t *testing.T, target, link string) {
	t.Helper()
	if err := os.Symlink(target, link); err != nil {
		t.Fatalf("创建软链失败: %v", err)
	}
}

func TestInspectLinkStates(t *testing.T) {
	dir := t.TempDir()

	missing := filepath.Join(dir, "missing")
	state, target, err := inspectLink(missing)
	if err != nil || state != linkMissing || target != "" {
		t.Fatalf("inspectLink(missing) = %v, %q, %v", state, target, err)
	}

	regular := filepath.Join(dir, "regular")
	if err := os.WriteFile(regular, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	state, _, err = inspectLink(regular)
	if err != nil || state != linkOccupied {
		t.Fatalf("inspectLink(regular) = %v, %v, want linkOccupied", state, err)
	}

	link := filepath.Join(dir, "link")
	mustSymlink(t, "/tmp/target", link)
	state, target, err = inspectLink(link)
	if err != nil || state != linkSymlink || target != "/tmp/target" {
		t.Fatalf("inspectLink(link) = %v, %q, %v", state, target, err)
	}
}

// install-cli 不能覆盖用户自己放在 /usr/local/bin/aling-go 的普通文件。
func TestInstallCLIRefusesToOverwriteNonSymlink(t *testing.T) {
	dir := t.TempDir()
	link := filepath.Join(dir, "aling-go")
	const original = "user binary"
	if err := os.WriteFile(link, []byte(original), 0755); err != nil {
		t.Fatal(err)
	}

	called := false
	_, err := installCLIAt(link, filepath.Join(dir, "real", "aling-go"), func(string) ([]byte, error) {
		called = true
		return nil, nil
	})
	if err == nil {
		t.Fatal("期望拒绝覆盖普通文件")
	}
	if called {
		t.Fatal("拒绝时不应执行提权命令")
	}
	got, readErr := os.ReadFile(link)
	if readErr != nil || string(got) != original {
		t.Fatalf("普通文件被修改: %q, %v", got, readErr)
	}
}

func TestInstallCLIAlreadyRegistered(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "real", "aling-go")
	link := filepath.Join(dir, "aling-go")
	mustSymlink(t, exe, link)

	called := false
	msg, err := installCLIAt(link, exe, func(string) ([]byte, error) {
		called = true
		return nil, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if called {
		t.Fatal("已注册时不应再次提权")
	}
	if !strings.Contains(msg, "已注册") {
		t.Fatalf("提示文本 = %q, want 已注册", msg)
	}
}

func TestInstallCLIReplacesExistingSymlink(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "real", "aling-go")
	link := filepath.Join(dir, "aling-go")
	mustSymlink(t, filepath.Join(dir, "old", "aling-go"), link)

	var script string
	msg, err := installCLIAt(link, exe, func(s string) ([]byte, error) {
		script = s
		if err := os.Remove(link); err != nil {
			return nil, err
		}
		return nil, os.Symlink(exe, link)
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(script, "ln -sfn") || !strings.Contains(script, shellQuote(exe)) {
		t.Fatalf("提权脚本不符合预期: %s", script)
	}
	if target, err := os.Readlink(link); err != nil || target != exe {
		t.Fatalf("软链目标 = %q, %v, want %q", target, err, exe)
	}
	if !strings.Contains(msg, "已注册") {
		t.Fatalf("提示文本 = %q, want 已注册", msg)
	}
}

func TestInstallCLIAdminError(t *testing.T) {
	dir := t.TempDir()
	_, err := installCLIAt(filepath.Join(dir, "aling-go"), filepath.Join(dir, "exe"), func(string) ([]byte, error) {
		return []byte("User canceled."), errors.New("exit status 1")
	})
	if err == nil || !strings.Contains(err.Error(), "User canceled.") {
		t.Fatalf("错误 = %v, want 包含 osascript 输出", err)
	}
}

// uninstall-cli 只删除软链，不能删除用户自己放的普通文件。
func TestUninstallCLIRefusesNonSymlink(t *testing.T) {
	dir := t.TempDir()
	link := filepath.Join(dir, "aling-go")
	if err := os.WriteFile(link, []byte("user binary"), 0755); err != nil {
		t.Fatal(err)
	}

	called := false
	_, err := uninstallCLIAt(link, func(string) ([]byte, error) {
		called = true
		return nil, nil
	})
	if err == nil {
		t.Fatal("期望拒绝删除普通文件")
	}
	if called {
		t.Fatal("拒绝时不应执行提权命令")
	}
	if _, err := os.Stat(link); err != nil {
		t.Fatalf("普通文件被删除: %v", err)
	}
}

func TestUninstallCLIRemovesSymlink(t *testing.T) {
	dir := t.TempDir()
	link := filepath.Join(dir, "aling-go")
	mustSymlink(t, filepath.Join(dir, "target"), link)

	var script string
	msg, err := uninstallCLIAt(link, func(s string) ([]byte, error) {
		script = s
		return nil, os.Remove(link)
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(script, "rm -f") {
		t.Fatalf("提权脚本不符合预期: %s", script)
	}
	if _, err := os.Lstat(link); !os.IsNotExist(err) {
		t.Fatalf("软链未删除: %v", err)
	}
	if !strings.Contains(msg, "已移除") {
		t.Fatalf("提示文本 = %q, want 已移除", msg)
	}
}

func TestUninstallCLIMissing(t *testing.T) {
	called := false
	msg, err := uninstallCLIAt(filepath.Join(t.TempDir(), "aling-go"), func(string) ([]byte, error) {
		called = true
		return nil, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if called {
		t.Fatal("未注册时不应执行提权命令")
	}
	if !strings.Contains(msg, "尚未注册") {
		t.Fatalf("提示文本 = %q, want 尚未注册", msg)
	}
}
