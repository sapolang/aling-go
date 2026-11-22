//go:build !windows

package proc

import "os/exec"

// hideWindow 在非 Windows 平台无需处理：GUI 进程启动子进程不会分配额外的窗口。
func hideWindow(*exec.Cmd) {}
