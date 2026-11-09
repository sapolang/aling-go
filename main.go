package main

import (
	"embed"
	"fmt"
	"os"
	"path/filepath"

	"aling-go/internal/dict"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

//go:embed frontend/dist
var assets embed.FS

//go:embed build/appicon.png
var trayIcon []byte

func main() {
	configDir, err := os.UserConfigDir()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error getting config dir: %v\n", err)
		os.Exit(1)
	}
	dataDir := filepath.Join(configDir, "aling-go")

	if err := initDB(dataDir); err != nil {
		fmt.Fprintf(os.Stderr, "DB init failed: %v\n", err)
		os.Exit(1)
	}
	if err := openArticleDB(dataDir); err != nil {
		fmt.Fprintf(os.Stderr, "Article DB init failed: %v\n", err)
		os.Exit(1)
	}
	if err := dict.OpenDictDB(dataDir, db); err != nil {
		fmt.Fprintf(os.Stderr, "Dict DB init failed: %v\n", err)
		os.Exit(1)
	}
	migrateIfNeeded(dataDir)

	wailsApp := application.New(application.Options{
		Name: "语练",
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: false,
		},
	})

	wailsApp.RegisterService(application.NewService(NewWordService(wailsApp)))
	wailsApp.RegisterService(application.NewService(NewArticleService(wailsApp)))
	wailsApp.RegisterService(application.NewService(NewDictService(wailsApp)))
	wailsApp.RegisterService(application.NewService(NewLibraryService(wailsApp, dataDir)))
	wailsApp.RegisterService(application.NewService(NewMediaService(wailsApp, dataDir)))
	wailsApp.RegisterService(application.NewService(NewWhisperService(wailsApp, dataDir)))
	wailsApp.RegisterService(application.NewService(NewPlatformService(wailsApp)))
	wailsApp.RegisterService(application.NewService(NewBackupService(wailsApp, dataDir)))
	wailsApp.RegisterService(application.NewService(NewAIService(wailsApp, dataDir)))
	wailsApp.RegisterService(application.NewService(NewFavoriteService(wailsApp)))

	win := wailsApp.Window.NewWithOptions(application.WebviewWindowOptions{
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

	win.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
		win.Hide()
		event.Cancel()
	})

	tray := wailsApp.SystemTray.New()
	if icon, err := trayTemplateIcon(trayIcon); err == nil {
		tray.SetTemplateIcon(icon)
	} else {
		fmt.Fprintf(os.Stderr, "tray icon: %v\n", err)
		tray.SetIcon(trayIcon)
	}
	tray.SetTooltip("语练")

	trayMenu := wailsApp.NewMenu()
	trayMenu.Add("显示窗口").OnClick(func(*application.Context) {
		win.Show()
		win.Focus()
	})
	trayMenu.Add("隐藏窗口").OnClick(func(*application.Context) {
		win.Hide()
	})
	trayMenu.AddSeparator()
	trayMenu.Add("退出").OnClick(func(*application.Context) {
		wailsApp.Quit()
	})
	tray.SetMenu(trayMenu)

	if err := wailsApp.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	if db != nil {
		db.Close()
	}
	if articleDB != nil {
		articleDB.Close()
	}
}
