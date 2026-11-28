//go:build darwin

package tools

import (
	"fmt"
	"os"
	"strings"

	"aling-go/internal/proc"
)

const darwinLinkPath = "/usr/local/bin/aling-go"

func installCLI() (string, error) {
	exe, err := realExecutable()
	if err != nil {
		return "", fmt.Errorf("获取可执行文件路径失败: %w", err)
	}

	// 已注册且指向当前二进制时直接返回，避免每次都弹授权框。
	if target, err := os.Readlink(darwinLinkPath); err == nil && target == exe {
		return fmt.Sprintf("aling-go 已注册：%s -> %s", darwinLinkPath, exe), nil
	}

	// 用管理员权限创建软链；/usr/local/bin 在 macOS 上通常需要提权。
	cmd := fmt.Sprintf("mkdir -p /usr/local/bin && ln -sfn %s %s", shellQuote(exe), shellQuote(darwinLinkPath))
	script := "do shell script " + appleScriptQuote(cmd) + " with administrator privileges"
	out, err := proc.Command("osascript", "-e", script).CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("注册失败（需要管理员授权）: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return fmt.Sprintf("已注册 aling-go 命令：%s -> %s\n现在可以在任意目录运行 aling-go tool ...", darwinLinkPath, exe), nil
}

func uninstallCLI() (string, error) {
	if _, err := os.Lstat(darwinLinkPath); os.IsNotExist(err) {
		return "aling-go 命令尚未注册", nil
	} else if err != nil {
		return "", fmt.Errorf("检查 %s 失败: %w", darwinLinkPath, err)
	}

	script := "do shell script " + appleScriptQuote("rm -f "+shellQuote(darwinLinkPath)) + " with administrator privileges"
	out, err := proc.Command("osascript", "-e", script).CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("卸载失败（需要管理员授权）: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return fmt.Sprintf("已移除 %s", darwinLinkPath), nil
}
