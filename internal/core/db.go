package core

import (
	"database/sql"
	"os"
	"path/filepath"

	"aling-go/internal/dict"

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
	_, err := DB.Exec(`
		CREATE TABLE IF NOT EXISTS words (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			word TEXT NOT NULL,
			definition TEXT DEFAULT '',
			phonetic TEXT DEFAULT '',
			example TEXT DEFAULT '',
			tags TEXT DEFAULT '',
			level INTEGER DEFAULT 1,
			next_review TEXT DEFAULT (date('now')),
			created_at TEXT DEFAULT (datetime('now','localtime')),
			updated_at TEXT DEFAULT (datetime('now','localtime')),
			repetitions INTEGER DEFAULT 0,
			efactor REAL DEFAULT 2.5,
			interval INTEGER DEFAULT 0
		);
		CREATE TABLE IF NOT EXISTS tags (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL UNIQUE,
			color TEXT NOT NULL DEFAULT '#3b82f6'
		);
		CREATE TABLE IF NOT EXISTS typing_records (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			article_id INTEGER NOT NULL,
			mode TEXT NOT NULL,
			accuracy REAL DEFAULT 0,
			wpm REAL DEFAULT 0,
			duration INTEGER DEFAULT 0,
			mistakes TEXT DEFAULT '[]',
			created_at TEXT DEFAULT (datetime('now','localtime'))
		);
		CREATE TABLE IF NOT EXISTS typing_progress (
			article_id INTEGER NOT NULL,
			mode TEXT NOT NULL,
			position INTEGER DEFAULT 0,
			completed INTEGER DEFAULT 0,
			best_accuracy REAL DEFAULT 0,
			best_wpm REAL DEFAULT 0,
			updated_at TEXT DEFAULT (datetime('now','localtime')),
			PRIMARY KEY (article_id, mode)
		);
		CREATE TABLE IF NOT EXISTS review_logs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			word_id INTEGER NOT NULL,
			quality INTEGER NOT NULL,
			reviewed_at TEXT DEFAULT (datetime('now','localtime'))
		);
		CREATE INDEX IF NOT EXISTS idx_review_logs_reviewed_at ON review_logs(reviewed_at);
		CREATE TABLE IF NOT EXISTS favorite_tags (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL UNIQUE,
			created_at TEXT DEFAULT (datetime('now','localtime'))
		);
		CREATE TABLE IF NOT EXISTS favorite_clips (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			file_path TEXT NOT NULL,
			start_time REAL NOT NULL,
			end_time REAL NOT NULL,
			text TEXT DEFAULT '',
			tag_id INTEGER DEFAULT 0,
			word TEXT DEFAULT '',
			review_count INTEGER DEFAULT 0,
			last_reviewed_at TEXT DEFAULT '',
			next_review TEXT DEFAULT '',
			created_at TEXT DEFAULT (datetime('now','localtime'))
		);
		CREATE INDEX IF NOT EXISTS idx_favorite_clips_tag ON favorite_clips(tag_id);
		CREATE TABLE IF NOT EXISTS ai_translations (
			hash TEXT PRIMARY KEY,
			kind TEXT NOT NULL DEFAULT 'translate',
			model TEXT NOT NULL DEFAULT '',
			source TEXT NOT NULL,
			target TEXT NOT NULL,
			created_at TEXT DEFAULT (datetime('now','localtime'))
		);
		CREATE INDEX IF NOT EXISTS idx_ai_translations_created ON ai_translations(created_at);
	`)
	return err
}
