-- name: GradeDistribution :many
SELECT quality AS grade, COUNT(*) AS count
FROM review_logs
GROUP BY quality
ORDER BY quality;

-- name: LevelDistribution :many
SELECT level, COUNT(*) AS count
FROM words
GROUP BY level
ORDER BY level;

-- name: TypingDailyStats :many
SELECT substr(created_at, 1, 10) AS d,
       COUNT(*) AS count,
       CAST(COALESCE(AVG(accuracy), 0) AS REAL) AS avg_accuracy,
       CAST(COALESCE(AVG(wpm), 0) AS REAL) AS avg_wpm,
       CAST(COALESCE(SUM(duration), 0) AS INTEGER) AS total_duration
FROM typing_records
WHERE substr(created_at, 1, 10) >= date('now','localtime','-29 days')
GROUP BY d
ORDER BY d;
