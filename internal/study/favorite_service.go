package study

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"aling-go/internal/core"
	"aling-go/internal/store/userdb"

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
	ctx := context.Background()
	var (
		clips []FavoriteClip
		err   error
	)
	if tagID > 0 {
		rows, qerr := queries().ListFavoriteClipsByTag(ctx, tagID)
		err = qerr
		clips = make([]FavoriteClip, 0, len(rows))
		for _, row := range rows {
			clips = append(clips, toFavoriteClipByTag(row))
		}
	} else {
		rows, qerr := queries().ListFavoriteClips(ctx)
		err = qerr
		clips = make([]FavoriteClip, 0, len(rows))
		for _, row := range rows {
			clips = append(clips, toFavoriteClip(row))
		}
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "FavoriteList: %v\n", err)
		return []FavoriteClip{}
	}
	return clips
}

// FavoriteAdd 新增收藏片段，返回新记录 ID
func (s *FavoriteService) FavoriteAdd(c FavoriteClip) int {
	id, err := queries().AddFavoriteClip(context.Background(), userdb.AddFavoriteClipParams{
		FilePath:  c.FilePath,
		StartTime: c.StartTime,
		EndTime:   c.EndTime,
		Text:      c.Text,
		TagID:     c.TagID,
		Word:      c.Word,
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "FavoriteAdd: %v\n", err)
		return 0
	}
	return id
}

func (s *FavoriteService) FavoriteDelete(id int) {
	if err := queries().DeleteFavoriteClip(context.Background(), id); err != nil {
		fmt.Fprintf(os.Stderr, "FavoriteDelete: %v\n", err)
	}
}

// FavoriteUpdateTag 修改片段所属标签（tagID=0 表示移除标签）
func (s *FavoriteService) FavoriteUpdateTag(id int, tagID int) {
	if err := queries().UpdateFavoriteClipTag(context.Background(), userdb.UpdateFavoriteClipTagParams{
		TagID: tagID,
		ID:    id,
	}); err != nil {
		fmt.Fprintf(os.Stderr, "FavoriteUpdateTag: %v\n", err)
	}
}

// FavoriteReview 记录一次片段复习并按三档自评安排下次复习
// rating: 1=不认识（当天再复习）, 2=模糊（1 天后）, 3=认识（按复习次数递增）
func (s *FavoriteService) FavoriteReview(id int, rating int) {
	ctx := context.Background()
	reviewCount, err := queries().GetFavoriteClipReviewCount(ctx, id)
	if err != nil {
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
		days = 3 * (int(reviewCount) + 1)
		if days > 60 {
			days = 60
		}
	}
	if err := queries().ReviewFavoriteClip(ctx, userdb.ReviewFavoriteClipParams{
		DaysModifier: fmt.Sprintf("+%d days", days),
		ID:           id,
	}); err != nil {
		fmt.Fprintf(os.Stderr, "FavoriteReview update: %v\n", err)
	}
}

// --- Tags ---

func (s *FavoriteService) FavoriteTagsList() []FavoriteTag {
	rows, err := queries().ListFavoriteTags(context.Background())
	if err != nil {
		fmt.Fprintf(os.Stderr, "FavoriteTagsList: %v\n", err)
		return []FavoriteTag{}
	}
	tags := make([]FavoriteTag, 0, len(rows))
	for _, row := range rows {
		tags = append(tags, FavoriteTag{ID: row.ID, Name: row.Name})
	}
	return tags
}

func (s *FavoriteService) FavoriteTagAdd(name string) int {
	id, err := queries().AddFavoriteTag(context.Background(), name)
	if err != nil {
		fmt.Fprintf(os.Stderr, "FavoriteTagAdd: %v\n", err)
		return 0
	}
	return id
}

// FavoriteTagDelete 删除标签，并将该标签下片段的 tag_id 置 0
func (s *FavoriteService) FavoriteTagDelete(id int) {
	ctx := context.Background()
	tx, err := core.DB.Begin()
	if err != nil {
		fmt.Fprintf(os.Stderr, "FavoriteTagDelete: %v\n", err)
		return
	}
	q := userdb.New(tx)
	if err := q.DetachClipsFromTag(ctx, id); err != nil {
		fmt.Fprintf(os.Stderr, "FavoriteTagDelete clips: %v\n", err)
		_ = tx.Rollback()
		return
	}
	if err := q.DeleteFavoriteTag(ctx, id); err != nil {
		fmt.Fprintf(os.Stderr, "FavoriteTagDelete: %v\n", err)
		_ = tx.Rollback()
		return
	}
	if err := tx.Commit(); err != nil {
		fmt.Fprintf(os.Stderr, "FavoriteTagDelete commit: %v\n", err)
	}
}

// --- Row adapters ---

func newFavoriteClip(id int, filePath string, startTime, endTime float64, text string,
	tagID int, tagName, word string, reviewCount int, lastReviewedAt, nextReview, createdAt string) FavoriteClip {
	return FavoriteClip{
		ID:             id,
		FilePath:       filePath,
		FileName:       filepath.Base(filePath),
		StartTime:      startTime,
		EndTime:        endTime,
		Text:           text,
		TagID:          tagID,
		TagName:        tagName,
		Word:           word,
		ReviewCount:    reviewCount,
		LastReviewedAt: lastReviewedAt,
		NextReview:     nextReview,
		CreatedAt:      createdAt,
	}
}

func toFavoriteClip(r userdb.ListFavoriteClipsRow) FavoriteClip {
	return newFavoriteClip(r.ID, r.FilePath, r.StartTime, r.EndTime, r.Text,
		r.TagID, r.TagName, r.Word, r.ReviewCount, r.LastReviewedAt, r.NextReview, r.CreatedAt)
}

func toFavoriteClipByTag(r userdb.ListFavoriteClipsByTagRow) FavoriteClip {
	return newFavoriteClip(r.ID, r.FilePath, r.StartTime, r.EndTime, r.Text,
		r.TagID, r.TagName, r.Word, r.ReviewCount, r.LastReviewedAt, r.NextReview, r.CreatedAt)
}
