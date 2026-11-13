-- name: GetTypingProgress :one
SELECT article_id, mode, position, completed, best_accuracy, best_wpm, updated_at
FROM typing_progress
WHERE article_id = ? AND mode = ?;

-- name: SaveTypingProgress :exec
INSERT OR REPLACE INTO typing_progress
    (article_id, mode, position, completed, best_accuracy, best_wpm, updated_at)
VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'));

-- name: ListTypingRecords :many
SELECT id, article_id, mode, accuracy, wpm, duration, mistakes, created_at
FROM typing_records
WHERE article_id = ?
ORDER BY created_at DESC;

-- name: AddTypingRecord :exec
INSERT INTO typing_records (article_id, mode, accuracy, wpm, duration, mistakes)
VALUES (?, ?, ?, ?, ?, ?);

-- name: ListAllTypingProgress :many
SELECT article_id, mode, position, completed, best_accuracy, best_wpm, updated_at
FROM typing_progress;
