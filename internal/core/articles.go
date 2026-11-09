package core

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
)

func openArticleDB(dataDir string) error {
	paths := []string{
		filepath.Join(dataDir, "articles.db"),
		"articles.db",
	}
	if cwd, err := os.Getwd(); err == nil {
		paths = append(paths, filepath.Join(cwd, "articles.db"))
	}
	exe, _ := os.Executable()
	if exe != "" {
		exeDir := filepath.Dir(exe)
		paths = append(paths, filepath.Join(exeDir, "articles.db"))
		paths = append(paths, filepath.Join(exeDir, "..", "Resources", "articles.db"))
	}
	for _, p := range paths {
		if _, err := os.Stat(p); err != nil {
			continue
		}
		conn, err := sql.Open("sqlite", p)
		if err != nil {
			continue
		}
		if err := conn.Ping(); err != nil {
			_ = conn.Close()
			continue
		}
		// 空文件（如误创建的 0 字节 db）会遮蔽真实数据库，校验必需的表后才采用
		var tables int
		if err := conn.QueryRow(
			"SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('articles','categories')",
		).Scan(&tables); err != nil || tables != 2 {
			_ = conn.Close()
			continue
		}
		ArticleDB = conn
		return nil
	}
	return fmt.Errorf("articles.db not found in any search path")
}
