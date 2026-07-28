package dict

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	_ "modernc.org/sqlite"
)

var dictDB *sql.DB
var userDB *sql.DB

func OpenDictDB(dataDir string, userDataDB *sql.DB) error {
	userDB = userDataDB
	paths := []string{
		filepath.Join(dataDir, "dict.db"),
		"dict.db",
	}
	if cwd, err := os.Getwd(); err == nil {
		paths = append(paths, filepath.Join(cwd, "dict.db"))
	}
	exe, _ := os.Executable()
	if exe != "" {
		exeDir := filepath.Dir(exe)
		paths = append(paths, filepath.Join(exeDir, "dict.db"))
		paths = append(paths, filepath.Join(exeDir, "..", "Resources", "dict.db"))
	}
	var dbPath string
	for _, p := range paths {
		if _, err := os.Stat(p); err == nil {
			dbPath = p
			break
		}
	}
	if dbPath == "" {
		return fmt.Errorf("dict.db not found in any search path")
	}
	var err error
	dictDB, err = sql.Open("sqlite", dbPath)
	if err != nil {
		return err
	}
	if err := dictDB.Ping(); err != nil {
		return err
	}
	return initProgressTable()
}

func initProgressTable() error {
	if userDB == nil {
		return nil
	}
	_, err := userDB.Exec(`CREATE TABLE IF NOT EXISTS dict_progress (
		tag TEXT PRIMARY KEY,
		current_index INTEGER DEFAULT 0,
		updated_at TEXT DEFAULT (datetime('now','localtime'))
	)`)
	return err
}

func GetTags() ([]DictTag, error) {
	rows, err := dictDB.Query("SELECT tag FROM mini_dict")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tagCount := make(map[string]int)
	for rows.Next() {
		var tagStr string
		if err := rows.Scan(&tagStr); err != nil {
			continue
		}
		for _, t := range strings.Fields(tagStr) {
			tagCount[t]++
		}
	}

	tags := make([]string, 0, len(tagCount))
	for tag := range tagCount {
		tags = append(tags, tag)
	}
	sort.Strings(tags)

	var result []DictTag
	for _, tag := range tags {
		result = append(result, DictTag{Tag: tag, Count: tagCount[tag]})
	}
	return result, nil
}

func GetWordsByTag(tag string) ([]DictWord, error) {
	likeTag := strings.ReplaceAll(tag, "%", "\\%")
	likeTag = strings.ReplaceAll(likeTag, "_", "\\_")
	rows, err := dictDB.Query(
		"SELECT word, phonetic, translation, definition, pos, tag FROM mini_dict WHERE tag LIKE ? ESCAPE '\\' ORDER BY word",
		"%"+likeTag+"%",
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var words []DictWord
	for rows.Next() {
		var w DictWord
		if err := rows.Scan(&w.Word, &w.Phonetic, &w.Translation, &w.Definition, &w.Pos, &w.Tag); err != nil {
			continue
		}
		words = append(words, w)
	}
	return words, nil
}

func AddWordsToList(words []DictWord) (added, skipped int, err error) {
	if userDB == nil {
		return 0, 0, fmt.Errorf("dict DB not initialized")
	}
	tx, err := userDB.Begin()
	if err != nil {
		return 0, 0, err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare("INSERT OR IGNORE INTO words (word, definition, phonetic, tags) VALUES (?, ?, ?, ?)")
	if err != nil {
		return 0, 0, err
	}
	defer stmt.Close()

	for _, w := range words {
		def := w.Translation
		if w.Definition != "" {
			def += "\n" + w.Definition
		}
		res, err := stmt.Exec(w.Word, def, w.Phonetic, w.Tag)
		if err != nil {
			skipped++
			continue
		}
		n, _ := res.RowsAffected()
		if n > 0 {
			added++
		} else {
			skipped++
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, 0, err
	}
	return added, skipped, nil
}

func SaveProgress(tag string, index int) error {
	if userDB == nil {
		return fmt.Errorf("user DB not initialized")
	}
	_, err := userDB.Exec(
		"INSERT OR REPLACE INTO dict_progress (tag, current_index, updated_at) VALUES (?, ?, datetime('now','localtime'))",
		tag, index,
	)
	return err
}

func GetProgress(tag string) (int, error) {
	if userDB == nil {
		return 0, fmt.Errorf("user DB not initialized")
	}
	var index int
	err := userDB.QueryRow("SELECT current_index FROM dict_progress WHERE tag=?", tag).Scan(&index)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	return index, err
}
