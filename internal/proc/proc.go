// Package proc 统一创建子进程。
//
// 应用以 GUI 子系统构建（Windows 上 -H windowsgui），启动控制台程序时系统会
// 默认分配一个新的命令行窗口；ffmpeg / whisper / yt-dlp 又都是在后台跑的工具，
// 所以所有子进程都应通过本包创建，由平台实现处理窗口差异。
package proc

import (
	"context"
	"os/exec"
)

// Command 等价于 exec.Command，并隐藏子进程的控制台窗口（仅 Windows 需要）。
func Command(name string, args ...string) *exec.Cmd {
	cmd := exec.Command(name, args...)
	hideWindow(cmd)
	return cmd
}

// CommandContext 等价于 exec.CommandContext，并隐藏子进程的控制台窗口（仅 Windows 需要）。
func CommandContext(ctx context.Context, name string, args ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, name, args...)
	hideWindow(cmd)
	return cmd
}
