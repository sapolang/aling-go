package main

import (
	"archive/zip"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

const (
	sourceURL      = "https://github.com/skywind3000/ECDICT/releases/download/1.0.28/ecdict-sqlite-28.zip"
	sourceSHA256   = "ea01f76a3b3351021ce47077e89234465cc9441c8793054495320d06c0c3f3f6"
	sourceVersion  = "1.0.28"
	frequencyLimit = 30000
	schemaVersion  = "1"
	// stardict.db 解压后约几百 MB，2GB 作为防解压炸弹的上限。
	maxExtractedBytes = 2 << 30
)

var knownTags = []string{"zk", "gk", "cet4", "cet6", "ky", "toefl", "ielts", "gre"}

const schemaSQL = `
CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE entries (
    word_key TEXT PRIMARY KEY,
    word TEXT NOT NULL,
    phonetic TEXT NOT NULL DEFAULT '',
    translation TEXT NOT NULL DEFAULT '',
    collins INTEGER NOT NULL DEFAULT 0,
    oxford INTEGER NOT NULL DEFAULT 0,
    bnc INTEGER NOT NULL DEFAULT 0,
    frq INTEGER NOT NULL DEFAULT 0,
    tags TEXT NOT NULL DEFAULT '',
    exchange TEXT NOT NULL DEFAULT ''
);
`

type entry struct {
	wordKey     string
	word        string
	phonetic    string
	translation string
	collins     int
	oxford      int
	bnc         int
	frq         int
	tags        string
	exchange    string
}

func main() {
	src := flag.String("src", "", "本地 ECDICT stardict.db 或 ecdict-sqlite 压缩包路径；留空则下载官方 1.0.28 包")
	out := flag.String("out", "dict.db", "输出的 dict.db 路径")
	flag.Parse()

	sourcePath, cleanup, err := resolveSource(*src)
	if err != nil {
		fatal(err)
	}
	defer cleanup()

	rows, err := readSource(sourcePath)
	if err != nil {
		fatal(err)
	}
	fmt.Printf("源库命中 %d 条词条\n", len(rows))

	inserted, err := writeDB(*out, rows)
	if err != nil {
		fatal(err)
	}

	info, err := os.Stat(*out)
	if err != nil {
		fatal(err)
	}
	fmt.Printf("产物: %s\n词条数: %d\n文件大小: %.1fMB\n", *out, inserted, float64(info.Size())/(1024*1024))
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, "构建失败:", err)
	os.Exit(1)
}

// resolveSource 返回可直接打开的 stardict.db 路径；空参数时下载官方 ECDICT 1.0.28 压缩包。
func resolveSource(src string) (string, func(), error) {
	noop := func() {}

	if src == "" {
		cacheDir := filepath.Join(os.TempDir(), "aling-go-dict-build")
		if err := os.MkdirAll(cacheDir, 0755); err != nil {
			return "", noop, err
		}
		zipPath := filepath.Join(cacheDir, filepath.Base(sourceURL))
		if err := ensureDownloaded(zipPath); err != nil {
			return "", noop, err
		}
		src = zipPath
	}

	if strings.EqualFold(filepath.Ext(src), ".zip") {
		dir, err := os.MkdirTemp("", "aling-go-dict-*")
		if err != nil {
			return "", noop, err
		}
		path, err := extractStardict(src, dir)
		if err != nil {
			_ = os.RemoveAll(dir)
			return "", noop, err
		}
		return path, func() { _ = os.RemoveAll(dir) }, nil
	}

	if _, err := os.Stat(src); err != nil {
		return "", noop, err
	}
	return src, noop, nil
}

func ensureDownloaded(zipPath string) error {
	if sum, err := fileSHA256(zipPath); err == nil && sum == sourceSHA256 {
		fmt.Println("复用已下载的源包:", zipPath)
		return nil
	}

	fmt.Println("下载", sourceURL)
	if err := downloadFile(sourceURL, zipPath); err != nil {
		return err
	}
	sum, err := fileSHA256(zipPath)
	if err != nil {
		return err
	}
	if sum != sourceSHA256 {
		_ = os.Remove(zipPath)
		return fmt.Errorf("源包 sha256 不匹配: 期望 %s, 实际 %s", sourceSHA256, sum)
	}
	fmt.Println("sha256 校验通过")
	return nil
}

func downloadFile(url, dest string) error {
	resp, err := http.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("下载失败: HTTP %d", resp.StatusCode)
	}

	out, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer out.Close()

	var received, nextMilestone int64
	nextMilestone = 20 * 1024 * 1024
	buf := make([]byte, 32*1024)
	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := out.Write(buf[:n]); werr != nil {
				return werr
			}
			received += int64(n)
			if received >= nextMilestone {
				fmt.Printf("  已下载 %dMB\n", received/(1024*1024))
				nextMilestone += 20 * 1024 * 1024
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
	}
	return nil
}

func fileSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func extractStardict(zipPath, destDir string) (string, error) {
	reader, err := zip.OpenReader(zipPath)
	if err != nil {
		return "", err
	}
	defer func() { _ = reader.Close() }()

	for _, f := range reader.File {
		if filepath.Base(f.Name) != "stardict.db" {
			continue
		}
		in, err := f.Open()
		if err != nil {
			return "", err
		}
		path := filepath.Join(destDir, "stardict.db")
		out, err := os.Create(path)
		if err != nil {
			_ = in.Close()
			return "", err
		}
		copied, copyErr := io.Copy(out, io.LimitReader(in, maxExtractedBytes))
		_ = in.Close()
		closeErr := out.Close()
		if copyErr != nil {
			return "", copyErr
		}
		if closeErr != nil {
			return "", closeErr
		}
		if copied == maxExtractedBytes {
			return "", fmt.Errorf("stardict.db 解压后超过 %d 字节上限", int64(maxExtractedBytes))
		}
		return path, nil
	}
	return "", fmt.Errorf("压缩包内未找到 stardict.db: %s", zipPath)
}

func readSource(srcPath string) ([]entry, error) {
	db, err := sql.Open("sqlite", srcPath)
	if err != nil {
		return nil, err
	}
	defer db.Close()

	rows, err := db.Query(`
		SELECT word, phonetic, translation, collins, oxford, tag, bnc, frq, exchange
		FROM stardict
		WHERE (bnc IS NOT NULL AND bnc BETWEEN 1 AND ?)
		   OR (frq IS NOT NULL AND frq BETWEEN 1 AND ?)
		   OR collins >= 1
		   OR oxford >= 1
		   OR (tag IS NOT NULL AND TRIM(tag) != '')
		ORDER BY word COLLATE NOCASE`,
		frequencyLimit, frequencyLimit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]entry, 0, 40000)
	for rows.Next() {
		var (
			word, phonetic, translation string
			collins, oxford, bnc, frq   sql.NullInt64
			tag, exchange               sql.NullString
		)
		if err := rows.Scan(&word, &phonetic, &translation, &collins, &oxford, &tag, &bnc, &frq, &exchange); err != nil {
			return nil, err
		}

		word = strings.TrimSpace(word)
		translation = strings.TrimSpace(translation)
		if word == "" || translation == "" {
			continue
		}

		result = append(result, entry{
			wordKey:     strings.ToLower(word),
			word:        word,
			phonetic:    phonetic,
			translation: translation,
			collins:     int(collins.Int64),
			oxford:      int(oxford.Int64),
			bnc:         int(bnc.Int64),
			frq:         int(frq.Int64),
			tags:        normalizeTags(tag.String),
			exchange:    exchange.String,
		})
	}
	return result, rows.Err()
}

func normalizeTags(tag string) string {
	values := make(map[string]bool, len(knownTags))
	for _, t := range strings.Fields(tag) {
		values[t] = true
	}
	kept := make([]string, 0, len(knownTags))
	for _, t := range knownTags {
		if values[t] {
			kept = append(kept, t)
		}
	}
	return strings.Join(kept, " ")
}

func writeDB(outPath string, rows []entry) (int, error) {
	_ = os.Remove(outPath)

	db, err := sql.Open("sqlite", outPath)
	if err != nil {
		return 0, err
	}
	defer db.Close()

	if _, err := db.Exec(schemaSQL); err != nil {
		return 0, err
	}

	tx, err := db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`
		INSERT OR REPLACE INTO entries
		(word_key, word, phonetic, translation, collins, oxford, bnc, frq, tags, exchange)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return 0, err
	}
	defer stmt.Close()

	inserted := 0
	for _, e := range rows {
		if _, err := stmt.Exec(e.wordKey, e.word, e.phonetic, e.translation, e.collins, e.oxford, e.bnc, e.frq, e.tags, e.exchange); err != nil {
			continue
		}
		inserted++
	}

	meta := []struct{ key, value string }{
		{"schema_version", schemaVersion},
		{"source", "ecdict"},
		{"source_version", sourceVersion},
		{"word_count", fmt.Sprintf("%d", inserted)},
		{"generated_at", time.Now().UTC().Format("2006-01-02T15:04:05Z")},
	}
	for _, kv := range meta {
		if _, err := tx.Exec("INSERT INTO meta (key, value) VALUES (?, ?)", kv.key, kv.value); err != nil {
			return 0, err
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return inserted, nil
}
