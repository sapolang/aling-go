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

	win := wailsApp.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "语练",
		Width:            1200,
		Height:           720,
		MinWidth:         800,
		MinHeight:        500,
		BackgroundColour: application.RGBA{Red: 27, Green: 38, Blue: 54, Alpha: 255},
	})

	win.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
		win.Hide()
		event.Cancel()
	})

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
