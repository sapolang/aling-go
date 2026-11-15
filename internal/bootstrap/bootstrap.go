// Package bootstrap 负责应用启动编排：数据目录、数据库、服务注册、窗口与托盘。
// 根目录 main 仅因 //go:embed 不能引用父目录而保留嵌入变量，其余逻辑都在这里。
package bootstrap

import (
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"

	"aling-go/internal/config"
	"aling-go/internal/content"
	"aling-go/internal/core"
	"aling-go/internal/study"
	"aling-go/internal/system"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

const (
	// appDataDirName 与 bundle identifier 保持一致，卸载工具才能把数据目录
	// 正确关联到应用
	appDataDirName = "com.aling-go"
	// legacyAppDataDirName 是旧版本使用的数据目录，首次启动时整体改名迁移
	legacyAppDataDirName = "aling-go"
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
	store := config.New(dataDir, app.Logger)
	registerServices(app, dataDir, store, cfg.AppVersion)

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
	return resolveDataDir(configDir), nil
}

// resolveDataDir 返回应用数据目录。升级用户首次启动时把旧的 aling-go 目录
// 整体改名为 com.aling-go：同一卷内 rename 是原子操作，1.8G 数据可以瞬间完成，
// 不会出现半拷贝状态；迁移发生在 core.Init 打开数据库之前。
func resolveDataDir(configDir string) string {
	newDir := filepath.Join(configDir, appDataDirName)
	oldDir := filepath.Join(configDir, legacyAppDataDirName)

	if _, err := os.Stat(newDir); errors.Is(err, fs.ErrNotExist) {
		if _, err := os.Stat(oldDir); err == nil {
			if err := os.Rename(oldDir, newDir); err != nil {
				// 改名失败（如跨卷、权限不足）时继续使用旧目录，保证数据不丢
				return oldDir
			}
		}
	}
	return newDir
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

func registerServices(app *application.App, dataDir string, store *config.Store, version string) {
	librarySvc := content.NewLibraryService(app, dataDir)
	feedSvc := content.NewFeedService(app, dataDir, librarySvc, store)
	whisperSvc := content.NewWhisperService(app, dataDir, store)
	// YouTube 无字幕时复用本地 Whisper 转录音轨
	platformSvc := content.NewPlatformService(app, dataDir, feedSvc, whisperSvc)
	mediaSvc := content.NewMediaService(app, dataDir)
	// B 站 iframe 拿不到 Cookie，由 Go 侧带登录 Cookie 取流再本地代理
	mediaSvc.SetBilibiliAuth(feedSvc.GetBilibiliCookie, feedSvc.HTTPClient)
	// 粘贴频道链接时复用已有的链接转 RSS 能力
	mediaSvc.SetRSSConverter(platformSvc.ConvertToRSS)
	services := []application.Service{
		application.NewService(study.NewWordService(app)),
		application.NewService(study.NewDictService(app)),
		application.NewService(study.NewFavoriteService(app)),
		application.NewService(content.NewArticleService(app)),
		application.NewService(librarySvc),
		application.NewService(content.NewHistoryService(app)),
		application.NewService(feedSvc),
		application.NewService(platformSvc),
		application.NewService(mediaSvc),
		application.NewService(whisperSvc),
		application.NewService(system.NewPlatformService(app, version)),
		application.NewService(system.NewBackupService(app, dataDir)),
		application.NewService(system.NewUpdateService(app, version)),
		application.NewService(system.NewAIService(app, store)),
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
		StartState:       application.WindowStateMaximised,
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
