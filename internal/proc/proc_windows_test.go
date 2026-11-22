//go:build windows

package proc

import (
	"syscall"
	"testing"
)

// Windows 上 GUI 应用启动控制台子进程会新分配命令行窗口，
// proc.Command 必须带上隐藏窗口与 CREATE_NO_WINDOW 两个标志。
func TestCommandHidesConsoleWindow(t *testing.T) {
	cmd := Command("cmd.exe", "/c", "exit")
	if cmd.SysProcAttr == nil {
		t.Fatal("SysProcAttr 为空，子进程会弹出命令行窗口")
	}
	if !cmd.SysProcAttr.HideWindow {
		t.Fatal("HideWindow 未设置")
	}
	if cmd.SysProcAttr.CreationFlags&createNoWindow == 0 {
		t.Fatalf("CreationFlags 缺少 CREATE_NO_WINDOW: %#x", cmd.SysProcAttr.CreationFlags)
	}
}

// 调用方自定义的 CreationFlags（例如独立进程组）不能被覆盖。
func TestCommandKeepsExistingCreationFlags(t *testing.T) {
	const detachedProcess = 0x00000008
	cmd := Command("cmd.exe")
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: detachedProcess}
	hideWindow(cmd)
	if cmd.SysProcAttr.CreationFlags&detachedProcess == 0 {
		t.Fatalf("原有 CreationFlags 被覆盖: %#x", cmd.SysProcAttr.CreationFlags)
	}
	if cmd.SysProcAttr.CreationFlags&createNoWindow == 0 {
		t.Fatal("CREATE_NO_WINDOW 未追加")
	}
}
