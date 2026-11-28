//go:build darwin

package tools

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"aling-go/internal/proc"
)

const darwinLinkPath = "/usr/local/bin/aling-go"

// linkState 描述注册路径的现状。
type linkState int

const (
	linkMissing  linkState = iota // 不存在
	linkSymlink                   // 是软链
	linkOccupied                  // 存在但不是软链
)

// inspectLink 检查 path 的现状。linkOccupied 表示存在但不是软链，
// 调用方必须拒绝覆盖或删除，避免误伤用户自己放的文件。
func inspectLink(path string) (linkState, string, error) {
	info, err := os.Lstat(path)
	if errors.Is(err, fs.ErrNotExist) {
		return linkMissing, "", nil
	}
	if err != nil {
		return linkOccupied, "", err
	}
	if info.Mode()&os.ModeSymlink == 0 {
		return linkOccupied, "", nil
	}
	target, err := os.Readlink(path)
	if err != nil {
		return linkOccupied, "", err
	}
	return linkSymlink, target, nil
}

func installCLI() (string, error) {
	exe, err := realExecutable()
	if err != nil {
		return "", fmt.Errorf("获取可执行文件路径失败: %w", err)
	}
	return installCLIAt(darwinLinkPath, exe, runAdminScript)
}

// installCLIAt 在 linkPath 创建指向 exe 的软链。
// 普通文件/目录一律拒绝覆盖；已指向 exe 时直接返回，避免每次都弹授权框。
func installCLIAt(linkPath, exe string, runAdmin func(string) ([]byte, error)) (string, error) {
	state, current, err := inspectLink(linkPath)
	if err != nil {
		return "", fmt.Errorf("检查 %s 失败: %w", linkPath, err)
	}
	if state == linkOccupied {
		return "", fmt.Errorf("%s 已存在且不是软链，未覆盖；请先手动移除后再注册", linkPath)
	}
	if state == linkSymlink && current == exe {
		return fmt.Sprintf("aling-go 已注册：%s -> %s", linkPath, exe), nil
	}

	// 用管理员权限创建软链；/usr/local/bin 在 macOS 上通常需要提权。
	cmd := fmt.Sprintf("mkdir -p %s && ln -sfn %s %s",
		shellQuote(filepath.Dir(linkPath)), shellQuote(exe), shellQuote(linkPath))
	script := "do shell script " + appleScriptQuote(cmd) + " with administrator privileges"
	out, err := runAdmin(script)
	if err != nil {
		return "", fmt.Errorf("注册失败（需要管理员授权）: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return fmt.Sprintf("已注册 aling-go 命令：%s -> %s\n现在可以在任意目录运行 aling-go tool ...", linkPath, exe), nil
}

func uninstallCLI() (string, error) {
	return uninstallCLIAt(darwinLinkPath, runAdminScript)
}

// uninstallCLIAt 移除 installCLIAt 创建的软链。普通文件/目录一律不删。
func uninstallCLIAt(linkPath string, runAdmin func(string) ([]byte, error)) (string, error) {
	state, _, err := inspectLink(linkPath)
	if err != nil {
		return "", fmt.Errorf("检查 %s 失败: %w", linkPath, err)
	}
	switch state {
	case linkMissing:
		return "aling-go 命令尚未注册", nil
	case linkOccupied:
		return "", fmt.Errorf("%s 已存在但不是软链，未删除", linkPath)
	}

	script := "do shell script " + appleScriptQuote("rm -f "+shellQuote(linkPath)) + " with administrator privileges"
	out, err := runAdmin(script)
	if err != nil {
		return "", fmt.Errorf("卸载失败（需要管理员授权）: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return fmt.Sprintf("已移除 %s", linkPath), nil
}

func runAdminScript(script string) ([]byte, error) {
	return proc.Command("osascript", "-e", script).CombinedOutput()
}
