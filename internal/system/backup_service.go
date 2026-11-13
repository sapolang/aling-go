package system

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"aling-go/internal/core"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	backupKeepCount    = 7
	backupAutoInterval = 24 * time.Hour
	// 时间戳格式可直接按字符串排序，用于备份文件名
	backupTimeFormat = "20060102-150405"
)

type BackupService struct {
	app     *application.App
	dataDir string
}

func NewBackupService(app *application.App, dataDir string) *BackupService {
	return &BackupService{app: app, dataDir: dataDir}
}

func (s *BackupService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	last, err := s.lastBackupTime()
	if err != nil || last.IsZero() || time.Since(last) > backupAutoInterval {
		if _, err := s.runBackup(); err != nil {
			fmt.Fprintf(os.Stderr, "auto backup failed: %v\n", err)
		}
	}
	return nil
}
func (s *BackupService) ServiceShutdown() error { return nil }

func (s *BackupService) backupsDir() string {
	return filepath.Join(s.dataDir, "backups")
}

type BackupFileInfo struct {
	Name string `json:"name"`
	Size int64  `json:"size"`
}

type BackupStatus struct {
	LastBackup string           `json:"lastBackup"` // RFC3339，无备份时为空
	Dir        string           `json:"dir"`
	Files      []BackupFileInfo `json:"files"`
}

type BackupResult struct {
	OK     bool          `json:"ok"`
	Error  string        `json:"error,omitempty"`
	Status *BackupStatus `json:"status,omitempty"`
}

// BackupNow 立即执行一次备份：userData.db 用 VACUUM INTO 一致性拷贝，
// library.json 直接文件拷贝，均输出到配置目录 backups/ 下，保留最近 7 份。
func (s *BackupService) BackupNow() BackupResult {
	if _, err := s.runBackup(); err != nil {
		fmt.Fprintf(os.Stderr, "BackupNow: %v\n", err)
		return BackupResult{OK: false, Error: err.Error()}
	}
	status := s.getStatus()
	return BackupResult{OK: true, Status: &status}
}

// GetBackupStatus 返回最近备份时间、备份文件列表与备份目录路径。
func (s *BackupService) GetBackupStatus() BackupStatus {
	return s.getStatus()
}

func (s *BackupService) runBackup() (string, error) {
	dir := s.backupsDir()
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}
	stamp := time.Now().Format(backupTimeFormat)
	dbBackup := filepath.Join(dir, "userData-"+stamp+".db")
	// 同一秒重复备份时 VACUUM INTO 会因目标已存在而失败，先删掉旧文件
	_ = os.Remove(dbBackup)
	// VACUUM INTO 不支持参数绑定；路径来自应用备份目录且单引号已转义
	quoted := "'" + strings.ReplaceAll(dbBackup, "'", "''") + "'"
	if _, err := core.DB.Exec("VACUUM INTO " + quoted); err != nil { //nolint:gosec // G202: 见上行注释
		return "", fmt.Errorf("备份数据库失败: %w", err)
	}
	libSrc := filepath.Join(s.dataDir, "library.json")
	data, err := os.ReadFile(libSrc)
	switch {
	case err == nil:
		if err := os.WriteFile(filepath.Join(dir, "library-"+stamp+".json"), data, 0644); err != nil {
			return "", fmt.Errorf("备份媒体库失败: %w", err)
		}
	case !os.IsNotExist(err):
		return "", fmt.Errorf("读取媒体库失败: %w", err)
	}
	s.pruneBackups()
	return stamp, nil
}

// pruneBackups 按文件名时间戳保留最近 backupKeepCount 份，更旧的删除。
func (s *BackupService) pruneBackups() {
	stamps := s.listBackupStamps()
	if len(stamps) <= backupKeepCount {
		return
	}
	dir := s.backupsDir()
	for _, stamp := range stamps[:len(stamps)-backupKeepCount] {
		_ = os.Remove(filepath.Join(dir, "userData-"+stamp+".db"))
		_ = os.Remove(filepath.Join(dir, "library-"+stamp+".json"))
	}
}

func (s *BackupService) listBackupStamps() []string {
	entries, err := os.ReadDir(s.backupsDir())
	if err != nil {
		return nil
	}
	var stamps []string
	for _, e := range entries {
		name := e.Name()
		if strings.HasPrefix(name, "userData-") && strings.HasSuffix(name, ".db") {
			stamps = append(stamps, strings.TrimSuffix(strings.TrimPrefix(name, "userData-"), ".db"))
		}
	}
	sort.Strings(stamps)
	return stamps
}

func (s *BackupService) lastBackupTime() (time.Time, error) {
	stamps := s.listBackupStamps()
	if len(stamps) == 0 {
		return time.Time{}, nil
	}
	return time.ParseInLocation(backupTimeFormat, stamps[len(stamps)-1], time.Local)
}

func (s *BackupService) getStatus() BackupStatus {
	dir := s.backupsDir()
	status := BackupStatus{Dir: dir, Files: []BackupFileInfo{}}
	if t, err := s.lastBackupTime(); err == nil && !t.IsZero() {
		status.LastBackup = t.Format(time.RFC3339)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return status
	}
	for _, e := range entries {
		info, err := e.Info()
		if err != nil || e.IsDir() {
			continue
		}
		status.Files = append(status.Files, BackupFileInfo{Name: e.Name(), Size: info.Size()})
	}
	// 新的备份排在前面
	sort.Slice(status.Files, func(i, j int) bool { return status.Files[i].Name > status.Files[j].Name })
	return status
}
