package tools

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"

	"aling-go/internal/proc"
)

// Tool 是暴露给命令行的内置工具。Args 以外的参数原样透传给底层可执行文件。
type Tool struct {
	Name        string
	Description string
	Find        func(dataDir string) string
}

// Catalog 定义可调用的内置工具，顺序即 tool list 的展示顺序。
var Catalog = []Tool{
	{
		Name:        "ffmpeg",
		Description: "音视频转码与音频抽取；参数原样透传 ffmpeg",
		Find:        FindFFmpeg,
	},
	{
		Name:        "yt-dlp",
		Description: "视频与字幕下载；参数原样透传 yt-dlp",
		Find:        FindYtDlp,
	},
	{
		Name:        "whisper",
		Description: "本地语音转录；参数是 whisper.cpp 的 whisper-cli 参数，需自行传 -m 模型文件",
		Find:        FindWhisper,
	},
}

// Lookup 按名称返回工具，不存在返回 false。
func Lookup(name string) (Tool, bool) {
	for _, tool := range Catalog {
		if tool.Name == name {
			return tool, true
		}
	}
	return Tool{}, false
}

// Run 执行 tool 子命令。args 不含 "tool" 本身，返回进程退出码。
// 用法：tool list；tool <名称> <参数...>。
func Run(dataDir string, args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		printUsage(stderr)
		return 2
	}

	switch args[0] {
	case "list", "--list", "-l":
		printList(dataDir, stdout)
		return 0
	case "-h", "--help", "help":
		printUsage(stdout)
		return 0
	}

	tool, ok := Lookup(args[0])
	if !ok {
		_, _ = fmt.Fprintf(stderr, "未知工具 %q，可用工具见 tool list\n", args[0])
		return 2
	}

	bin := tool.Find(dataDir)
	if bin == "" {
		_, _ = fmt.Fprintf(stderr, "未找到 %s，发布版请重新安装应用，开发环境请运行 make sidecar\n", tool.Name)
		return 1
	}
	return execute(bin, args[1:], tool.Name, stdout, stderr)
}

// execute 运行底层工具，透传输出流并把子进程退出码原样返回。
func execute(bin string, args []string, name string, stdout, stderr io.Writer) int {
	cmd := proc.Command(bin, args...)
	cmd.Stdin = os.Stdin
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	if err := cmd.Run(); err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			return exitErr.ExitCode()
		}
		_, _ = fmt.Fprintf(stderr, "启动 %s 失败: %v\n", name, err)
		return 1
	}
	return 0
}

func printUsage(w io.Writer) {
	_, _ = fmt.Fprintln(w, "用法:")
	_, _ = fmt.Fprintln(w, "  aling-go tool list              列出内置工具与路径")
	_, _ = fmt.Fprintln(w, "  aling-go tool <名称> <参数...>  原样透传参数调用内置工具")
	_, _ = fmt.Fprintln(w, "  aling-go install-cli            把 aling-go 注册到 PATH")
	_, _ = fmt.Fprintln(w, "  aling-go uninstall-cli         撤销注册")
}

func printList(dataDir string, w io.Writer) {
	_, _ = fmt.Fprintln(w, "内置工具:")
	for _, tool := range Catalog {
		path := tool.Find(dataDir)
		status := "未找到"
		if path != "" {
			status = path
		}
		_, _ = fmt.Fprintf(w, "  %-10s %s\n", tool.Name, tool.Description)
		_, _ = fmt.Fprintf(w, "  %-10s 路径: %s\n", "", status)
	}
	_, _ = fmt.Fprintln(w, "参数原样透传，支持重定向、管道与退出码判断。")
}
