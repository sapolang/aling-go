//go:build !darwin

package tools

import "fmt"

func installCLI() (string, error) {
	return "", fmt.Errorf("当前平台暂不支持自动注册 aling-go 命令（目前仅支持 macOS）")
}

func uninstallCLI() (string, error) {
	return "", fmt.Errorf("当前平台暂不支持自动卸载（目前仅支持 macOS）")
}
