-- name: ListFeeds :many
SELECT f.id, f.url, f.title, f.description, f.image, f.site_url, f.last_fetched_at, f.last_error,
       CAST((SELECT COUNT(*) FROM feed_episodes e WHERE e.feed_id = f.id) AS INTEGER) AS episode_count
FROM feeds f
ORDER BY f.created_at DESC;

-- name: CountFeedByURL :one
SELECT COUNT(*) FROM feeds WHERE url = ?;

-- name: AddFeed :one
INSERT INTO feeds (url, title, description, image, site_url, last_fetched_at)
VALUES (?, ?, ?, ?, ?, ?)
RETURNING id;

-- name: ListFeedIDs :many
SELECT id FROM feeds;

-- name: GetFeedURL :one
SELECT url FROM feeds WHERE id = ?;

-- name: SetFeedError :exec
UPDATE feeds SET last_error = ? WHERE id = ?;

-- name: UpdateFeedMeta :exec
UPDATE feeds
SET title = ?, description = ?, image = ?, site_url = ?, last_fetched_at = ?, last_error = ''
WHERE id = ?;

-- name: DeleteFeedEpisodes :exec
DELETE FROM feed_episodes WHERE feed_id = ?;

-- name: DeleteFeed :execrows
DELETE FROM feeds WHERE id = ?;

-- name: ListFeedEpisodes :many
SELECT id, feed_id, title, description, audio_url, link, duration, published_at, local_path, image
FROM feed_episodes
WHERE feed_id = ?
ORDER BY CASE WHEN published_at = '' THEN 1 ELSE 0 END, published_at DESC
LIMIT ?;

-- name: UpsertFeedEpisode :exec
INSERT INTO feed_episodes (feed_id, guid, title, description, audio_url, link, duration, published_at, image)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(feed_id, guid) DO UPDATE SET
	title = excluded.title,
	description = excluded.description,
	audio_url = excluded.audio_url,
	link = excluded.link,
	duration = excluded.duration,
	published_at = excluded.published_at,
	image = excluded.image;

-- name: GetEpisodeDownloadInfo :one
SELECT feed_id, title, audio_url, local_path FROM feed_episodes WHERE id = ?;

-- name: SetEpisodeLocalPath :exec
UPDATE feed_episodes SET local_path = ? WHERE id = ?;

-- name: GetEpisodeAudioAndLocalPath :one
SELECT audio_url, local_path FROM feed_episodes WHERE id = ?;

-- name: GetEpisodeForSubtitles :one
SELECT feed_id, title, link, audio_url FROM feed_episodes WHERE id = ?;

-- name: GetEpisodeAudioURL :one
SELECT audio_url FROM feed_episodes WHERE id = ?;
