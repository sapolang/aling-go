# Mobile Home Page Design

## Summary
Add a home page to the mobile app that lists imported audio/video files with thumbnails, categorized by type, supporting tap-to-play and long-press-to-manage.

## Tab Structure
Replace the empty "复习" tab with "首页" (Home). New tab order:
- 首页 (home) — new
- 精听 (player)
- 词库 (words)
- 设置 (settings)

`index.tsx` redirects to `/(tabs)` instead of `/(tabs)/player`, so the app lands on the home tab.

## Data Layer

### New SQLite Table
```sql
CREATE TABLE IF NOT EXISTS files (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  uri         TEXT NOT NULL,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'video',
  duration    REAL DEFAULT 0,
  file_size   INTEGER DEFAULT 0,
  thumbnail   TEXT DEFAULT '',
  created_at  TEXT DEFAULT (datetime('now','localtime'))
);
```

### New Module: `src/db/fileStore.ts`
- `addFile(uri, name, type, thumbnail?)` — insert or replace by uri
- `getAllFiles()` — returns all files ordered by created_at DESC
- `getFilesByType(type)` — filter by video/audio
- `deleteFile(id)` — remove from DB
- `renameFile(id, newName)` — update name

### File Persistence Flow
When user opens a file in the player (player.tsx's openFile), also insert/update the `files` table. Detect type from file extension. Generate thumbnail for videos via `expo-video`'s `generateThumbnailsAsync`.

## Home Page UI (`mobile/app/(tabs)/index.tsx`)
- Segmented control at top: 视频 | 音频
- FlatList below, showing files of the selected type
- **Video items**: Thumbnail image (or placeholder) + title, grid-like layout
- **Audio items**: Icon + title, list layout
- Empty state: icon + "导入音频或视频开始学习" text + import button
- **On tap**: set file in playerStore, navigate to `/(tabs)/player`
- **On long press**: ActionSheet with "重命名" / "删除"

## Long Press Actions
- **重命名**: Alert.prompt with current name, update DB + UI
- **删除**: Confirm alert, remove from DB, remove from UI

## Navigation
Home page uses `useRouter()` from expo-router. On file tap:
1. `playerStore.setFile(uri, name)`
2. `router.navigate({ pathname: '/(tabs)/player' })`

## Files to Create/Modify
| File | Change |
|------|--------|
| `src/db/schema.ts` | Add `files` table CREATE |
| `src/db/fileStore.ts` | New — CRUD for files |
| `src/stores/playerStore.ts` | Add `setFile` uri passthrough (no major change needed) |
| `app/(tabs)/_layout.tsx` | Change review tab to home |
| `app/index.tsx` | Redirect to `/(tabs)` |
| `app/(tabs)/index.tsx` | New — Home page |
| `app/(tabs)/player.tsx` | Hook into file open to persist to DB, generate thumbnail |
