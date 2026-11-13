-- name: ListFavoriteClips :many
SELECT c.id, c.file_path, c.start_time, c.end_time,
       COALESCE(c.text, '') AS text,
       COALESCE(c.tag_id, 0) AS tag_id,
       COALESCE(t.name, '') AS tag_name,
       COALESCE(c.word, '') AS word,
       COALESCE(c.review_count, 0) AS review_count,
       COALESCE(c.last_reviewed_at, '') AS last_reviewed_at,
       COALESCE(c.next_review, '') AS next_review,
       COALESCE(c.created_at, '') AS created_at
FROM favorite_clips c
LEFT JOIN favorite_tags t ON t.id = c.tag_id
ORDER BY c.created_at DESC;

-- name: ListFavoriteClipsByTag :many
SELECT c.id, c.file_path, c.start_time, c.end_time,
       COALESCE(c.text, '') AS text,
       COALESCE(c.tag_id, 0) AS tag_id,
       COALESCE(t.name, '') AS tag_name,
       COALESCE(c.word, '') AS word,
       COALESCE(c.review_count, 0) AS review_count,
       COALESCE(c.last_reviewed_at, '') AS last_reviewed_at,
       COALESCE(c.next_review, '') AS next_review,
       COALESCE(c.created_at, '') AS created_at
FROM favorite_clips c
LEFT JOIN favorite_tags t ON t.id = c.tag_id
WHERE c.tag_id = ?
ORDER BY c.created_at DESC;

-- name: AddFavoriteClip :one
INSERT INTO favorite_clips (file_path, start_time, end_time, text, tag_id, word)
VALUES (?, ?, ?, ?, ?, ?)
RETURNING id;

-- name: DeleteFavoriteClip :exec
DELETE FROM favorite_clips WHERE id = ?;

-- name: UpdateFavoriteClipTag :exec
UPDATE favorite_clips SET tag_id = ? WHERE id = ?;

-- name: GetFavoriteClipReviewCount :one
SELECT COALESCE(review_count, 0) FROM favorite_clips WHERE id = ?;

-- name: ReviewFavoriteClip :exec
UPDATE favorite_clips
SET review_count = COALESCE(review_count, 0) + 1,
    last_reviewed_at = datetime('now','localtime'),
    next_review = date('now','localtime', CAST(sqlc.arg(days_modifier) AS TEXT))
WHERE id = ?;

-- name: ListFavoriteTags :many
SELECT id, name FROM favorite_tags ORDER BY name ASC;

-- name: AddFavoriteTag :one
INSERT INTO favorite_tags (name) VALUES (?) RETURNING id;

-- name: DeleteFavoriteTag :exec
DELETE FROM favorite_tags WHERE id = ?;

-- name: DetachClipsFromTag :exec
UPDATE favorite_clips SET tag_id = 0 WHERE tag_id = ?;
