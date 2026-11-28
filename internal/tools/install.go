package tools

import (
	"os"
	"path/filepath"
	"strings"
)

// InstallCLI 把 aling-go 命令注册到当前用户的 PATH。
// 返回给用户看的说明文本，失败时返回错误。
func InstallCLI() (string, error) {
	return installCLI()
}

// UninstallCLI 撤销 InstallCLI 的注册。
func UninstallCLI() (string, error) {
	return uninstallCLI()
}

// realExecutable 返回当前进程真实的可执行文件路径。
// 通过 PATH 软链调用时 os.Executable 返回的是软链路径，注册时必须写入真实目标。
func realExecutable() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	if real, err := filepath.EvalSymlinks(exe); err == nil {
		return real, nil
	}
	return exe, nil
}

// shellQuote 把参数包成 shell 单引号字符串，供 osascript 的 do shell script 使用。
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// appleScriptQuote 把命令包成 AppleScript 字符串。
func appleScriptQuote(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `"`, `\"`)
	return `"` + s + `"`
}
