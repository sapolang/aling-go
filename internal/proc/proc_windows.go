//go:build windows

package proc

import (
	"os/exec"
	"syscall"
)

// createNoWindow 对应 CreateProcess 的 CREATE_NO_WINDOW：完全不创建控制台，
// 避免控制台窗口一闪而过。
const createNoWindow = 0x08000000

// hideWindow 让 GUI 构建的应用启动控制台程序时不弹出命令行窗口。
// HideWindow 与 CREATE_NO_WINDOW 同时设置更稳妥：前者隐藏窗口，后者要求系统
// 干脆不分配控制台，不同 Windows 版本对两者的处理略有差异。
func hideWindow(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.HideWindow = true
	cmd.SysProcAttr.CreationFlags |= createNoWindow
}
