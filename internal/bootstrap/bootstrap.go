// Package bootstrap 负责应用启动编排：数据目录、数据库、服务注册、窗口与托盘。
// 根目录 main 仅因 //go:embed 不能引用父目录而保留嵌入变量，其余逻辑都在这里。
package bootstrap

import (
	"embed"
	"fmt"
	"os"
	"path/filepath"

	"aling-go/internal/content"
	"aling-go/internal/core"
	"aling-go/internal/study"
	"aling-go/internal/system"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// Config 是启动应用所需的外部输入（来自根包的 embed 与 ldflags）。
type Config struct {
	Assets     embed.FS // 前端构建产物 frontend/dist
	TrayIcon   []byte   // build/appicon.png
	AppVersion string   // ldflags -X main.appVersion 注入，未注入时为 dev
}

// Run 完成全部启动步骤并阻塞到应用退出。
func Run(cfg Config) {
	dataDir, err := appDataDir()
	if err != nil {
		fatal("get config dir: %v", err)
	}

	if err := core.Init(dataDir); err != nil {
		fatal("app init: %v", err)
	}
	defer core.Close()

	app := application.New(newAppOptions(cfg.Assets))
	registerServices(app, dataDir, cfg.AppVersion)

	win := newMainWindow(app)
	setupTray(app, win, cfg.TrayIcon)

	if err := app.Run(); err != nil {
		fatal("run: %v", err)
	}
}

func appDataDir() (string, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(configDir, "aling-go"), nil
}

func fatal(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}

func newAppOptions(assets embed.FS) application.Options {
	return application.Options{
		Name: "语练",
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: false,
		},
	}
}

func registerServices(app *application.App, dataDir, version string) {
	librarySvc := content.NewLibraryService(app, dataDir)
	feedSvc := content.NewFeedService(app, dataDir, librarySvc)
	whisperSvc := content.NewWhisperService(app, dataDir)
	// YouTube 无字幕时复用本地 Whisper 转录音轨
	platformSvc := content.NewPlatformService(app, dataDir, feedSvc, whisperSvc)
	mediaSvc := content.NewMediaService(app, dataDir)
	// B 站 iframe 拿不到 Cookie，由 Go 侧带登录 Cookie 取流再本地代理
	mediaSvc.SetBilibiliAuth(feedSvc.GetBilibiliCookie, feedSvc.HTTPClient)
	services := []application.Service{
		application.NewService(study.NewWordService(app)),
		application.NewService(study.NewDictService(app)),
		application.NewService(study.NewFavoriteService(app)),
		application.NewService(content.NewArticleService(app)),
		application.NewService(librarySvc),
		application.NewService(feedSvc),
		application.NewService(platformSvc),
		application.NewService(mediaSvc),
		application.NewService(whisperSvc),
		application.NewService(system.NewPlatformService(app, version)),
		application.NewService(system.NewBackupService(app, dataDir)),
		application.NewService(system.NewUpdateService(app, version)),
		application.NewService(system.NewAIService(app, dataDir)),
	}
	for _, svc := range services {
		app.RegisterService(svc)
	}
}

func newMainWindow(app *application.App) *application.WebviewWindow {
	win := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "语练",
		Width:            1200,
		Height:           720,
		MinWidth:         800,
		MinHeight:        500,
		EnableFileDrop:   true,
		BackgroundColour: application.RGBA{Red: 27, Green: 38, Blue: 54, Alpha: 255},
		Mac: application.MacWindow{
			WebviewPreferences: application.MacWebviewPreferences{
				// WKWebView 默认要求用户手势才能播放有声媒体，打开文件后的
				// 自动播放（canplay 回调里的 play()）会被静默拒绝
				EnableAutoplayWithoutUserAction: application.Enabled,
			},
		},
	})

	// 关闭窗口时仅隐藏到托盘，不退出应用
	win.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
		win.Hide()
		event.Cancel()
	})

	return win
}

func setupTray(app *application.App, win *application.WebviewWindow, iconSrc []byte) {
	tray := app.SystemTray.New()
	if icon, err := system.TrayTemplateIcon(iconSrc); err == nil {
		tray.SetTemplateIcon(icon)
	} else {
		fmt.Fprintf(os.Stderr, "tray icon: %v\n", err)
		tray.SetIcon(iconSrc)
	}
	tray.SetTooltip("语练")

	menu := app.NewMenu()
	menu.Add("显示窗口").OnClick(func(*application.Context) {
		win.Show()
		win.Focus()
	})
	menu.Add("隐藏窗口").OnClick(func(*application.Context) {
		win.Hide()
	})
	menu.AddSeparator()
	menu.Add("退出").OnClick(func(*application.Context) {
		app.Quit()
	})
	tray.SetMenu(menu)
}
