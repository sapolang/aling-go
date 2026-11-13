# sqlc Migration Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish migrating all runtime SQL against `userData.db` to sqlc, under a correctly named `internal/store` package, in three behavior-preserving commits.

**Architecture:** Move the user-DB schema and generated package to `internal/store` (schema embedded and exported as `store.Schema`, consumed by `core`), then migrate favorites/typing/AI-cache/stats and finally feeds — each domain keeping its existing service methods as thin adapters over generated queries.

**Tech Stack:** Go 1.27, sqlc v1.31.1 (sqlite engine), modernc.org/sqlite, Wails v3 (unchanged).

**Spec:** `docs/superpowers/specs/2026-11-13-sqlc-migration-design.md`

## Global Constraints

- sqlc pinned to v1.31.1 (`sqlc.yaml`, CI cache key `*-sqlc-v1.31.1`). Never bump silently.
- Generated code under `internal/store/userdb/` is committed; `go build`/`go test` must not invoke sqlc.
- `internal/store` imports nothing from `internal/core` (dependency direction: `core → store`).
- No Wails service method signatures, model JSON shapes, or frontend changes.
- Go tests run against a real temp SQLite file seeded from `store.Schema`; no mocks.
- Commit messages: Chinese, Conventional Commits (`refactor: ...`), one commit per phase (3 total).
- Every task ends with: `go vet ./... && go test ./...` plus `sqlc generate && git diff --exit-code`.

## Review Focus

1. **Legacy DB without `feed_episodes.link`/`image` columns** — an upgraded install must still list/add episodes; expect the `ALTER TABLE` fallback to add both columns and queries to succeed. Test in Task 5.
2. **Episode upsert must preserve `local_path` on guid conflict** — re-parsing the same RSS must not wipe a downloaded file path. Test in Task 5.
3. **Tag delete must not leave orphan clips** — deleting a `favorite_tag` must detach its clips and delete the tag atomically; a failure in either statement leaves both tables unchanged. Test in Task 3.
4. **Legacy rows with explicit NULL text columns** (an old version could have written NULL despite defaults) — a list query must return the row with empty string/zero, not drop it. Test in Task 3 (favorites list uses `COALESCE` on nullable columns).
5. **Review scheduling caps** — rating 3 with high `review_count` must cap at 60 days; rating 1 keeps next review today. Test in Task 3.

---

### Task 1: Relocate schema and rename the generated package

**Files:**
- Create: `internal/store/schema.sql` (moved verbatim from `internal/core/schema.sql`)
- Create: `internal/store/store.go`
- Create: `internal/store/queries/words.sql` (moved verbatim from `internal/study/sqlc/query.sql`)
- Modify: `sqlc.yaml` (schema/queries/out/package paths)
- Modify: `internal/core/db.go` (consume `store.Schema`, drop `//go:embed`)
- Modify: `internal/study/words_store.go` (import rename only)
- Modify: `internal/study/words_store_test.go` (seed from `store.Schema`)
- Delete: `internal/core/schema.sql`, `internal/study/studydb/`, `internal/study/sqlc/`

**Interfaces:**
- Produces: `store.Schema string` (embedded DDL, used by `core` and all tests); package `userdb` at `internal/store/userdb` with the same generated methods as today (`ListWords`, `AddWord`, `UpdateWord`, `DeleteWord`, `DeleteWords`, `ListReviewWords`, `CountReviewWords`, `SearchWords`, `ListTags`, `AddTag`, `DeleteTag`, `ImportTag`, `AddReviewLog`, `CountReviews`, `CountTodayReviews`, `CountWords`, `CountMasteredWords`, `DailyReviewCounts`, `ListReviewDates`, `ImportWord`, `AddWordsBatch`, `ClearWords`, `ClearTags`); `words_store.go` helper `func queries() *userdb.Queries { return userdb.New(core.DB) }`.

- [ ] **Step 1: Move the schema and create the embed**

`git mv internal/core/schema.sql internal/store/schema.sql`. Create `internal/store/store.go`:

```go
package store

import _ "embed"

// Schema 是用户库的建表语句，运行时建表与 sqlc schema 的唯一来源。
//
//go:embed schema.sql
var Schema string
```

- [ ] **Step 2: Point `core` at `store.Schema`**

In `internal/core/db.go`: remove the `//go:embed schema.sql` block and `_ "embed"` import; import `aling-go/internal/store`; `createTables` becomes `_, err := DB.Exec(store.Schema)`.

- [ ] **Step 3: Rename the sqlc target**

`git mv internal/study/sqlc/query.sql internal/store/queries/words.sql`. In `sqlc.yaml` change `schema: internal/store/schema.sql`, `queries: internal/store/queries`, `package: userdb`, `out: internal/store/userdb` (keep all existing `overrides` verbatim). Run `make sqlc`.

- [ ] **Step 4: Update imports and delete the old package**

`internal/study/words_store.go`: `"aling-go/internal/study/studydb"` → `"aling-go/internal/store/userdb"`, `studydb.` → `userdb.` (helper stays `queries()`). Delete `internal/study/studydb/`. In `internal/study/words_store_test.go` replace the `os.ReadFile("../core/schema.sql")` block with `_, err := db.Exec(store.Schema)` (import `aling-go/internal/store`).

- [ ] **Step 5: Verify**

Run: `go build ./... && go vet ./... && go test ./... && sqlc generate && git diff --exit-code`
Expected: all pass; `sqlc generate` produces no diff.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: 将用户库 schema 与 sqlc 生成包提升为 internal/store"
```

---

### Task 2: Characterization tests for favorites, typing, stats, AI cache

Regression net before any code moves. These tests call the **existing** raw-SQL functions and must pass before Task 3/4 touch them.

**Files:**
- Test: `internal/study/favorite_service_test.go`
- Test: `internal/study/word_service_stats_test.go`
- Test: `internal/content/db_test.go`
- Test: `internal/system/db_test.go`
- Modify: `internal/study/words_store_test.go` (export nothing; `setupTestDB` already usable within package `study`)

**Interfaces:**
- Consumes: `store.Schema`, `setupTestDB(t)` from `words_store_test.go` (same package).
- Produces: test functions `TestFavoriteClipsCRUD`, `TestFavoriteTagDeleteDetachesClips`, `TestFavoriteReviewScheduling`, `TestTypingProgressAndRecords`, `TestStudyStats`, `TestAICache`; helpers `func setupContentDB(t *testing.T)` in `internal/content/db_test.go` and `func setupSystemDB(t *testing.T)` in `internal/system/db_test.go`, each seeding `core.DB` from `store.Schema` (mirrors `setupTestDB`, sets `t.Cleanup` restore).

- [ ] **Step 1: Write the study-side tests**

`internal/study/favorite_service_test.go` (package `study`, reuses `setupTestDB`):

- `TestFavoriteClipsCRUD`: `FavoriteAdd(FavoriteClip{FilePath:"/a/b.mp3", StartTime:1.5, EndTime:3.5, Text:"hi", TagID:0, Word:"hi"})` returns non-zero ID; `FavoriteList(0)` returns 1 clip with `FileName=="b.mp3"`; `FavoriteUpdateTag(id, tagID)` after `FavoriteTagAdd("podcast")` sets `TagID` and `TagName=="podcast"` in `FavoriteList(tagID)`; `FavoriteList(tagID+1)` is empty; `FavoriteDelete(id)` empties the list.
- `TestFavoriteTagDeleteDetachesClips`: add tag (id T), add clip with TagID=T; `FavoriteTagDelete(T)`; assert `FavoriteList(0)[0].TagID == 0` and `FavoriteTagsList()` is empty.
- `TestFavoriteReviewScheduling`: add clip; `FavoriteReview(id, 1)` → `NextReview` equals today's `date('now','localtime')`; insert a fresh clip, `FavoriteReview(id, 2)` → next review is tomorrow; fresh clip with `FavoriteReview(id, 3)` twice (forcing `review_count` growth via a direct `core.DB.Exec` UPDATE to `review_count = 20`) → next review is ≤ 60 days out and ≥ 59 days out (3*(20+1)=63 → capped 60).

`internal/study/word_service_stats_test.go`: seed via `queries().AddReviewLog` (qualities 1,1,3) and `AddWord` (levels 1,3), one `typing_records` row inserted with `core.DB.Exec`; assert `(&WordService{}).GetExtendedStats()` returns `GradeDistribution[1].Count==1` (grade 3), `LevelDistribution` has both levels, and `TypingDaily[0]` date/count match the seeded row.

- [ ] **Step 2: Write the content- and system-side tests**

`internal/content/db_test.go` with `setupContentDB`: 

- `TestTypingProgressAndRecords`: `dbSaveTypingProgress(TypingProgress{ArticleID:1, Mode:"en", Position:5, Completed:true, BestAccuracy:99.5, BestWPM:120})`; `dbGetTypingProgress(1,"en")` returns it with `Completed==true` and non-empty `UpdatedAt`; saving again with `Position:9, Completed:false` replaces the row (list length still 1). `dbSaveTypingRecord` twice for article 1 → `dbGetTypingRecords(1)` ordered by `created_at DESC` (2 rows); `dbGetAllTypingProgress` length 1.

`internal/system/db_test.go` with `setupSystemDB`:

- `TestAICache`: `aiCachePut("h1","translate","gpt","src","tgt")`; `aiCacheGet("h1")` returns `("tgt",true)`; `aiCachePut("h1",...)` with new target overwrites; `aiCacheGet("missing")` returns `("",false)`.

- [ ] **Step 3: Run tests to verify they pass against current code**

Run: `go test ./internal/study/ ./internal/content/ ./internal/system/ -v`
Expected: PASS (they characterize existing raw-SQL behavior).

- [ ] **Step 4: Commit**

```bash
git add internal/study/favorite_service_test.go internal/study/word_service_stats_test.go internal/content/db_test.go internal/system/db_test.go
git commit -m "test: 补充收藏/打字/统计/AI 缓存的行为测试"
```

---

### Task 3: Migrate favorites to sqlc

**Files:**
- Create: `internal/store/queries/favorites.sql`
- Modify: `sqlc.yaml` (add `favorite_clips`/`favorite_tags` column overrides)
- Modify: `internal/study/favorite_service.go`
- Test: `internal/study/favorite_service_test.go` (unchanged assertions; only re-verify)

**Interfaces:**
- Consumes: `queries()` helper and `userdb` from Task 1 (same package `study`).
- Produces: generated `userdb` methods `ListFavoriteClips()`, `ListFavoriteClipsByTag(tagID)`, `AddFavoriteClip(params) :one` (returns `int64` id via `RETURNING id`), `DeleteFavoriteClip(id)`, `UpdateFavoriteClipTag(params)`, `GetFavoriteClipReviewCount(id) :one`, `ReviewFavoriteClip(params)`, `ListFavoriteTags()`, `AddFavoriteTag(name) :one`, `DeleteFavoriteTag(id)`, `DetachClipsFromTag(tagID)`; adapters in `favorite_service.go`: `toFavoriteClip(row userdb.ListFavoriteClipsRow) FavoriteClip`, `toFavoriteTags(rows []userdb.ListFavoriteTagsRow) []FavoriteTag`.

- [ ] **Step 1: Write `favorites.sql`**

List selects wrap every nullable column in `COALESCE(col, '')` / `COALESCE(col, 0)` (Review Focus #4), alias the joined tag name as `tag_name`, and keep `ORDER BY c.created_at DESC`:

```sql
-- name: ListFavoriteClips :many
SELECT c.id, c.file_path, c.start_time, c.end_time,
       COALESCE(c.text, '') AS text, c.tag_id, COALESCE(t.name, '') AS tag_name,
       COALESCE(c.word, '') AS word, COALESCE(c.review_count, 0) AS review_count,
       COALESCE(c.last_reviewed_at, '') AS last_reviewed_at,
       COALESCE(c.next_review, '') AS next_review, c.created_at
FROM favorite_clips c LEFT JOIN favorite_tags t ON t.id = c.tag_id
ORDER BY c.created_at DESC;
```

`ListFavoriteClipsByTag` is the same with `WHERE c.tag_id = ?`. The remaining queries mirror today's statements verbatim (`AddFavoriteClip` ends with `RETURNING id`; `ReviewFavoriteClip` keeps `review_count = COALESCE(review_count,0)+1, last_reviewed_at = datetime('now','localtime'), next_review = date('now','localtime', ?)` with the `+N days` string as a parameter; `AddFavoriteTag` returns `RETURNING id`).

- [ ] **Step 2: Generate and add overrides if needed**

Run `make sqlc`. If `tag_name`, `review_count`, or aggregates infer as pointers/`interface{}`, add output-column overrides in `sqlc.yaml` (`column: "tag_name"`, `go_type: string`, etc.). `favorite_clips.id/tag_id/review_count` and `favorite_tags.id` get `go_type: int` overrides; remaining nullable columns get `string`/`int`/`float64` non-pointer overrides.

- [ ] **Step 3: Rewrite `favorite_service.go` as adapters**

Same exported methods and signatures; bodies call `queries().<Method>(context.Background(), ...)` and convert via the adapters. `FavoriteTagDelete` becomes one transaction (Review Focus #3):

```go
tx, err := core.DB.Begin()
if err != nil { ...log... return }
q := queries().WithTx(tx)
q.DetachClipsFromTag(ctx, id)
q.DeleteFavoriteTag(ctx, id)
tx.Commit() // on error from either query: tx.Rollback() and log
```

Log-and-continue error semantics stay identical (`fmt.Fprintf(os.Stderr, ...)`).

- [ ] **Step 4: Verify**

Run: `go test ./internal/study/ -run 'TestFavorite' -v && go vet ./... && sqlc generate && git diff --exit-code`
Expected: PASS (Task 2 assertions unchanged).

- [ ] **Step 5: Commit**

```bash
git add internal/store/queries/favorites.sql sqlc.yaml internal/study/favorite_service.go internal/store/userdb/
git commit -m "refactor: 迁移收藏模块到 sqlc 并将删标签收进事务"
```

---

### Task 4: Migrate typing, AI cache, and study stats to sqlc

**Files:**
- Create: `internal/store/queries/typing.sql`, `internal/store/queries/ai_cache.sql`, `internal/store/queries/study_stats.sql`
- Modify: `sqlc.yaml` (overrides for `typing_records`, `typing_progress`, `ai_translations`)
- Modify: `internal/content/article_store.go` (typing functions only — categories/articles stay raw)
- Modify: `internal/system/translate_service.go` (cache functions only)
- Modify: `internal/study/word_service.go` (the three `query*` stats functions)
- Test: Task 2 tests re-run unchanged

**Interfaces:**
- Consumes: `userdb` from Task 1; `setupContentDB` from Task 2.
- Produces: content helper in `article_store.go`: `func q() *userdb.Queries { return userdb.New(core.DB) }`; system helper in `translate_service.go`: `func aiQueries() *userdb.Queries`. Generated methods: `GetTypingProgress(articleID, mode) :one`, `SaveTypingProgress(params)`, `ListTypingRecords(articleID)`, `AddTypingRecord(params)`, `ListAllTypingProgress()`, `GetAICache(hash) :one`, `PutAICache(params)`, `GradeDistribution()`, `LevelDistribution()`, `TypingDailyStats()`. Adapters: `toTypingProgress(row) *TypingProgress`, `toTypingRecords(rows) []TypingRecord`, `toGradeCounts`, `toLevelCounts`, `toTypingDayStats`.

- [ ] **Step 1: Write the query files**

`typing.sql`: `GetTypingProgress` (`WHERE article_id=? AND mode=?`, returns `sql.ErrNoRows` at the adapter for the current `nil` result), `SaveTypingProgress` (`INSERT OR REPLACE ... VALUES (?,?,?,?,?,?, datetime('now','localtime'))` — `completed` stays `boolToInt` at the call site), `ListTypingRecords` (`WHERE article_id=? ORDER BY created_at DESC`), `AddTypingRecord`, `ListAllTypingProgress`.

`ai_cache.sql`: `GetAICache` (`SELECT target FROM ai_translations WHERE hash = ?`), `PutAICache` (`INSERT OR REPLACE INTO ai_translations (hash, kind, model, source, target)`).

`study_stats.sql`: `GradeDistribution` (`SELECT quality AS grade, COUNT(*) AS count FROM review_logs GROUP BY quality ORDER BY quality`), `LevelDistribution` (same shape on `words.level`), `TypingDailyStats` (verbatim today's 30-day window query with aliases `d, count, avg_accuracy, avg_wpm, total_duration`; wrap expressions in `CAST(... AS INTEGER)` / `CAST(... AS REAL)` if inference is poor).

- [ ] **Step 2: Generate and set overrides**

Run `make sqlc`; add `go_type` overrides for `typing_records.id/article_id/duration` → `int`, `typing_progress.article_id/position/completed` → `int`, `ai_translations.kind/model/created_at` → `string`, and any aggregate alias columns that need pinning.

- [ ] **Step 3: Rewrite the three call sites as adapters**

- `article_store.go`: only `dbGetTypingProgress`, `dbSaveTypingProgress`, `dbGetTypingRecords`, `dbSaveTypingRecord`, `dbGetAllTypingProgress` change bodies; `dbGetCategories`/`dbGetArticles`/`dbGetArticle` stay on `core.ArticleDB` raw SQL.
- `translate_service.go`: `aiCacheGet`/`aiCachePut` call `aiQueries()`; `aiCacheGet` maps `sql.ErrNoRows`/empty target to `("", false)`.
- `word_service.go`: `queryGradeDistribution`, `queryLevelDistribution`, `queryTypingDailyStats` become generated calls + adapters, preserving the "log to stderr, return empty slice" error behavior.

- [ ] **Step 4: Verify**

Run: `go test ./internal/study/ ./internal/content/ ./internal/system/ -v && go vet ./... && go test ./... && sqlc generate && git diff --exit-code`
Expected: PASS.

- [ ] **Step 5: Commit (with Task 3's commit this is design commit 2)**

```bash
git add internal/store/queries/ sqlc.yaml internal/content/article_store.go internal/system/translate_service.go internal/study/word_service.go internal/store/userdb/
git commit -m "refactor: 迁移打字进度/AI 缓存/扩展统计到 sqlc"
```

---

### Task 5: Migrate feeds and unify the schema

**Files:**
- Modify: `internal/store/schema.sql` (append `feeds`, `feed_episodes` DDL + index)
- Modify: `internal/content/feed_service.go`
- Modify: `internal/content/platform_service.go` (two episode lookups)
- Modify: `internal/content/media_service.go` (one episode lookup)
- Create: `internal/store/queries/feeds.sql`
- Modify: `sqlc.yaml` (overrides for `feeds`/`feed_episodes`)
- Test: `internal/content/db_test.go`

**Interfaces:**
- Consumes: content `q()` helper from Task 4.
- Produces: generated methods `ListFeeds()`, `CountFeedByURL(url) :one`, `AddFeed(params) :one`, `ListFeedIDs()`, `GetFeedURL(id) :one`, `SetFeedError(params)`, `UpdateFeedMeta(params)`, `DeleteFeedEpisodes(feedID)`, `DeleteFeed(feedID)`, `ListFeedEpisodes(params)` (feedID + limit), `UpsertFeedEpisode(params)`, `GetEpisodeDownloadInfo(id) :one`, `SetEpisodeLocalPath(params)`, `GetEpisodeAudioAndLocalPath(id) :one`, `GetEpisodeForSubtitles(id) :one`, `GetEpisodeAudioURL(id) :one`; `feed_service.go` replaces `ensureTables()` with `migrateFeedColumns()`.

- [ ] **Step 1: Move the DDL into the schema**

Append to `internal/store/schema.sql` the `feeds` and `feed_episodes` `CREATE TABLE IF NOT EXISTS` statements **with `link` and `image` columns included** plus `idx_feed_episodes_feed`. In `feed_service.go`, replace `ensureTables` with `migrateFeedColumns` that runs only the two `ALTER TABLE feed_episodes ADD COLUMN link/image TEXT DEFAULT ''` statements and ignores errors (Review Focus #1 — old DBs need them; `CREATE TABLE IF NOT EXISTS` will not add columns to existing tables). `ServiceStartup` calls `migrateFeedColumns`.

- [ ] **Step 2: Write `feeds.sql`**

Statements mirror today's SQL verbatim: `ListFeeds` keeps the correlated `(SELECT COUNT(*) FROM feed_episodes e WHERE e.feed_id = f.id) AS episode_count` and `ORDER BY f.created_at DESC`; `ListFeedEpisodes` keeps `ORDER BY CASE WHEN published_at = '' THEN 1 ELSE 0 END, published_at DESC LIMIT ?`; `UpsertFeedEpisode` keeps the full `ON CONFLICT(feed_id, guid) DO UPDATE SET` clause (it does **not** touch `local_path` — Review Focus #2). `AddFeed` returns `RETURNING id`; `CountFeedByURL` is `SELECT COUNT(*) FROM feeds WHERE url = ?`.

- [ ] **Step 3: Generate and set overrides**

Run `make sqlc`; overrides: `feeds.id`/`feed_episodes.id`/`feed_id` stay `int64` (default), `feeds.episode_count` → `int`, `feed_episodes.duration` → `int`; nullable text columns → `string` via `COALESCE` in selects where needed.

- [ ] **Step 4: Rewrite call sites**

- `feed_service.go`: all feed/episode statements become `q()` calls; `saveEpisodes` becomes one transaction looping `UpsertFeedEpisode`; `refreshAll` uses `ListFeedIDs`.
- `platform_service.go` `TranscribePodcast` uses `GetEpisodeAudioAndLocalPath`; `GetSubtitles` uses `GetEpisodeForSubtitles`.
- `media_service.go` `handlePodcastStream` uses `GetEpisodeAudioURL`.
- Error strings and "not found" mapping (`sql.ErrNoRows` → `"节目不存在"` etc.) are preserved exactly.

- [ ] **Step 5: Add the migration and upsert tests**

In `internal/content/db_test.go`:

- `TestLegacyFeedColumnsMigration`: create a temp DB, run only a legacy `CREATE TABLE feed_episodes (...)` **without** `link`/`image` plus the `feeds` table, set `core.DB`, call `migrateFeedColumns` via a `FeedService{}`; then `FeedAdd`-style insert and `ListFeedEpisodes` succeed.
- `TestUpsertFeedEpisodePreservesLocalPath`: add feed + episodes via `saveEpisodes`; set `local_path` via `SetEpisodeLocalPath`; re-run `saveEpisodes` with the same guids but different titles; assert `local_path` survives and `title` updated, `FeedList` count stays 1 feed.

- [ ] **Step 6: Verify**

Run: `go vet ./... && go test ./... && sqlc generate && git diff --exit-code`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: 迁移订阅源数据访问并统一 schema"
```
