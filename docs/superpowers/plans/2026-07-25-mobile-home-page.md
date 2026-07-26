# Mobile Home Page Implementation Plan

> **For agentic workers:** Tasks use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the empty "review" tab with a home page showing imported files categorized by video/audio, with tap-to-play and long-press rename/delete.

**Architecture:** Add `files` SQLite table + fileStore CRUD module, create home page component, modify player to persist files on open, update tab layout.

**Tech Stack:** Expo Router, React Native, expo-sqlite, expo-video, Ionicons

## Global Constraints

- Follow existing code style (no comments, StyleSheet.create, Zustand store patterns)
- TypeScript strict mode
- File type detection: extension-based (same as transcription.ts: .mp4/.mov/.m4v/.mkv/.avi/.webm/.flv/.3gp = video)

---

### Task 1: DB Schema + File Store

**Files:**
- Modify: `mobile/src/db/schema.ts` — add `files` table
- Create: `mobile/src/db/fileStore.ts` — CRUD operations

- [ ] **Step 1: Add files table to schema**

Edit `schema.ts` to add the `files` table and include it in `ALL_SCHEMAS`.

- [ ] **Step 2: Create fileStore.ts**

CRUD module with:
- `detectFileType(name: string): 'video' | 'audio'`
- `addFile(uri, name, type, thumbnail?)` — INSERT OR REPLACE
- `getAllFiles()` — ordered by created_at DESC
- `getFilesByType(type)` — filter
- `deleteFile(id)`
- `renameFile(id, newName)`
- `FileRow` type

### Task 2: Tab Layout + Index Redirect

**Files:**
- Modify: `mobile/app/(tabs)/_layout.tsx` — replace review tab with home
- Modify: `mobile/app/index.tsx` — redirect to home
- Delete: `mobile/app/(tabs)/review.tsx` (placeholder)

- [ ] **Step 1: Update tab layout**

Replace `review` tab with `home` tab (title "首页", icon `home`). Keep tab order: home → player → words → settings.

- [ ] **Step 2: Update index redirect**

Change `mobile/app/index.tsx` to redirect to `/(tabs)/home`.

- [ ] **Step 3: Delete review.tsx placeholder**

### Task 3: Home Page Component

**Files:**
- Create: `mobile/app/(tabs)/home.tsx`

120-line component with:
- Segmented control: 视频 | 音频
- FlatList of files with thumbnails (video) or icon (audio)
- Empty state
- Tap → set file in playerStore, navigate to player tab
- Long press → ActionSheet with rename/delete

### Task 4: Player Integration

**Files:**
- Modify: `mobile/app/(tabs)/player.tsx`

- Import `addFile`, `detectFileType` from fileStore
- In `openFile`, after `setFile`, also call `addFile` to persist
- Generate thumbnail for videos, save to fileStore
- Also persist when file is loaded from the store (i.e. from home page)
