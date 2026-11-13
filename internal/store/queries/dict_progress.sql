-- name: GetDictProgress :one
SELECT current_index FROM dict_progress WHERE tag = ?;

-- name: SaveDictProgress :exec
INSERT OR REPLACE INTO dict_progress (tag, current_index, updated_at)
VALUES (?, ?, datetime('now','localtime'));
