package core

import (
	"database/sql"
	"os"
	"path/filepath"

	"aling-go/internal/dict"
	"aling-go/internal/store"

	_ "modernc.org/sqlite"
)

// DB 是可写的用户库（生词、标签、SRS、收藏、AI 缓存等），
// ArticleDB 是只读的文章库。各业务包通过这两个句柄访问数据库。
var (
	DB        *sql.DB
	ArticleDB *sql.DB
)

// Init 依次打开用户数据库、文章库、词典库并执行旧数据迁移。
func Init(dataDir string) error {
	if err := initDB(dataDir); err != nil {
		return err
	}
	if err := openArticleDB(dataDir); err != nil {
		return err
	}
	if err := dict.OpenDictDB(dataDir, DB); err != nil {
		return err
	}
	migrateIfNeeded(dataDir)
	return nil
}

// Close 关闭全部数据库句柄。
func Close() {
	if DB != nil {
		_ = DB.Close()
	}
	if ArticleDB != nil {
		_ = ArticleDB.Close()
	}
}

func initDB(dataDir string) error {
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return err
	}
	dbPath := filepath.Join(dataDir, "userData.db")
	var err error
	DB, err = sql.Open("sqlite", dbPath)
	if err != nil {
		return err
	}
	return createTables()
}

func createTables() error {
	_, err := DB.Exec(store.Schema)
	return err
}
