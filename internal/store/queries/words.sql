-- name: ListWords :many
SELECT id, word, definition, phonetic, example, tags, level, next_review,
       created_at, updated_at, repetitions, efactor, interval
FROM words
ORDER BY created_at DESC;

-- name: AddWord :one
INSERT INTO words (word, definition, phonetic, example, tags, level, next_review,
                   repetitions, efactor, interval)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
RETURNING id;

-- name: UpdateWord :exec
UPDATE words
SET word=?, definition=?, phonetic=?, example=?, tags=?, level=?, next_review=?,
    repetitions=?, efactor=?, interval=?, updated_at=datetime('now','localtime')
WHERE id=?;

-- name: DeleteWord :exec
DELETE FROM words WHERE id = ?;

-- name: DeleteWords :exec
DELETE FROM words WHERE id IN (sqlc.slice('ids'));

-- name: ListReviewWords :many
SELECT id, word, definition, phonetic, example, tags, level, next_review,
       created_at, updated_at, repetitions, efactor, interval
FROM words
WHERE next_review <= ?
ORDER BY next_review ASC;

-- name: CountReviewWords :one
SELECT COUNT(*) FROM words WHERE next_review <= ?;

-- name: SearchWords :many
SELECT id, word, definition, phonetic, example, tags, level, next_review,
       created_at, updated_at, repetitions, efactor, interval
FROM words
WHERE word LIKE ? OR definition LIKE ?
ORDER BY word ASC;

-- name: ListTags :many
SELECT id, name, color FROM tags ORDER BY name ASC;

-- name: AddTag :one
INSERT INTO tags (name, color) VALUES (?, ?) RETURNING id;

-- name: DeleteTag :exec
DELETE FROM tags WHERE id = ?;

-- name: ImportTag :exec
INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?);

-- name: AddReviewLog :exec
INSERT INTO review_logs (word_id, quality) VALUES (?, ?);

-- name: CountReviews :one
SELECT COUNT(*) FROM review_logs;

-- name: CountTodayReviews :one
SELECT COUNT(*) FROM review_logs
WHERE substr(reviewed_at, 1, 10) = date('now','localtime');

-- name: CountWords :one
SELECT COUNT(*) FROM words;

-- name: CountMasteredWords :one
SELECT COUNT(*) FROM words WHERE repetitions >= 3;

-- name: DailyReviewCounts :many
SELECT substr(reviewed_at, 1, 10) AS review_date, COUNT(*) AS count
FROM review_logs
WHERE substr(reviewed_at, 1, 10) >= date('now','localtime','-29 days')
GROUP BY review_date;

-- name: ListReviewDates :many
SELECT DISTINCT substr(reviewed_at, 1, 10) AS review_date FROM review_logs;

-- name: ImportWord :exec
INSERT OR IGNORE INTO words (word, definition, phonetic, example, tags, level, next_review,
                             repetitions, efactor, interval)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);

-- name: AddWordsBatch :execrows
INSERT OR IGNORE INTO words (word, definition, phonetic) VALUES (?, ?, ?);

-- name: AddDictWord :execrows
INSERT OR IGNORE INTO words (word, definition, phonetic, tags) VALUES (?, ?, ?, ?);

-- name: ClearWords :exec
DELETE FROM words;

-- name: ClearTags :exec
DELETE FROM tags;
