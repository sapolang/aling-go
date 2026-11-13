package system

import (
	"os"
	"path/filepath"
	"testing"
)

func TestGetBackupStatusReturnsNonNilFiles(t *testing.T) {
	s := &BackupService{dataDir: t.TempDir()}

	status := s.GetBackupStatus()
	if status.Files == nil {
		t.Fatal("Files 不应为 nil")
	}
	if len(status.Files) != 0 {
		t.Fatalf("空目录下不应有备份文件: %+v", status.Files)
	}
	if status.LastBackup != "" {
		t.Fatalf("无备份时 LastBackup 应为空, got %q", status.LastBackup)
	}

	dir := s.backupsDir()
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "library-20260101-120000.json"), []byte("{}"), 0644); err != nil {
		t.Fatal(err)
	}

	status = s.GetBackupStatus()
	if len(status.Files) != 1 || status.Files[0].Name != "library-20260101-120000.json" {
		t.Fatalf("备份文件列表不符: %+v", status.Files)
	}
	if status.Files[0].Size != 2 {
		t.Fatalf("备份文件大小不符: %+v", status.Files[0])
	}
}
