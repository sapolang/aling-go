-- name: UpsertHistory :exec
INSERT INTO play_history (media_key, kind, title, cover, source_url, episode_id, position, duration, play_count, last_played_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now','localtime'))
ON CONFLICT(media_key) DO UPDATE SET
	kind = excluded.kind,
	title = CASE WHEN excluded.title <> '' THEN excluded.title ELSE play_history.title END,
	cover = CASE WHEN excluded.cover <> '' THEN excluded.cover ELSE play_history.cover END,
	source_url = CASE WHEN excluded.source_url <> '' THEN excluded.source_url ELSE play_history.source_url END,
	episode_id = CASE WHEN excluded.episode_id <> 0 THEN excluded.episode_id ELSE play_history.episode_id END,
	duration = CASE WHEN excluded.duration > 0 THEN excluded.duration ELSE play_history.duration END,
	play_count = play_history.play_count + 1,
	last_played_at = datetime('now','localtime');

-- name: UpdateHistoryPosition :exec
UPDATE play_history
SET position = sqlc.arg(position),
    duration = CASE WHEN CAST(sqlc.arg(duration) AS REAL) > 0 THEN CAST(sqlc.arg(duration) AS REAL) ELSE duration END,
    last_played_at = datetime('now','localtime')
WHERE media_key = sqlc.arg(media_key);

-- name: ListHistory :many
SELECT media_key, kind, title, cover, source_url, episode_id, position, duration, play_count, last_played_at
FROM play_history
WHERE (CAST(sqlc.arg(kind) AS TEXT) = '' OR kind = CAST(sqlc.arg(kind) AS TEXT))
ORDER BY last_played_at DESC
LIMIT sqlc.arg(lim) OFFSET sqlc.arg(off);

-- name: ListContinueLearning :many
SELECT media_key, kind, title, cover, source_url, episode_id, position, duration, play_count, last_played_at
FROM play_history
WHERE duration > 0 AND position > 30 AND position < duration * 0.95
ORDER BY last_played_at DESC
LIMIT sqlc.arg(lim);

-- name: GetHistory :one
SELECT media_key, kind, title, cover, source_url, episode_id, position, duration, play_count, last_played_at
FROM play_history
WHERE media_key = ?;

-- name: DeleteHistory :exec
DELETE FROM play_history WHERE media_key = ?;

-- name: ClearHistory :exec
DELETE FROM play_history;

-- name: TrimHistory :exec
DELETE FROM play_history
WHERE media_key NOT IN (
	SELECT media_key FROM play_history ORDER BY last_played_at DESC LIMIT sqlc.arg(keep)
);
