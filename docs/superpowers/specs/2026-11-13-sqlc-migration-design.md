# sqlc Migration Phase 2: Unified User-Data Access Layer

## Intent

The sqlc pilot (commit `0eee404`) migrated only the words/tags module and left the
generated package named `studydb` under `internal/study/`. Roughly 50 hand-written SQL
statements against the writable user database (`userData.db`) remain in
`internal/study`, `internal/content`, and `internal/system`.

Finish that migration: one schema source for the whole user database, one generated
package named for what it actually is, and every remaining runtime query against
`userData.db` going through sqlc — with no change in runtime behavior or Wails bindings.

## Goals

- Every table of `userData.db` is declared in one schema file that both runtime
  bootstrap and sqlc read.
- Favorites, typing progress/records, AI cache, study statistics, and feeds use
  generated, typed queries.
- CI keeps failing when generated code drifts from SQL.
- `make sqlc` remains the only regeneration step; builds never require sqlc.

## Non-goals

- Read-only `articles.db` queries (`internal/content/article_store.go` categories/articles).
- Read-only `dict.db` queries and `dict_progress` (`internal/dict/dict.go`).
- The standalone tools `cmd/articles-download` and `cmd/dict-build`.
- Wails service signatures, JSON shapes, or any frontend change.

## Anti-goals

- Changing user-visible behavior: error strings, ordering, defaults, empty-slice vs
  null semantics, or time formats.
- Introducing a hand-written repository/DAO layer on top of the generated code.
- Making `migrate.go`'s dynamic DDL fit sqlc at the cost of clarity.

## Constraints

- sqlc v1.31.1, engine `sqlite` (matches CI cache key).
- Generated code is committed; build and tests must not invoke sqlc.
- `createTables()` must still create every table for a brand-new install.
- Existing databases predate some columns (notably `feed_episodes.link`/`image`), so
  `CREATE TABLE IF NOT EXISTS` cannot replace the `ALTER TABLE` fallbacks.
- Go tests run against a real temporary SQLite file, not mocks.

## Approaches Considered

**A. Extend in place.** Add queries to the current `sqlc.yaml`, keep generating into
`internal/study/studydb`, and let `content`/`system` import it. Smallest diff, but a
package named `studydb` owning feeds and AI cache is misleading and makes layering
worse over time.

**B. Relocate first, then migrate (chosen).** Move schema and generated package to
`internal/store` (`schema.sql`, `userdb/`), update the words module, then migrate the
remaining domains in two batches. Costs one extra rename commit, leaves no naming debt.

**C. Only finish the study domain.** Favorites plus statistics now, everything else
later. Cheapest now, but feeds and typing would need the same exercise again soon.

B is chosen: the rename is purely mechanical and reviewable on its own, while A's
naming debt would spread to every new caller.

## Design

### 1. Package layout

```
internal/store/
  schema.sql          # single schema source (moved from internal/core/schema.sql)
  store.go            # //go:embed schema.sql; var Schema string
  queries/
    words.sql         # moved from internal/study/sqlc/query.sql
    favorites.sql
    typing.sql
    ai_cache.sql
    study_stats.sql
    feeds.sql
  userdb/             # sqlc output (replaces internal/study/studydb)
```

`internal/store` embeds the schema and exports it as a string; `internal/core/db.go`
calls `DB.Exec(store.Schema)`. The dependency direction is `core → store`; `store`
imports nothing but `embed`. The generated `store/userdb` package imports only
`database/sql`, so no cycle exists. `go:embed` cannot reach a parent directory, which
is why the schema lives in `store` rather than staying in `core`.

`sqlc.yaml` becomes:

```yaml
version: "2"
sql:
  - engine: "sqlite"
    schema: "internal/store/schema.sql"
    queries: "internal/store/queries"
    gen:
      go:
        package: "userdb"
        out: "internal/store/userdb"
        emit_interface: true
        emit_empty_slices: true
        emit_pointers_for_null_types: true
        overrides: ...   # see type mapping
```

`internal/study/studydb/` and `internal/study/sqlc/` are deleted. `words_store.go`
imports `internal/store/userdb`; `words_store_test.go` seeds its temp database from
`store.Schema` instead of reading `../core/schema.sql`.

Consumers keep a tiny per-package helper (`func q() *userdb.Queries {
return userdb.New(core.DB) }`) because `store` must not import `core`. This mirrors the
existing `queries()` helper in `internal/study`.

### 2. Type mapping

The goal is for generated row types to drop into existing adapter functions without
changing the app's models.

- Primary keys and foreign keys that flow into `int` fields get `go_type: int` overrides
  (`favorite_clips.id/tag_id`, `favorite_tags.id`, `typing_records.id/article_id`,
  `typing_progress.article_id`, plus existing words/tags overrides).
- Nullable `TEXT/INTEGER/REAL` columns on tables we migrate get non-pointer overrides
  (`string`/`int`/`float64`), matching what the current `rows.Scan` does. Existing
  databases already store empty strings / zeros via column defaults; no NULLs are
  written by the application.
- Computed columns (`COUNT(*)`, `COALESCE(...)`, `substr(...)`) are given explicit
  aliases and, where sqlc infers an unhelpful type, wrapped in `CAST(... AS INTEGER)` /
  `CAST(... AS TEXT)`.
- Feed IDs stay `int64`, matching current signatures (`FeedID int64`).
- Adapter functions (`toFavoriteClip`, `toFeed`, `toTypingProgress`, …) convert generated
  structs to the existing model types. Models and Wails signatures are untouched.

### 3. Query inventory

| File | Queries | Notes |
|------|---------|-------|
| `favorites.sql` | `ListFavoriteClips`, `ListFavoriteClipsByTag`, `AddFavoriteClip`, `DeleteFavoriteClip`, `UpdateFavoriteClipTag`, `GetFavoriteClipReviewCount`, `ReviewFavoriteClip`, `ListFavoriteTags`, `AddFavoriteTag`, `DeleteFavoriteTag`, `DetachClipsFromTag` | 11 statements, replacing dynamic concatenation with two list variants |
| `typing.sql` | `GetTypingProgress`, `SaveTypingProgress`, `ListTypingRecords`, `AddTypingRecord`, `ListAllTypingProgress` | `INSERT OR REPLACE` and `boolToInt` stay at the call site |
| `ai_cache.sql` | `GetAICache`, `PutAICache` | `INSERT OR REPLACE` |
| `study_stats.sql` | `GradeDistribution`, `LevelDistribution`, `TypingDailyStats` | aggregates; fixed windows as today |
| `feeds.sql` | `ListFeeds`, `CountFeedByURL`, `AddFeed`, `ListFeedIDs`, `GetFeedURL`, `SetFeedError`, `UpdateFeedMeta`, `DeleteFeedEpisodes`, `DeleteFeed`, `ListFeedEpisodes`, `UpsertFeedEpisode`, `GetEpisodeDownloadInfo`, `SetEpisodeLocalPath`, `GetEpisodeAudioAndLocalPath`, `GetEpisodeForSubtitles`, `GetEpisodeAudioURL` | episode lookups from `platform_service.go` and `media_service.go` included |

### 4. Behavior parity

- `FavoriteTagDelete` currently issues two independent writes. It becomes one
  transaction using `userdb.New(tx)` / `WithTx`, fixing a partial-delete window. This is
  the only intentional behavior change; note it in the commit body.
- `AddFavoriteClip`, `AddFavoriteTag`, `AddFeed` use `RETURNING id` (`:one`) instead of
  `LastInsertId`. If generated SQLite code rejects `RETURNING`, fall back to a
  `:execrows` insert plus a separate `LastInsertId` call in the adapter.
- `FavoriteList` splits into two fixed queries; `ORDER BY created_at DESC` is preserved
  in both.
- `FeedList` keeps the correlated episode-count subquery, aliased `episode_count`.
- `ListFeedEpisodes` keeps `ORDER BY CASE WHEN published_at = '' THEN 1 ELSE 0 END,
  published_at DESC LIMIT ?`.
- `saveEpisodes` replaces its prepared-statement loop with `UpsertFeedEpisode`
  (`ON CONFLICT(feed_id, guid) DO UPDATE SET ...`) inside one transaction.
- Review scheduling arithmetic (`3 * (reviewCount+1)`, cap 60) stays in Go; SQL only
  accepts the `+N days` modifier, exactly as today.
- `emit_empty_slices: true` keeps list-returning methods returning `[]T{}`.

### 5. Schema ownership and feed tables (commit 3)

`feeds` and `feed_episodes` DDL moves from `FeedService.ensureTables` into
`internal/store/schema.sql`, with `link` and `image` present in the `CREATE TABLE` for
new installs. `ensureTables` is reduced to a migration helper that only runs:

```sql
ALTER TABLE feed_episodes ADD COLUMN link TEXT DEFAULT ''
ALTER TABLE feed_episodes ADD COLUMN image TEXT DEFAULT ''
```

and ignores "duplicate column" errors, because databases created by older versions have
neither column and `CREATE TABLE IF NOT EXISTS` will not add them. This helper runs from
`FeedService.ServiceStartup` before any feed query.

### 6. Deliberately left hand-written

| Location | Why |
|----------|-----|
| `internal/core/migrate.go` | DDL with dynamic column names; sqlc needs static SQL |
| `internal/core/articles.go` | `sqlite_master` probe for a valid `articles.db` |
| `internal/system/backup_service.go` | `VACUUM INTO` with a quoted path; not a bindable statement |
| `internal/content/article_store.go` categories/articles | read-only `articles.db`, separate schema |
| `internal/dict/dict.go` | read-only `dict.db` plus its own `dict_progress` schema |
| `cmd/articles-download`, `cmd/dict-build` | standalone import tools with their own connections |

### 7. Testing

Add DB-level tests using a temp SQLite file seeded from `store.Schema`, in the style of
`words_store_test.go`:

- favorites: add/list/delete, tag filtering, detach-on-tag-delete transaction, review
  scheduling for all three ratings, tag list ordering.
- typing: save/get progress, duplicate save via `INSERT OR REPLACE`, record ordering.
- stats: grade/level distributions and daily typing aggregation over seeded rows.
- AI cache: miss, hit, overwrite.
- feeds: add + duplicate rejection, list with episode count, episode upsert idempotency
  (guid conflict updates fields but preserves `local_path`), remove cascade, episode
  lookup used by download/stream/subtitles.
- migration: starting from a legacy `feed_episodes` table without `link`/`image`, the
  fallback adds the columns.

Per commit: `go vet ./...`, `go test ./...`, `sqlc generate && git diff --exit-code`.
No frontend/`make typecheck` is needed because no bound method changes.

### 8. Commit plan

1. `refactor: 将用户库 schema 与 sqlc 生成包提升为 internal/store`
   Pure move/rename. No behavior change. Deletes `internal/study/studydb` and
   `internal/study/sqlc`.
2. `refactor: 迁移收藏/打字/AI 缓存/统计到 sqlc`
   Adds queries and adapters; includes the `FavoriteTagDelete` transaction fix.
3. `refactor: 迁移订阅源数据访问并统一 schema`
   Moves feed DDL into the schema, adds feed/episode queries, keeps the ALTER fallback.

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| `RETURNING` unsupported by generated code | Fall back to `:execrows` + `LastInsertId` in the adapter |
| sqlc infers `interface{}` for aggregates | Explicit aliases and `CAST`, verified with `sqlc generate` before writing adapters |
| Generated int64 vs existing int fields | `go_type` overrides plus adapters; keep models unchanged |
| Dropping `ALTER TABLE` breaks upgraded DBs | Keep the two-`ALTER` migration helper and test it against a legacy schema |
| Package rename breaks imports/CI | Commit 1 is mechanical; `go build ./...` and `go test ./...` gate it |
| Transaction changes error handling in tag delete | Preserve existing log-and-continue semantics at the call site, only wrap the two writes |
| sqlc version drift in CI | CI cache key and `go install` both pin v1.31.1 |

## Left to the Builder

- Exact query names beyond the inventory above, and adapter function names.
- Whether the feed column migration helper lives in `feed_service.go` or moves next to
  `core/migrate.go` (default: stay in `feed_service.go`).
- Whether `study_stats.sql` aggregates deserve their own small helper file or stay in
  `word_service.go` (default: queries only; aggregation shaping stays in Go).
