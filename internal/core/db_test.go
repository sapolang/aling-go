package core

import (
	"strings"
	"testing"
)

func TestInitDBEnablesWALAndBusyTimeout(t *testing.T) {
	prev := DB
	defer func() { DB = prev }()

	if err := initDB(t.TempDir()); err != nil {
		t.Fatalf("initDB: %v", err)
	}

	var mode string
	if err := DB.QueryRow("PRAGMA journal_mode").Scan(&mode); err != nil {
		t.Fatalf("read journal_mode: %v", err)
	}
	if !strings.EqualFold(mode, "wal") {
		t.Fatalf("journal_mode = %q, want wal", mode)
	}

	var busyTimeout int
	if err := DB.QueryRow("PRAGMA busy_timeout").Scan(&busyTimeout); err != nil {
		t.Fatalf("read busy_timeout: %v", err)
	}
	if busyTimeout != 5000 {
		t.Fatalf("busy_timeout = %d, want 5000", busyTimeout)
	}
}
