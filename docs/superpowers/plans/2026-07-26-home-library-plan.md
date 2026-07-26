# 首页文件库 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Player's built-in library view with a standalone categorized file browser page at `/` with folder management, multi-select editing, grid/list views, and sorting.

**Architecture:** Go backend stores file library in `library.json` with folders + typed files. Existing `recent.json` APIs are updated to read/write `library.json` for backward compat. Frontend gets a new `libraryStore` (Zustand) and a rewritten `Home.tsx` with toolbar, category tabs, grid/list toggle, and edit mode.

**Tech Stack:** Go (Wails v2), React 18 + TypeScript, Zustand, Tailwind CSS, lucide-react icons

## Global Constraints

- File cap: 50 folders max, 200 files max
- PDF files: click to open with system default app, no inline preview
- Edit mode: multi-select, batch move to folder, batch delete
- Retain existing sidebar nav (update labels/paths only)
- Player continues to always-mount, but renderLibrary is removed from it

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `types.go` | Modify | Add `LibraryFile`, `Folder` structs |
| `library.go` | Create | All library CRUD: list, import, remove, rename, move, folder create/delete/rename |
| `recent.go` | Modify | Redirect `RecentList()`, `RecentAdd()` to library.json |
| `frontend/src/stores/libraryStore.ts` | Create | Zustand store: files, folders, activeCategory, viewMode, sortBy, editing |
| `frontend/src/api/bridge.ts` | Modify | Add library API bridges |
| `frontend/src/types/electron.d.ts` | Modify | Add library type declarations |
| `frontend/src/pages/Home.tsx` | Rewrite | Full file browser: toolbar, category tabs, grid/list, edit mode |
| `frontend/src/App.tsx` | Modify | Update routes: `/` → Home, keep `/player`, keep `/home` as word review |
| `frontend/src/components/Layout.tsx` | Modify | Update nav item for player/home |
| `frontend/src/pages/Player.tsx` | Modify | Remove `renderLibrary`, remove `recentFiles`/`thumbnails` state, simplify file opening |

---

### Task 1: Add Go types for library

**Files:**
- Modify: `types.go`

**Interfaces:**
- Produces: `LibraryFile` struct, `Folder` struct — consumed by Task 2, Task 3

- [ ] **Step 1: Add `LibraryFile` and `Folder` structs to `types.go`**

```go
type LibraryFile struct {
	Path     string `json:"path"`
	Name     string `json:"name"`
	Type     string `json:"type"`     // "video", "audio", "pdf"
	FolderID string `json:"folderId"` // empty string = uncategorized
	AddedAt  string `json:"addedAt"`
}

type Folder struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	CreatedAt string `json:"createdAt"`
}

type LibraryData struct {
	Folders []Folder      `json:"folders"`
	Files   []LibraryFile `json:"files"`
}
```

- [ ] **Step 2: Build check**

Run: `go build ./...`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add types.go
git commit -m "feat: add LibraryFile, Folder, LibraryData types for home library"
```

---

### Task 2: Create library.go with CRUD operations

**Files:**
- Create: `library.go`

**Interfaces:**
- Consumes: `LibraryFile`, `Folder`, `LibraryData` from Task 1
- Produces: `LibraryList() string`, `LibraryImport() string`, `LibraryRemove(string) string`, `LibraryRename(string, string) string`, `LibraryMove(string, string) string`, `FolderCreate(string) string`, `FolderDelete(string) string`, `FolderRename(string, string) string`

- [ ] **Step 1: Create `library.go`**

```go
package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

var videoExts = map[string]bool{"mp4": true, "mkv": true, "avi": true, "mov": true, "webm": true, "flv": true, "wmv": true}
var audioExts = map[string]bool{"mp3": true, "wav": true, "m4a": true, "ogg": true, "flac": true, "aac": true, "wma": true}
var pdfExts = map[string]bool{"pdf": true}

func detectFileType(name string) string {
	ext := strings.TrimPrefix(strings.ToLower(filepath.Ext(name)), ".")
	if videoExts[ext] {
		return "video"
	}
	if audioExts[ext] {
		return "audio"
	}
	if pdfExts[ext] {
		return "pdf"
	}
	return ""
}

func (a *App) libraryPath() string {
	return filepath.Join(a.dataDir, "library.json")
}

func (a *App) readLibrary() LibraryData {
	var lib LibraryData
	data, err := os.ReadFile(a.libraryPath())
	if err == nil {
		json.Unmarshal(data, &lib)
	}
	if lib.Folders == nil {
		lib.Folders = []Folder{}
	}
	if lib.Files == nil {
		lib.Files = []LibraryFile{}
	}
	if len(lib.Folders) > 50 {
		lib.Folders = lib.Folders[:50]
	}
	if len(lib.Files) > 200 {
		lib.Files = lib.Files[:200]
	}
	return lib
}

func (a *App) writeLibrary(lib LibraryData) {
	b, _ := json.Marshal(lib)
	os.WriteFile(a.libraryPath(), b, 0644)
}

func (a *App) LibraryList() string {
	lib := a.readLibrary()
	b, _ := json.Marshal(lib)
	return string(b)
}

func (a *App) LibraryImport() string {
	file, err := wailsRuntime.OpenFileDialog(a.ctx, wailsRuntime.OpenDialogOptions{})
	if err != nil || file == "" {
		b, _ := json.Marshal([]LibraryFile{})
		return string(b)
	}
	lib := a.readLibrary()
	if containsFile(lib.Files, file) {
		b, _ := json.Marshal(lib.Files)
		return string(b)
	}
	if len(lib.Files) >= 200 {
		b, _ := json.Marshal(lib.Files)
		return string(b)
	}
	ftype := detectFileType(file)
	if ftype == "" {
		b, _ := json.Marshal(lib.Files)
		return string(b)
	}
	lib.Files = append(lib.Files, LibraryFile{
		Path:    file,
		Name:    filepath.Base(file),
		Type:    ftype,
		FolderID: "",
		AddedAt:  time.Now().Format(time.RFC3339),
	})
	a.writeLibrary(lib)
	b, _ := json.Marshal(lib.Files)
	return string(b)
}

func containsFile(files []LibraryFile, path string) bool {
	for _, f := range files {
		if f.Path == path {
			return true
		}
	}
	return false
}

func (a *App) LibraryRemove(pathsJSON string) string {
	var paths []string
	json.Unmarshal([]byte(pathsJSON), &paths)
	pathSet := make(map[string]bool, len(paths))
	for _, p := range paths {
		pathSet[p] = true
	}
	lib := a.readLibrary()
	filtered := make([]LibraryFile, 0, len(lib.Files))
	for _, f := range lib.Files {
		if !pathSet[f.Path] {
			filtered = append(filtered, f)
		}
	}
	lib.Files = filtered
	a.writeLibrary(lib)
	b, _ := json.Marshal(lib.Files)
	return string(b)
}

func (a *App) LibraryRename(path, newName string) string {
	lib := a.readLibrary()
	for i := range lib.Files {
		if lib.Files[i].Path == path {
			lib.Files[i].Name = newName
			break
		}
	}
	for i := range lib.Folders {
		if lib.Folders[i].ID == path {
			lib.Folders[i].Name = newName
			break
		}
	}
	a.writeLibrary(lib)
	b, _ := json.Marshal(lib)
	return string(b)
}

func (a *App) LibraryMove(pathsJSON, folderID string) string {
	var paths []string
	json.Unmarshal([]byte(pathsJSON), &paths)
	pathSet := make(map[string]bool, len(paths))
	for _, p := range paths {
		pathSet[p] = true
	}
	lib := a.readLibrary()
	for i := range lib.Files {
		if pathSet[lib.Files[i].Path] {
			lib.Files[i].FolderID = folderID
		}
	}
	a.writeLibrary(lib)
	b, _ := json.Marshal(lib.Files)
	return string(b)
}

func (a *App) FolderCreate(name string) string {
	lib := a.readLibrary()
	if len(lib.Folders) >= 50 {
		b, _ := json.Marshal(lib.Folders)
		return string(b)
	}
	lib.Folders = append(lib.Folders, Folder{
		ID:        uuid.New().String(),
		Name:      name,
		CreatedAt: time.Now().Format(time.RFC3339),
	})
	a.writeLibrary(lib)
	b, _ := json.Marshal(lib.Folders)
	return string(b)
}

func (a *App) FolderDelete(id string) string {
	lib := a.readLibrary()
	filtered := make([]Folder, 0, len(lib.Folders))
	for _, f := range lib.Folders {
		if f.ID != id {
			filtered = append(filtered, f)
		}
	}
	lib.Folders = filtered
	for i := range lib.Files {
		if lib.Files[i].FolderID == id {
			lib.Files[i].FolderID = ""
		}
	}
	a.writeLibrary(lib)
	b, _ := json.Marshal(lib.Folders)
	return string(b)
}

func (a *App) FolderRename(id, name string) string {
	lib := a.readLibrary()
	for i := range lib.Folders {
		if lib.Folders[i].ID == id {
			lib.Folders[i].Name = name
			break
		}
	}
	a.writeLibrary(lib)
	b, _ := json.Marshal(lib.Folders)
	return string(b)
}
```

- [ ] **Step 2: Ensure uuid dependency exists**

Run: `grep google/uuid go.mod`
If not found, run: `go get github.com/google/uuid`

- [ ] **Step 3: Build check**

Run: `go build ./...`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add library.go go.mod go.sum
git commit -m "feat: add library CRUD operations for file/folder management"
```

---

### Task 3: Update recent.go to use library.json

**Files:**
- Modify: `recent.go`

**Interfaces:**
- Consumes: `LibraryFile` from Task 1, `readLibrary()`, `writeLibrary()` from Task 2
- Produces: Updated `RecentList()`, `RecentAdd()` that delegate to library.json

- [ ] **Step 1: Rewrite `RecentList` and `RecentAdd` in `recent.go`**

Replace `recent.go` contents:

```go
package main

import (
	"encoding/json"
	"path/filepath"
)

func (a *App) RecentList() string {
	lib := a.readLibrary()
	type recentEntry struct {
		Path string `json:"path"`
		Name string `json:"name"`
	}
	entries := make([]recentEntry, 0, len(lib.Files))
	for _, f := range lib.Files {
		entries = append(entries, recentEntry{Path: f.Path, Name: f.Name})
	}
	b, _ := json.Marshal(entries)
	return string(b)
}

func (a *App) RecentAdd(filePath string) string {
	lib := a.readLibrary()
	found := false
	for i, f := range lib.Files {
		if f.Path == filePath {
			lib.Files = append([]LibraryFile{lib.Files[i]}, append(lib.Files[:i], lib.Files[i+1:]...)...)
			found = true
			break
		}
	}
	if !found {
		ftype := detectFileType(filePath)
		if ftype != "" {
			if len(lib.Files) >= 200 {
				lib.Files = lib.Files[:199]
			}
			lib.Files = append([]LibraryFile{{
				Path:     filePath,
				Name:     filepath.Base(filePath),
				Type:     ftype,
				FolderID: "",
			}}, lib.Files...)
		} else {
			lib.Files = append([]LibraryFile{{
				Path:     filePath,
				Name:     filepath.Base(filePath),
				Type:     "",
				FolderID: "",
			}}, lib.Files...)
		}
	}
	a.writeLibrary(lib)
	return a.RecentList()
}
```

Leave `CacheSubtitles`, `GetCachedSubtitles`, `md5Hash` unchanged.

- [ ] **Step 2: Build check**

Run: `go build ./...`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add recent.go
git commit -m "feat: migrate recent.go to use library.json as single source of truth"
```

---

### Task 4: Create libraryStore (Zustand)

**Files:**
- Create: `frontend/src/stores/libraryStore.ts`

**Interfaces:**
- Consumes: Library types from Task 5 (bridge.ts, electron.d.ts)
- Produces: `useLibraryStore` hook — consumed by Task 6 (Home.tsx)

- [ ] **Step 1: Create `frontend/src/stores/libraryStore.ts`**

```typescript
import { create } from 'zustand'

export interface LibraryFile {
  path: string
  name: string
  type: 'video' | 'audio' | 'pdf'
  folderId: string
  addedAt: string
}

export interface Folder {
  id: string
  name: string
  createdAt: string
}

export type Category = 'all' | 'folder' | 'video' | 'audio' | 'pdf'
export type ViewMode = 'grid' | 'list'
export type SortBy = 'name' | 'addedAt' | 'type'

interface LibraryState {
  files: LibraryFile[]
  folders: Folder[]
  loading: boolean
  category: Category
  viewMode: ViewMode
  sortBy: SortBy
  editing: boolean
  selectedPaths: Set<string>
  currentFolderId: string | null

  load: () => Promise<void>
  setCategory: (c: Category) => void
  setViewMode: (v: ViewMode) => void
  setSortBy: (s: SortBy) => void
  toggleEditing: () => void
  toggleSelect: (path: string) => void
  selectAll: () => void
  clearSelection: () => void
  setCurrentFolder: (id: string | null) => void
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  files: [],
  folders: [],
  loading: false,
  category: 'all',
  viewMode: 'grid',
  sortBy: 'addedAt',
  editing: false,
  selectedPaths: new Set(),
  currentFolderId: null,

  load: async () => {
    set({ loading: true })
    const data = await window.api.libraryList()
    set({ files: data.files, folders: data.folders, loading: false })
  },

  setCategory: (category) => set({ category, editing: false, selectedPaths: new Set() }),

  setViewMode: (viewMode) => set({ viewMode }),

  setSortBy: (sortBy) => set({ sortBy }),

  toggleEditing: () => {
    const { editing } = get()
    set({ editing: !editing, selectedPaths: new Set() })
  },

  toggleSelect: (path) => {
    const next = new Set(get().selectedPaths)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    set({ selectedPaths: next })
  },

  selectAll: () => {
    const { files, folders } = get()
    const all = new Set<string>()
    folders.forEach(f => all.add(f.id))
    files.forEach(f => all.add(f.path))
    set({ selectedPaths: all })
  },

  clearSelection: () => set({ selectedPaths: new Set() }),

  setCurrentFolder: (id) => set({ currentFolderId: id, editing: false, selectedPaths: new Set() }),
}))
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/stores/libraryStore.ts
git commit -m "feat: add libraryStore with file/folder state, categories, view mode, edit mode"
```

---

### Task 5: Add bridge methods and TypeScript types

**Files:**
- Modify: `frontend/src/api/bridge.ts`
- Modify: `frontend/src/types/electron.d.ts`

**Interfaces:**
- Consumes: Go API names from Tasks 2-3
- Produces: `window.api.libraryList()`, `window.api.libraryImport()`, etc. — consumed by Task 4, Task 6

- [ ] **Step 1: Add library API to `frontend/src/api/bridge.ts`**

Add after `getMediaPort` line:

```typescript
    libraryList: () => app.LibraryList().then((s: string) => JSON.parse(s)),
    libraryImport: () => app.LibraryImport().then((s: string) => JSON.parse(s)),
    libraryRemove: (paths: string[]) => app.LibraryRemove(JSON.stringify(paths)).then((s: string) => JSON.parse(s)),
    libraryRename: (path: string, newName: string) => app.LibraryRename(path, newName).then((s: string) => JSON.parse(s)),
    libraryMove: (paths: string[], folderId: string) => app.LibraryMove(JSON.stringify(paths), folderId).then((s: string) => JSON.parse(s)),
    folderCreate: (name: string) => app.FolderCreate(name).then((s: string) => JSON.parse(s)),
    folderDelete: (id: string) => app.FolderDelete(id).then((s: string) => JSON.parse(s)),
    folderRename: (id: string, name: string) => app.FolderRename(id, name).then((s: string) => JSON.parse(s)),
```

**IMPORTANT**: Close the `as any` block properly. The full bridge.ts now looks like:

```typescript
export function initBridge(): void {
  const app = (window as any).go.main.App

  window.api = {
    openFile: (filters?: any) => app.OpenFile(filters || ''),
    saveFile: (name: string) => app.SaveFile(name),
    openSubtitle: () => app.OpenSubtitle(),
    readTextFile: (path: string) => app.ReadTextFile(path),
    writeTextFile: (path: string, content: string) => app.WriteTextFile(path, content),

    dbWordsList: () => app.DbWordsList(),
    dbWordsAdd: (word: any) => app.DbWordsAdd(JSON.stringify(word)),
    dbWordsUpdate: (id: number, data: any) => app.DbWordsUpdate(id, JSON.stringify(data)),
    dbWordsDelete: (id: number) => app.DbWordsDelete(id),
    dbWordsDeleteBatch: (ids: number[]) => app.DbWordsDeleteBatch(ids),
    dbWordsGetReview: () => app.DbWordsGetReview(),
    dbWordsSearch: (query: string) => app.DbWordsSearch(query),

    dbTagsList: () => app.DbTagsList(),
    dbTagsAdd: (name: string, color: string) => app.DbTagsAdd(name, color),
    dbTagsDelete: (id: number) => app.DbTagsDelete(id),

    dbExport: () => app.DbExport(),
    dbImport: (jsonStr: string) => app.DbImport(jsonStr),
    dbClear: () => app.DbClear(),

    whisperTranscribe: (filePath: string) => app.Transcribe(filePath).then((s: string) => {
      const parsed = JSON.parse(s)
      return Array.isArray(parsed) ? parsed : []
    }),
    whisperStatus: () => app.WhisperStatus(),
    downloadWhisperModel: (mirrorURL: string, modelName: string) => app.DownloadWhisperModel(mirrorURL, modelName),
    setWhisperModel: (name: string) => app.SetWhisperModel(name),
    listWhisperModels: () => app.ListWhisperModels().then((s: string) => JSON.parse(s)),
    getWhisperLang: () => app.GetWhisperLang().then((s: string) => s),
    setWhisperLang: (lang: string) => app.SetWhisperLang(lang),
    onWhisperProgress: (cb: (data: any) => void) => {
      window.runtime.EventsOn('whisper:progress', cb)
      return () => window.runtime.EventsOff('whisper:progress')
    },
    onDownloadProgress: (cb: (pct: number) => void) => {
      window.runtime.EventsOn('whisper:download-progress', cb)
      return () => window.runtime.EventsOff('whisper:download-progress')
    },
    getDownloadProgress: () => app.GetDownloadProgress(),

    recentList: () => app.RecentList().then((s: string) => JSON.parse(s)),
    recentAdd: (filePath: string) => app.RecentAdd(filePath).then((s: string) => JSON.parse(s)),
    cacheSubtitles: (filePath: string, subs: any[]) => app.CacheSubtitles(filePath, JSON.stringify(subs)),
    getCachedSubtitles: (filePath: string) => app.GetCachedSubtitles(filePath).then((s: string) => {
      if (!s) return null
      const parsed = JSON.parse(s)
      return Array.isArray(parsed) ? parsed : null
    }),

    getVideoThumbnail: (filePath: string) => app.GetVideoThumbnail(filePath),
    getPlatform: () => app.GetPlatform(),
    getMediaPort: () => app.GetMediaPort(),

    // Dictionary
    dbDictTags: () => app.DbDictTags(),
    dbDictWords: (tag: string) => app.DbDictWords(tag),
    dbDictAddToWordList: (words: any[]) => app.DbDictAddToWordList(JSON.stringify(words)),
    dbDictSaveProgress: (tag: string, index: number) => app.DbDictSaveProgress(tag, index),
    dbDictGetProgress: (tag: string) => app.DbDictGetProgress(tag),

    // Library
    libraryList: () => app.LibraryList().then((s: string) => JSON.parse(s)),
    libraryImport: () => app.LibraryImport().then((s: string) => JSON.parse(s)),
    libraryRemove: (paths: string[]) => app.LibraryRemove(JSON.stringify(paths)).then((s: string) => JSON.parse(s)),
    libraryRename: (path: string, newName: string) => app.LibraryRename(path, newName).then((s: string) => JSON.parse(s)),
    libraryMove: (paths: string[], folderId: string) => app.LibraryMove(JSON.stringify(paths), folderId).then((s: string) => JSON.parse(s)),
    folderCreate: (name: string) => app.FolderCreate(name).then((s: string) => JSON.parse(s)),
    folderDelete: (id: string) => app.FolderDelete(id).then((s: string) => JSON.parse(s)),
    folderRename: (id: string, name: string) => app.FolderRename(id, name).then((s: string) => JSON.parse(s)),
  } as any
}
```

- [ ] **Step 2: Add types to `frontend/src/types/electron.d.ts`**

Add after `Word` interface:

```typescript
export interface LibraryFile {
  path: string
  name: string
  type: 'video' | 'audio' | 'pdf'
  folderId: string
  addedAt: string
}

export interface Folder {
  id: string
  name: string
  createdAt: string
}

export interface LibraryData {
  folders: Folder[]
  files: LibraryFile[]
}
```

Add to `ElectronAPI` interface (before closing `}`):

```typescript
  libraryList: () => Promise<LibraryData>
  libraryImport: () => Promise<LibraryFile[]>
  libraryRemove: (paths: string[]) => Promise<LibraryFile[]>
  libraryRename: (path: string, newName: string) => Promise<LibraryData>
  libraryMove: (paths: string[], folderId: string) => Promise<LibraryFile[]>
  folderCreate: (name: string) => Promise<Folder[]>
  folderDelete: (id: string) => Promise<Folder[]>
  folderRename: (id: string, name: string) => Promise<Folder[]>
```

- [ ] **Step 3: Build check**

Run: `cd frontend && npm run build`
Expected: no TypeScript errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/bridge.ts frontend/src/types/electron.d.ts
git commit -m "feat: add library bridge methods and TypeScript type declarations"
```

---

### Task 6: Rewrite Home.tsx as the file browser

**Files:**
- Rewrite: `frontend/src/pages/Home.tsx`

**Interfaces:**
- Consumes: `useLibraryStore` from Task 4, `window.api` library methods from Task 5
- Produces: Full categorized file browser page at `/`

- [ ] **Step 1: Write `frontend/src/pages/Home.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLibraryStore, type LibraryFile, type Folder } from '@/stores/libraryStore'
import { usePlayerStore } from '@/stores/playerStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import {
  FileUp, Pencil, FolderPlus, LayoutGrid, List, ArrowUpDown, Trash2,
  Film, Music, FileText, Folder as FolderIcon, CheckSquare, Square,
  ArrowLeft, ChevronRight, Home, X
} from 'lucide-react'

const CATEGORIES = [
  { key: 'all' as const, label: '全部' },
  { key: 'folder' as const, label: '文件夹', icon: FolderIcon },
  { key: 'video' as const, label: '视频', icon: Film },
  { key: 'audio' as const, label: '音频', icon: Music },
  { key: 'pdf' as const, label: 'PDF', icon: FileText },
]

const TYPE_ICON = { video: Film, audio: Music, pdf: FileText }

export default function HomePage() {
  const store = useLibraryStore()
  const player = usePlayerStore()
  const navigate = useNavigate()
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [showMoveMenu, setShowMoveMenu] = useState(false)
  const [sortOpen, setSortOpen] = useState(false)

  useEffect(() => { store.load() }, [])

  const handleImport = async () => {
    await window.api.libraryImport()
    await store.load()
  }

  const handleDelete = async () => {
    if (store.selectedPaths.size === 0) return
    const paths = Array.from(store.selectedPaths)
    await window.api.libraryRemove(paths)
    await store.load()
    store.clearSelection()
  }

  const handleMove = async (folderId: string) => {
    const paths = Array.from(store.selectedPaths)
    if (paths.length === 0) return
    await window.api.libraryMove(paths, folderId)
    await store.load()
    store.clearSelection()
    setShowMoveMenu(false)
  }

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return
    await window.api.folderCreate(newFolderName.trim())
    await store.load()
    setNewFolderName('')
    setShowNewFolder(false)
  }

  const handleDeleteFolder = async (id: string) => {
    await window.api.folderDelete(id)
    await store.load()
    store.clearSelection()
  }

  const handleOpenFile = async (file: LibraryFile) => {
    if (file.type === 'pdf') {
      player.setFilePath(file.path)
      return
    }
    player.setFilePath(file.path)
    navigate('/player')
    try {
      const cached = await window.api.getCachedSubtitles(file.path)
      if (cached && cached.length > 0) {
        player.setSubtitles(cached)
        return
      }
      const srtPath = file.path.replace(/\.[^.]+$/, '.srt')
      try {
        await window.api.readTextFile(srtPath)
      } catch {}
    } catch {}
    await window.api.recentAdd(file.path)
  }

  const handleEnterFolder = (folder: Folder) => {
    store.setCurrentFolder(folder.id)
  }

  const handleExitFolder = () => {
    store.setCurrentFolder(null)
  }

  const sortOptions: { key: typeof store.sortBy; label: string }[] = [
    { key: 'addedAt', label: '添加时间 (新→旧)' },
    { key: 'name', label: '名称 (A-Z)' },
    { key: 'type', label: '类型' },
  ]

  const sortFn = (a: LibraryFile, b: LibraryFile) => {
    if (store.sortBy === 'name') return a.name.localeCompare(b.name)
    if (store.sortBy === 'type') return a.type.localeCompare(b.type) || a.name.localeCompare(b.name)
    return b.addedAt.localeCompare(a.addedAt)
  }

  const currentFolder = store.currentFolderId
    ? store.folders.find(f => f.id === store.currentFolderId)
    : null

  const visibleFolders = store.folders.filter(f => {
    if (store.category === 'folder') return true
    if (currentFolder) return false
    if (store.category === 'all') return true
    return false
  })

  const visibleFiles = store.files.filter(f => {
    if (currentFolder && f.folderId !== currentFolder.id) return false
    if (!currentFolder && f.folderId) return false
    if (store.category === 'folder') return false
    if (store.category === 'all') return true
    if (store.category === 'pdf') return false
    return f.type === store.category
  }).sort(sortFn)

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" onClick={handleImport}>
          <FileUp className="h-4 w-4 mr-1" /> 导入
        </Button>
        <Button size="sm" variant={store.editing ? 'default' : 'outline'} onClick={store.toggleEditing}>
          <Pencil className="h-4 w-4 mr-1" /> 编辑
        </Button>
        <Button size="sm" variant="outline" onClick={() => setShowNewFolder(true)}>
          <FolderPlus className="h-4 w-4 mr-1" /> 新建文件夹
        </Button>

        <div className="flex-1" />

        <div className="flex items-center gap-1 border rounded p-0.5">
          <Button size="sm" variant={store.viewMode === 'grid' ? 'secondary' : 'ghost'} onClick={() => store.setViewMode('grid')}>
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button size="sm" variant={store.viewMode === 'list' ? 'secondary' : 'ghost'} onClick={() => store.setViewMode('list')}>
            <List className="h-4 w-4" />
          </Button>
        </div>

        <div className="relative">
          <Button size="sm" variant="outline" onClick={() => setSortOpen(!sortOpen)}>
            <ArrowUpDown className="h-4 w-4 mr-1" /> {sortOptions.find(o => o.key === store.sortBy)?.label}
          </Button>
          {sortOpen && (
            <div className="absolute right-0 top-full mt-1 bg-popover border rounded shadow-lg py-1 z-50 min-w-[160px]" onClick={() => setSortOpen(false)}>
              {sortOptions.map(o => (
                <button key={o.key} className={`w-full px-3 py-1.5 text-xs hover:bg-accent text-left ${store.sortBy === o.key ? 'font-medium' : ''}`}
                  onClick={() => { store.setSortBy(o.key); setSortOpen(false) }}>
                  {o.label} {store.sortBy === o.key ? '✓' : ''}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex items-center gap-1 border-b pb-2">
        {currentFolder && (
          <Button variant="ghost" size="sm" className="mr-2" onClick={handleExitFolder}>
            <ArrowLeft className="h-4 w-4 mr-1" /> 返回
          </Button>
        )}
        {CATEGORIES.map(cat => {
          const Icon = cat.icon
          return (
            <Button key={cat.key} size="sm" variant={store.category === cat.key ? 'secondary' : 'ghost'}
              onClick={() => { store.setCategory(cat.key); handleExitFolder() }}>
              {Icon && <Icon className="h-3.5 w-3.5 mr-1" />}
              {cat.label}
            </Button>
          )
        })}
      </div>

      {/* Breadcrumb for folder */}
      {currentFolder && (
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <button onClick={handleExitFolder} className="hover:text-foreground"><Home className="h-3.5 w-3.5 inline" /></button>
          <ChevronRight className="h-3.5 w-3.5" />
          <span className="font-medium text-foreground">{currentFolder.name}</span>
        </div>
      )}

      {/* Edit mode controls */}
      {store.editing && (
        <div className="flex items-center gap-2 p-2 bg-muted/50 rounded">
          <Button size="sm" variant="ghost" onClick={store.selectAll}>
            <CheckSquare className="h-4 w-4 mr-1" /> 全选
          </Button>
          <span className="text-xs text-muted-foreground">已选 {store.selectedPaths.size} 项</span>
          <div className="flex-1" />
          <Button size="sm" variant="outline" onClick={() => setShowMoveMenu(!showMoveMenu)} disabled={store.selectedPaths.size === 0}>
            移动到
          </Button>
          {showMoveMenu && (
            <div className="absolute mt-1 bg-popover border rounded shadow-lg py-1 z-50 min-w-[140px]" style={{ top: '100%' }}>
              <button className="w-full px-3 py-1.5 text-xs hover:bg-accent text-left" onClick={() => handleMove('')}>未归类</button>
              {store.folders.map(f => (
                <button key={f.id} className="w-full px-3 py-1.5 text-xs hover:bg-accent text-left" onClick={() => handleMove(f.id)}>
                  {f.name}
                </button>
              ))}
            </div>
          )}
          <Button size="sm" variant="destructive" onClick={handleDelete} disabled={store.selectedPaths.size === 0}>
            <Trash2 className="h-4 w-4 mr-1" /> 删除
          </Button>
        </div>
      )}

      {/* New folder dialog */}
      {showNewFolder && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowNewFolder(false)}>
          <Card className="w-80 p-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-3">新建文件夹</h3>
            <Input value={newFolderName} onChange={e => setNewFolderName(e.target.value)}
              placeholder="输入文件夹名称" onKeyDown={e => e.key === 'Enter' && handleCreateFolder()} />
            <div className="flex gap-2 justify-end mt-3">
              <Button variant="outline" size="sm" onClick={() => setShowNewFolder(false)}>取消</Button>
              <Button size="sm" onClick={handleCreateFolder}>创建</Button>
            </div>
          </Card>
        </div>
      )}

      {/* Grid View */}
      {store.viewMode === 'grid' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {visibleFolders.map(folder => (
            <GridFolderCard key={folder.id} folder={folder} fileCount={store.files.filter(f => f.folderId === folder.id).length}
              editing={store.editing} selected={store.selectedPaths.has(folder.id)}
              onToggle={() => store.toggleSelect(folder.id)}
              onClick={() => store.editing ? store.toggleSelect(folder.id) : handleEnterFolder(folder)}
              onDelete={() => handleDeleteFolder(folder.id)} />
          ))}
          {visibleFiles.map(file => (
            <GridFileCard key={file.path} file={file}
              editing={store.editing} selected={store.selectedPaths.has(file.path)}
              onToggle={() => store.toggleSelect(file.path)}
              onClick={() => store.editing ? store.toggleSelect(file.path) : handleOpenFile(file)} />
          ))}
        </div>
      )}

      {/* List View */}
      {store.viewMode === 'list' && (
        <div className="border rounded-lg overflow-hidden">
          <div className="grid grid-cols-12 gap-2 px-4 py-2 bg-muted/50 text-xs font-medium text-muted-foreground border-b">
            <div className="col-span-5">名称</div>
            <div className="col-span-3">类型</div>
            <div className="col-span-4">添加时间</div>
          </div>
          <div className="divide-y">
            {visibleFolders.map(folder => (
              <ListFolderRow key={folder.id} folder={folder}
                editing={store.editing} selected={store.selectedPaths.has(folder.id)}
                onToggle={() => store.toggleSelect(folder.id)}
                onClick={() => store.editing ? store.toggleSelect(folder.id) : handleEnterFolder(folder)} />
            ))}
            {visibleFiles.map(file => (
              <ListFileRow key={file.path} file={file}
                editing={store.editing} selected={store.selectedPaths.has(file.path)}
                onToggle={() => store.toggleSelect(file.path)}
                onClick={() => store.editing ? store.toggleSelect(file.path) : handleOpenFile(file)} />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {visibleFolders.length === 0 && visibleFiles.length === 0 && (
        <div className="text-center py-20 text-muted-foreground">
          <p className="text-lg mb-2">{currentFolder ? '此文件夹为空' : '暂无文件'}</p>
          <p className="text-sm mb-4">{currentFolder ? '点击导入添加文件到此文件夹' : '点击「导入」添加音视频或 PDF 文件'}</p>
          <Button size="sm" onClick={handleImport}>
            <FileUp className="h-4 w-4 mr-1" /> 导入文件
          </Button>
        </div>
      )}
    </div>
  )
}

function GridFolderCard({ folder, fileCount, editing, selected, onToggle, onClick, onDelete }: {
  folder: Folder; fileCount: number; editing: boolean; selected: boolean;
  onToggle: () => void; onClick: () => void; onDelete: () => void;
}) {
  return (
    <div className={`group relative rounded-lg border bg-card hover:bg-accent/50 transition-colors cursor-pointer ${selected ? 'ring-2 ring-primary' : ''}`}
      onClick={editing && !(e => false) ? onToggle : onClick}>
      {editing && (
        <button className="absolute top-2 left-2 z-10" onClick={e => { e.stopPropagation(); onToggle() }}>
          {selected ? <CheckSquare className="h-5 w-5 text-primary" /> : <Square className="h-5 w-5 text-muted-foreground" />}
        </button>
      )}
      {editing && (
        <button className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100" onClick={e => { e.stopPropagation(); onDelete() }}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </button>
      )}
      <div className="flex flex-col items-center justify-center h-28">
        <FolderIcon className="h-12 w-12 text-yellow-500" />
        <p className="text-sm font-medium mt-1 truncate px-2 max-w-full">{folder.name}</p>
        <p className="text-xs text-muted-foreground">{fileCount} 个文件</p>
      </div>
    </div>
  )
}

function GridFileCard({ file, editing, selected, onToggle, onClick }: {
  file: LibraryFile; editing: boolean; selected: boolean;
  onToggle: () => void; onClick: () => void;
}) {
  const Icon = TYPE_ICON[file.type] || FileText
  return (
    <div className={`group relative rounded-lg border bg-card hover:bg-accent/50 transition-colors cursor-pointer ${selected ? 'ring-2 ring-primary' : ''}`}
      onClick={editing ? onToggle : onClick}>
      {editing && (
        <button className="absolute top-2 left-2 z-10" onClick={e => { e.stopPropagation(); onToggle() }}>
          {selected ? <CheckSquare className="h-5 w-5 text-primary" /> : <Square className="h-5 w-5 text-muted-foreground" />}
        </button>
      )}
      <div className="flex flex-col items-center justify-center h-28 overflow-hidden">
        {file.type === 'video' || file.type === 'audio' ? (
          <div className={`w-full flex items-center justify-center ${file.type === 'audio' ? 'bg-blue-50 dark:bg-blue-950/30' : 'bg-purple-50 dark:bg-purple-950/30'}`} style={{ height: '100%' }}>
            <Icon className="h-10 w-10 text-muted-foreground" />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full">
            <Icon className="h-10 w-10 text-muted-foreground" />
          </div>
        )}
      </div>
      <div className="p-2 border-t">
        <p className="text-xs truncate">{file.name}</p>
      </div>
    </div>
  )
}

function ListFolderRow({ folder, editing, selected, onToggle, onClick }: {
  folder: Folder; editing: boolean; selected: boolean;
  onToggle: () => void; onClick: () => void;
}) {
  return (
    <div className={`grid grid-cols-12 gap-2 px-4 py-2.5 items-center hover:bg-accent/50 cursor-pointer text-sm ${selected ? 'bg-primary/5' : ''}`}
      onClick={editing ? onToggle : onClick}>
      <div className="col-span-5 flex items-center gap-2">
        {editing && (
          editing ? (selected ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4 text-muted-foreground" />) : null
        )}
        <FolderIcon className="h-4 w-4 text-yellow-500 shrink-0" />
        <span className="truncate">{folder.name}</span>
      </div>
      <div className="col-span-3 text-muted-foreground text-xs">文件夹</div>
      <div className="col-span-4 text-muted-foreground text-xs">{new Date(folder.createdAt).toLocaleDateString('zh-CN')}</div>
    </div>
  )
}

function ListFileRow({ file, editing, selected, onToggle, onClick }: {
  file: LibraryFile; editing: boolean; selected: boolean;
  onToggle: () => void; onClick: () => void;
}) {
  const Icon = TYPE_ICON[file.type] || FileText
  return (
    <div className={`grid grid-cols-12 gap-2 px-4 py-2.5 items-center hover:bg-accent/50 cursor-pointer text-sm ${selected ? 'bg-primary/5' : ''}`}
      onClick={editing ? onToggle : onClick}>
      <div className="col-span-5 flex items-center gap-2">
        {editing && (
          editing ? (selected ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4 text-muted-foreground" />) : null
        )}
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{file.name}</span>
      </div>
      <div className="col-span-3 text-muted-foreground text-xs">
        {file.type === 'video' ? '视频' : file.type === 'audio' ? '音频' : 'PDF'}
      </div>
      <div className="col-span-4 text-muted-foreground text-xs">{new Date(file.addedAt).toLocaleDateString('zh-CN')}</div>
    </div>
  )
}
```

- [ ] **Step 2: Build check**

Run: `cd frontend && npm run build`
Expected: no TypeScript errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Home.tsx
git commit -m "feat: rewrite Home page as categorized file browser with folder management"
```

---

### Task 7: Update App.tsx routes and Layout.tsx nav

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/Layout.tsx`

- [ ] **Step 1: Update routes in `frontend/src/App.tsx`**

Change the route for `/` to render Home directly (no redirect), keep `/player` for player:

```tsx
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom'
import { Suspense, lazy, useEffect } from 'react'
import { Layout } from '@/components/Layout'
import { useThemeStore } from '@/stores/themeStore'
import { initBridge } from '@/api/bridge'

const Home = lazy(() => import('@/pages/Home'))
const Player = lazy(() => import('@/pages/Player'))
const WordList = lazy(() => import('@/pages/WordList'))
const WordCard = lazy(() => import('@/pages/WordCard'))
const Settings = lazy(() => import('@/pages/Settings'))
const Dict = lazy(() => import('@/pages/DictPage'))
const Review = lazy(() => import('@/pages/ReviewPage'))

function Loading() {
  return <div className="flex items-center justify-center h-64 text-muted-foreground">加载中...</div>
}

function AppContent() {
  const location = useLocation()
  const dark = useThemeStore((s) => s.dark)
  const isPlayer = location.pathname === '/player'

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])

  return (
    <Layout isPlayerRoute={isPlayer}>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/home" element={<Home />} />
          <Route path="/words" element={<WordList />} />
          <Route path="/dict" element={<Dict />} />
          <Route path="/dict/:tag" element={<Review />} />
          <Route path="/card" element={<WordCard />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </Suspense>

      <Suspense fallback={null}>
        <Player />
      </Suspense>
    </Layout>
  )
}

export default function App() {
  useEffect(() => { initBridge() }, [])

  return (
    <HashRouter>
      <AppContent />
    </HashRouter>
  )
}
```

- [ ] **Step 2: Update sidebar nav in `frontend/src/components/Layout.tsx`**

Change the nav items to reflect new organization:

```typescript
const navItems = [
  { path: '/', label: '文件库', icon: Home },
  { path: '/player', label: '精听播放', icon: Play },
  { path: '/words', label: '生词库', icon: BookOpen },
  { path: '/dict', label: '单词书', icon: Library },
  { path: '/card', label: '卡片背诵', icon: FlipVertical },
  { path: '/settings', label: '设置', icon: Settings }
]
```

Remove `isActive` check for `/home` reference in nav items (we no longer have a dedicated word review page at `/home`).

- [ ] **Step 3: Build check**

Run: `cd frontend && npm run build`
Expected: no TypeScript errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/Layout.tsx
git commit -m "feat: update routes — / renders Home file browser, sidebar nav updated"
```

---

### Task 8: Clean up Player.tsx — remove old library view

**Files:**
- Modify: `frontend/src/pages/Player.tsx`

- [ ] **Step 1: Remove library-related state and code from Player.tsx**

Remove these state variables (they are no longer needed):

```typescript
// REMOVE:
const [recentFiles, setRecentFiles] = useState<{ path: string; name: string }[]>([])
const [thumbnails, setThumbnails] = useState<Record<string, string>>({})
```

Remove these useEffects:

```typescript
// REMOVE the first useEffect that loads recentList:
useEffect(() => { window.api.recentList().then(setRecentFiles); window.api.getWhisperLang().then(setTranscribeLang) }, [])

// REMOVE the thumbnail loading useEffect:
useEffect(() => {
  const load = async () => { ... }
  if (recentFiles.length > 0) load()
}, [recentFiles])
```

Remove the `renderLibrary` function entirely (lines 279-340).

Remove the `openFile` function:

```typescript
// REMOVE:
const openFile = async (filePath: string) => {
  store.setFilePath(filePath)
  setPlayError(null)
  const cached = await window.api.getCachedSubtitles(filePath)
  if (cached && cached.length > 0) { store.setSubtitles(cached); return }
  const srtPath = filePath.replace(/\.[^.]+$/, '.srt')
  try { await window.api.readTextFile(srtPath); loadSrtFile(srtPath) } catch {}
}
```

Update `handleOpenFile` to directly set file path (no more library browsing from player):

```typescript
const handleOpenFile = async () => {
  const filePath = await window.api.openFile()
  if (filePath) {
    store.setFilePath(filePath)
    setPlayError(null)
    window.api.recentAdd(filePath)
    try {
      const cached = await window.api.getCachedSubtitles(filePath)
      if (cached && cached.length > 0) { store.setSubtitles(cached); return }
      const srtPath = filePath.replace(/\.[^.]+$/, '.srt')
      try { await window.api.readTextFile(srtPath); loadSrtFile(srtPath) } catch {}
    } catch {}
  }
}
```

Remove the `isAudio` variable and replace the render logic. The `renderPlayer` function stays. The render return should change from:

```tsx
{store.filePath ? renderPlayer() : renderLibrary()}
```

to just:

```tsx
{store.filePath ? renderPlayer() : (
  <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-4">
    <p className="text-lg">打开一个文件开始播放</p>
    <p className="text-sm">前往「文件库」页面导入文件，或直接拖入音视频</p>
    <Button size="sm" onClick={handleOpenFile}>
      <FileUp className="h-4 w-4 mr-1" /> 导入音视频
    </Button>
  </div>
)}
```

Also remove the `recentFiles` select dropdown from the toolbar (the `<select>` after the file name span).

Keep: transcription modal, subtitle panel, "返回列表" button (now navigates to `/`).

- [ ] **Step 2: Update "返回列表" button to navigate to `/`**

Replace:

```tsx
<Button variant="ghost" size="sm" onClick={() => store.closeFile()}>
```

with:

```tsx
<Button variant="ghost" size="sm" onClick={() => { store.closeFile(); navigate('/') }}>
```

Need to add `useNavigate` import (already exists since there's no navigate in Player.tsx currently). Add:

```typescript
import { useNavigate } from 'react-router-dom'
```

and in the component:

```typescript
const navigate = useNavigate()
```

- [ ] **Step 3: Build check**

Run: `cd frontend && npm run build`
Expected: no TypeScript errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Player.tsx
git commit -m "refactor: remove library view from Player, delegate to Home page"
```

---

### Task 9: Final build verification

- [ ] **Step 1: Go backend build**

Run: `go build ./...`
Expected: no errors

- [ ] **Step 2: Frontend build**

Run: `cd frontend && npm run build`
Expected: no TypeScript errors, Vite build succeeds

- [ ] **Step 3: Commit any remaining changes**

```bash
git add -A
git commit -m "chore: final build verification, all clean"
```
