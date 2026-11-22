//go:build !windows

package proc

import (
	"context"
	"strings"
	"testing"
)

// macOS/Linux 上 hideWindow 必须是空操作：不能给子进程塞任何 SysProcAttr，
// 否则会影响现有的 open / ffmpeg / whisper 调用行为。
func TestCommandLeavesSysProcAttrUnset(t *testing.T) {
	if cmd := Command("/bin/echo", "hi"); cmd.SysProcAttr != nil {
		t.Fatalf("Command 不应设置 SysProcAttr: %+v", cmd.SysProcAttr)
	}
	if cmd := CommandContext(context.Background(), "/bin/echo", "hi"); cmd.SysProcAttr != nil {
		t.Fatalf("CommandContext 不应设置 SysProcAttr: %+v", cmd.SysProcAttr)
	}
}

// 包装后仍要能正常执行并透传参数。
func TestCommandRunsWithArgs(t *testing.T) {
	out, err := Command("/bin/echo", "aling", "go").Output()
	if err != nil {
		t.Fatalf("执行失败: %v", err)
	}
	if got := strings.TrimSpace(string(out)); got != "aling go" {
		t.Fatalf("输出 = %q, want %q", got, "aling go")
	}
}

func TestCommandContextRuns(t *testing.T) {
	out, err := CommandContext(context.Background(), "/bin/echo", "ctx").Output()
	if err != nil {
		t.Fatalf("执行失败: %v", err)
	}
	if got := strings.TrimSpace(string(out)); got != "ctx" {
		t.Fatalf("输出 = %q, want %q", got, "ctx")
	}
}
