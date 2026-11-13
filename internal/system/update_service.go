package system

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/updater"
	"github.com/wailsapp/wails/v3/pkg/updater/providers/github"
)

const (
	updateRepo       = "sapolang/aling-go"
	updateReleaseURL = "https://github.com/" + updateRepo + "/releases/tag/v"
)

// UpdateInfo 是检查更新后回传给前端的结果。
type UpdateInfo struct {
	CurrentVersion string `json:"currentVersion"`
	LatestVersion  string `json:"latestVersion"`
	HasUpdate      bool   `json:"hasUpdate"`
	Notes          string `json:"notes"`
	PublishedAt    string `json:"publishedAt"`
	ReleaseURL     string `json:"releaseUrl"`
	AssetName      string `json:"assetName"`
	AssetSize      int64  `json:"assetSize"`
	Error          string `json:"error,omitempty"`
}

// UpdateResult 是下载 / 重启操作的结果。
type UpdateResult struct {
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
}

// UpdateService 基于 Wails v3 内置 updater + GitHub Releases 提供应用内更新。
// 下载完成后由 updater helper 替换 .app bundle 并自动重启。
type UpdateService struct {
	app     *application.App
	version string
	initErr error
}

func NewUpdateService(app *application.App, version string) *UpdateService {
	svc := &UpdateService{app: app, version: version}

	provider, err := github.New(github.Config{
		Repository:    updateRepo,
		ChecksumAsset: "SHA256SUMS",
	})
	if err != nil {
		svc.initErr = err
		return svc
	}

	// 开发构建没有正式版本号，用 0.0.0 让检查逻辑仍可工作（自动检查会跳过）
	current := version
	if !isReleaseVersion(current) {
		current = "0.0.0"
	}
	svc.initErr = app.Updater.Init(updater.Config{
		CurrentVersion: current,
		Providers:      []updater.Provider{provider},
		// 更新流程由应用内提示框驱动，updater 只负责检查、下载、换包与重启
		Window: updater.WindowNone,
	})

	return svc
}

// CheckForUpdate 查询 GitHub 最新正式版本；失败时把错误放在返回值里，避免前端收到 rejected promise。
func (s *UpdateService) CheckForUpdate() UpdateInfo {
	info, err := s.check()
	if err != nil {
		return UpdateInfo{CurrentVersion: s.version, Error: err.Error()}
	}
	return *info
}

// DownloadLatest 下载并校验当前平台的更新包，等待用户重启应用完成安装。
func (s *UpdateService) DownloadLatest() UpdateResult {
	if s.initErr != nil {
		return UpdateResult{Error: s.initErr.Error()}
	}
	if err := s.app.Updater.DownloadAndInstall(context.Background()); err != nil {
		return UpdateResult{Error: err.Error()}
	}
	return UpdateResult{OK: true}
}

// ApplyUpdate 启动 helper 替换 .app bundle 并重启应用；调用后当前进程会退出。
func (s *UpdateService) ApplyUpdate() UpdateResult {
	if s.initErr != nil {
		return UpdateResult{Error: s.initErr.Error()}
	}
	if err := s.app.Updater.Restart(context.Background()); err != nil {
		return UpdateResult{Error: err.Error()}
	}
	return UpdateResult{OK: true}
}

func (s *UpdateService) check() (*UpdateInfo, error) {
	if s.initErr != nil {
		return nil, s.initErr
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	rel, err := s.app.Updater.Check(ctx)
	if err != nil {
		return nil, fmt.Errorf("检查更新失败：%w", err)
	}
	info := &UpdateInfo{CurrentVersion: s.version}
	if rel == nil {
		info.LatestVersion = s.version
		return info, nil
	}

	info.LatestVersion = strings.TrimPrefix(rel.Version, "v")
	if info.LatestVersion == "" {
		info.LatestVersion = s.version
	}
	info.HasUpdate = true
	info.Notes = rel.Notes
	if !rel.PublishedAt.IsZero() {
		info.PublishedAt = rel.PublishedAt.Format(time.RFC3339)
	}
	info.ReleaseURL = updateReleaseURL + info.LatestVersion
	info.AssetName = rel.Artifact.Filename
	info.AssetSize = rel.Artifact.Size
	return info, nil
}

func isReleaseVersion(version string) bool {
	v := strings.TrimPrefix(strings.TrimSpace(version), "v")
	if v == "" {
		return false
	}
	if i := strings.IndexAny(v, "-+"); i >= 0 {
		v = v[:i]
	}
	for _, field := range strings.Split(v, ".") {
		if field == "" {
			return false
		}
		for _, r := range field {
			if r < '0' || r > '9' {
				return false
			}
		}
	}
	return true
}
