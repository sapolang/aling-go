package main

import (
	"embed"
	"fmt"
	"os"

	"aling-go/internal/bootstrap"
	"aling-go/internal/tools"
)

// 以下两个 embed 变量必须留在 package main：go:embed 不能引用父目录，
// 因此根包是唯一能嵌入 frontend/dist 与 build/ 资源的位置。

//go:embed frontend/dist
var assets embed.FS

//go:embed build/appicon.png
var trayIcon []byte

// appVersion 由构建脚本通过 -ldflags "-X main.appVersion=..." 注入，
// 本地未注入时为 dev。锚点是包路径 + 变量名，变量必须留在 package main。
var appVersion = "dev"

func main() {
	// CLI 子命令直接运行，不启动 Wails 与数据库。
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "tool":
			dataDir, err := bootstrap.DataDir()
			if err != nil {
				fmt.Fprintf(os.Stderr, "get config dir: %v\n", err)
				os.Exit(1)
			}
			os.Exit(tools.Run(dataDir, os.Args[2:], os.Stdout, os.Stderr))
		case "install-cli":
			msg, err := tools.InstallCLI()
			if err != nil {
				fmt.Fprintf(os.Stderr, "%v\n", err)
				os.Exit(1)
			}
			_, _ = fmt.Fprintln(os.Stdout, msg)
			return
		case "uninstall-cli":
			msg, err := tools.UninstallCLI()
			if err != nil {
				fmt.Fprintf(os.Stderr, "%v\n", err)
				os.Exit(1)
			}
			_, _ = fmt.Fprintln(os.Stdout, msg)
			return
		}
	}

	bootstrap.Run(bootstrap.Config{
		Assets:     assets,
		TrayIcon:   trayIcon,
		AppVersion: appVersion,
	})
}
