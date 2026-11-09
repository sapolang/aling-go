package main

import (
	"embed"

	"aling-go/internal/bootstrap"
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
	bootstrap.Run(bootstrap.Config{
		Assets:     assets,
		TrayIcon:   trayIcon,
		AppVersion: appVersion,
	})
}
