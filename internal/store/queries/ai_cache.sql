-- name: GetAICache :one
SELECT target FROM ai_translations WHERE hash = ?;

-- name: PutAICache :exec
INSERT OR REPLACE INTO ai_translations (hash, kind, model, source, target)
VALUES (?, ?, ?, ?, ?);
