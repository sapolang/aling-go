package dict

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"aling-go/internal/store/userdb"

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
	return nil
}

// Lookup 在 entries 表中查询单词：先用小写 word_key 精确匹配，
// 再对常见词形变化（复数、过去式、现在分词等）做简单还原回退。
// 未命中时返回 nil。
func Lookup(word string) *DictWord {
	w := strings.ToLower(strings.TrimSpace(word))
	if w == "" || dictDB == nil {
		return nil
	}
	candidates := []string{w}
	add := func(s string) {
		if s != "" && s != w {
			candidates = append(candidates, s)
		}
	}
	if strings.HasSuffix(w, "'s") {
		add(strings.TrimSuffix(w, "'s"))
	}
	if strings.HasSuffix(w, "ies") && len(w) > 3 {
		add(w[:len(w)-3] + "y")
	}
	if strings.HasSuffix(w, "es") && len(w) > 2 {
		add(w[:len(w)-2])
	}
	if strings.HasSuffix(w, "s") && len(w) > 1 && !strings.HasSuffix(w, "ss") {
		add(w[:len(w)-1])
	}
	if strings.HasSuffix(w, "ied") && len(w) > 3 {
		add(w[:len(w)-3] + "y")
	}
	if strings.HasSuffix(w, "ed") && len(w) > 2 {
		add(w[:len(w)-2])
		add(w[:len(w)-1]) // 如 stopped -> stop
	}
	if strings.HasSuffix(w, "ing") && len(w) > 3 {
		add(w[:len(w)-3])
		add(w[:len(w)-3] + "e") // 如 making -> make
	}
	for _, c := range candidates {
		var dw DictWord
		err := dictDB.QueryRow(
			"SELECT word, phonetic, translation, '' AS definition, '' AS pos, tags AS tag FROM entries WHERE word_key = ? LIMIT 1",
			c,
		).Scan(&dw.Word, &dw.Phonetic, &dw.Translation, &dw.Definition, &dw.Pos, &dw.Tag)
		if err == nil {
			return &dw
		}
	}
	return nil
}

func GetTags() ([]DictTag, error) {
	rows, err := dictDB.Query("SELECT tags FROM entries")
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

// SearchEntries 在 entries 表中按小写 word_key 搜索：前缀匹配优先于包含匹配，
// 同级内短词优先。limit <= 0 时默认 50。query 为空时返回空结果。
func SearchEntries(query string, limit int) ([]DictWord, error) {
	q := strings.ToLower(strings.TrimSpace(query))
	if q == "" || dictDB == nil {
		return nil, nil
	}
	if limit <= 0 {
		limit = 50
	}
	like := strings.ReplaceAll(q, "%", "\\%")
	like = strings.ReplaceAll(like, "_", "\\_")
	rows, err := dictDB.Query(
		`SELECT word, phonetic, translation, '' AS definition, '' AS pos, tags AS tag FROM entries
			WHERE word_key LIKE ? ESCAPE '\' OR word_key LIKE ? ESCAPE '\'
			ORDER BY CASE WHEN word_key LIKE ? ESCAPE '\' THEN 0 ELSE 1 END, LENGTH(word_key), word_key
			LIMIT ?`,
		like+"%", "%"+like+"%", like+"%", limit,
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

func GetWordsByTag(tag string) ([]DictWord, error) {
	likeTag := strings.ReplaceAll(tag, "%", "\\%")
	likeTag = strings.ReplaceAll(likeTag, "_", "\\_")
	rows, err := dictDB.Query(
		"SELECT word, phonetic, translation, '' AS definition, '' AS pos, tags AS tag FROM entries WHERE tags LIKE ? ESCAPE '\\' ORDER BY word",
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

	q := userdb.New(tx)
	for _, w := range words {
		def := w.Translation
		if w.Definition != "" {
			def += "\n" + w.Definition
		}
		n, err := q.AddDictWord(context.Background(), userdb.AddDictWordParams{
			Word:       w.Word,
			Definition: def,
			Phonetic:   w.Phonetic,
			Tags:       w.Tag,
		})
		if err != nil {
			skipped++
			continue
		}
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
	return userdb.New(userDB).SaveDictProgress(context.Background(), userdb.SaveDictProgressParams{
		Tag:          tag,
		CurrentIndex: index,
	})
}

func GetProgress(tag string) (int, error) {
	if userDB == nil {
		return 0, fmt.Errorf("user DB not initialized")
	}
	index, err := userdb.New(userDB).GetDictProgress(context.Background(), tag)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	return index, err
}
