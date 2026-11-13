package study

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	"aling-go/internal/core"

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

// FavoriteList 返回收藏片段列表，tagID > 0 时按标签筛选
func (s *FavoriteService) FavoriteList(tagID int) []FavoriteClip {
	query := `
		SELECT c.id, c.file_path, c.start_time, c.end_time, c.text, c.tag_id,
		       COALESCE(t.name, ''), c.word, c.review_count, c.last_reviewed_at, c.next_review, c.created_at
		FROM favorite_clips c
		LEFT JOIN favorite_tags t ON t.id = c.tag_id
	`
	var rows *sql.Rows
	var err error
	if tagID > 0 {
		rows, err = core.DB.Query(query+" WHERE c.tag_id = ? ORDER BY c.created_at DESC", tagID)
	} else {
		rows, err = core.DB.Query(query + " ORDER BY c.created_at DESC")
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "FavoriteList: %v\n", err)
		return []FavoriteClip{}
	}
	defer rows.Close()

	clips := make([]FavoriteClip, 0)
	for rows.Next() {
		var c FavoriteClip
		if err := rows.Scan(&c.ID, &c.FilePath, &c.StartTime, &c.EndTime,
			&c.Text, &c.TagID, &c.TagName, &c.Word, &c.ReviewCount, &c.LastReviewedAt, &c.NextReview, &c.CreatedAt); err != nil {
			continue
		}
		c.FileName = filepath.Base(c.FilePath)
		clips = append(clips, c)
	}
	return clips
}

// FavoriteAdd 新增收藏片段，返回新记录 ID
func (s *FavoriteService) FavoriteAdd(c FavoriteClip) int {
	res, err := core.DB.Exec(
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
	if _, err := core.DB.Exec("DELETE FROM favorite_clips WHERE id=?", id); err != nil {
		fmt.Fprintf(os.Stderr, "FavoriteDelete: %v\n", err)
	}
}

// FavoriteUpdateTag 修改片段所属标签（tagID=0 表示移除标签）
func (s *FavoriteService) FavoriteUpdateTag(id int, tagID int) {
	if _, err := core.DB.Exec("UPDATE favorite_clips SET tag_id=? WHERE id=?", tagID, id); err != nil {
		fmt.Fprintf(os.Stderr, "FavoriteUpdateTag: %v\n", err)
	}
}

// FavoriteReview 记录一次片段复习并按三档自评安排下次复习
// rating: 1=不认识（当天再复习）, 2=模糊（1 天后）, 3=认识（按复习次数递增）
func (s *FavoriteService) FavoriteReview(id int, rating int) {
	var reviewCount int
	if err := core.DB.QueryRow("SELECT COALESCE(review_count, 0) FROM favorite_clips WHERE id=?", id).Scan(&reviewCount); err != nil {
		fmt.Fprintf(os.Stderr, "FavoriteReview: %v\n", err)
		return
	}
	var days int
	switch rating {
	case 1:
		days = 0
	case 2:
		days = 1
	default:
		days = 3 * (reviewCount + 1)
		if days > 60 {
			days = 60
		}
	}
	if _, err := core.DB.Exec(
		"UPDATE favorite_clips SET review_count = COALESCE(review_count, 0) + 1, last_reviewed_at = datetime('now','localtime'), next_review = date('now','localtime', ?) WHERE id=?",
		fmt.Sprintf("+%d days", days), id,
	); err != nil {
		fmt.Fprintf(os.Stderr, "FavoriteReview update: %v\n", err)
	}
}

// --- Tags ---

func (s *FavoriteService) FavoriteTagsList() []FavoriteTag {
	rows, err := core.DB.Query("SELECT id, name FROM favorite_tags ORDER BY name ASC")
	if err != nil {
		fmt.Fprintf(os.Stderr, "FavoriteTagsList: %v\n", err)
		return []FavoriteTag{}
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
	return tags
}

func (s *FavoriteService) FavoriteTagAdd(name string) int {
	res, err := core.DB.Exec("INSERT INTO favorite_tags (name) VALUES (?)", name)
	if err != nil {
		fmt.Fprintf(os.Stderr, "FavoriteTagAdd: %v\n", err)
		return 0
	}
	id, _ := res.LastInsertId()
	return int(id)
}

// FavoriteTagDelete 删除标签，并将该标签下片段的 tag_id 置 0
func (s *FavoriteService) FavoriteTagDelete(id int) {
	if _, err := core.DB.Exec("UPDATE favorite_clips SET tag_id=0 WHERE tag_id=?", id); err != nil {
		fmt.Fprintf(os.Stderr, "FavoriteTagDelete clips: %v\n", err)
	}
	if _, err := core.DB.Exec("DELETE FROM favorite_tags WHERE id=?", id); err != nil {
		fmt.Fprintf(os.Stderr, "FavoriteTagDelete: %v\n", err)
	}
}
