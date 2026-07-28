package main

import (
	"context"
	"os"
	"os/exec"
	goRuntime "runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type PlatformService struct {
	app *application.App
}

func NewPlatformService(app *application.App) *PlatformService {
	return &PlatformService{app: app}
}

func (s *PlatformService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error { return nil }
func (s *PlatformService) ServiceShutdown() error { return nil }

// --- Dialogs ---

func (s *PlatformService) OpenFile(filters string) string {
	dialog := s.app.Dialog.OpenFile().CanChooseFiles(true)
	if filters != "" {
		dialog.AddFilter("Files", filters)
	}
	file, err := dialog.PromptForSingleSelection()
	if err != nil {
		return ""
	}
	return file
}

func (s *PlatformService) SaveFile(defaultName string) string {
	file, err := s.app.Dialog.SaveFile().
		SetFilename(defaultName).
		PromptForSingleSelection()
	if err != nil {
		return ""
	}
	return file
}

func (s *PlatformService) OpenSubtitle() string {
	file, err := s.app.Dialog.OpenFile().
		CanChooseFiles(true).
		AddFilter("Subtitle Files", "*.srt").
		PromptForSingleSelection()
	if err != nil {
		return ""
	}
	return file
}

// --- Platform ---

func (s *PlatformService) OpenExternal(filePath string) {
	var cmd *exec.Cmd
	switch goRuntime.GOOS {
	case "darwin":
		cmd = exec.Command("open", "--", filePath)
	case "windows":
		cmd = exec.Command("cmd", "/c", "start", "", filePath)
	default:
		cmd = exec.Command("xdg-open", filePath)
	}
	cmd.Start()
}

func (s *PlatformService) GetPlatform() string {
	return goRuntime.GOOS
}

// --- File Ops ---

func (s *PlatformService) ReadTextFile(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return string(data)
}

func (s *PlatformService) WriteTextFile(path, content string) {
	os.WriteFile(path, []byte(content), 0644)
}
