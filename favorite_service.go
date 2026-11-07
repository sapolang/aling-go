package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type FavoriteService struct {
	app *application.App
}

func NewFavoriteService(app *application.App) *FavoriteService {
	return &FavoriteService{app: app}
}

func (s *FavoriteService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	return nil
}
func (s *FavoriteService) ServiceShutdown() error { return nil }

// --- Clips ---

// FavoriteList 返回收藏片段列表（JSON 字符串），tagID > 0 时按标签筛选
func (s *FavoriteService) FavoriteList(tagID int) string {
	query := `
		SELECT c.id, c.file_path, c.start_time, c.end_time, c.text, c.tag_id,
		       COALESCE(t.name, ''), c.word, c.review_count, c.last_reviewed_at, c.created_at
		FROM favorite_clips c
		LEFT JOIN favorite_tags t ON t.id = c.tag_id
	`
	var rows *sql.Rows
	var err error
	if tagID > 0 {
		rows, err = db.Query(query+" WHERE c.tag_id = ? ORDER BY c.created_at DESC", tagID)
	} else {
		rows, err = db.Query(query + " ORDER BY c.created_at DESC")
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "FavoriteList: %v\n", err)
		return "[]"
	}
	defer rows.Close()

	clips := make([]FavoriteClip, 0)
	for rows.Next() {
		var c FavoriteClip
		if err := rows.Scan(&c.ID, &c.FilePath, &c.StartTime, &c.EndTime,
			&c.Text, &c.TagID, &c.TagName, &c.Word, &c.ReviewCount, &c.LastReviewedAt, &c.CreatedAt); err != nil {
			continue
		}
		c.FileName = filepath.Base(c.FilePath)
		clips = append(clips, c)
	}
	b, err := json.Marshal(clips)
	if err != nil {
		return "[]"
	}
	return string(b)
}

// FavoriteAdd 新增收藏片段，返回新记录 ID
func (s *FavoriteService) FavoriteAdd(clipJSON string) int {
	var c FavoriteClip
	if err := json.Unmarshal([]byte(clipJSON), &c); err != nil {
		fmt.Fprintf(os.Stderr, "FavoriteAdd: unmarshal: %v\n", err)
		return 0
	}
	res, err := db.Exec(
		"INSERT INTO favorite_clips (file_path, start_time, end_time, text, tag_id, word) VALUES (?,?,?,?,?,?)",
		c.FilePath, c.StartTime, c.EndTime, c.Text, c.TagID, c.Word,
	)
	if err != nil {
		fmt.Fprintf(os.Stderr, "FavoriteAdd: %v\n", err)
		return 0
	}
	id, _ := res.LastInsertId()
	return int(id)
}

func (s *FavoriteService) FavoriteDelete(id int) {
	if _, err := db.Exec("DELETE FROM favorite_clips WHERE id=?", id); err != nil {
		fmt.Fprintf(os.Stderr, "FavoriteDelete: %v\n", err)
	}
}

// FavoriteUpdateTag 修改片段所属标签（tagID=0 表示移除标签）
func (s *FavoriteService) FavoriteUpdateTag(id int, tagID int) {
	if _, err := db.Exec("UPDATE favorite_clips SET tag_id=? WHERE id=?", tagID, id); err != nil {
		fmt.Fprintf(os.Stderr, "FavoriteUpdateTag: %v\n", err)
	}
}

// FavoriteMarkReviewed 记录一次片段复习，返回累计复习次数
func (s *FavoriteService) FavoriteMarkReviewed(id int) int {
	if _, err := db.Exec(
		"UPDATE favorite_clips SET review_count = COALESCE(review_count, 0) + 1, last_reviewed_at = datetime('now','localtime') WHERE id=?",
		id,
	); err != nil {
		fmt.Fprintf(os.Stderr, "FavoriteMarkReviewed: %v\n", err)
		return 0
	}
	var count int
	if err := db.QueryRow("SELECT COALESCE(review_count, 0) FROM favorite_clips WHERE id=?", id).Scan(&count); err != nil {
		return 0
	}
	return count
}

// --- Tags ---

func (s *FavoriteService) FavoriteTagsList() string {
	rows, err := db.Query("SELECT id, name FROM favorite_tags ORDER BY name ASC")
	if err != nil {
		fmt.Fprintf(os.Stderr, "FavoriteTagsList: %v\n", err)
		return "[]"
	}
	defer rows.Close()

	tags := make([]FavoriteTag, 0)
	for rows.Next() {
		var t FavoriteTag
		if err := rows.Scan(&t.ID, &t.Name); err != nil {
			continue
		}
		tags = append(tags, t)
	}
	b, err := json.Marshal(tags)
	if err != nil {
		return "[]"
	}
	return string(b)
}

func (s *FavoriteService) FavoriteTagAdd(name string) int {
	res, err := db.Exec("INSERT INTO favorite_tags (name) VALUES (?)", name)
	if err != nil {
		fmt.Fprintf(os.Stderr, "FavoriteTagAdd: %v\n", err)
		return 0
	}
	id, _ := res.LastInsertId()
	return int(id)
}

// FavoriteTagDelete 删除标签，并将该标签下片段的 tag_id 置 0
func (s *FavoriteService) FavoriteTagDelete(id int) {
	if _, err := db.Exec("UPDATE favorite_clips SET tag_id=0 WHERE tag_id=?", id); err != nil {
		fmt.Fprintf(os.Stderr, "FavoriteTagDelete clips: %v\n", err)
	}
	if _, err := db.Exec("DELETE FROM favorite_tags WHERE id=?", id); err != nil {
		fmt.Fprintf(os.Stderr, "FavoriteTagDelete: %v\n", err)
	}
}
