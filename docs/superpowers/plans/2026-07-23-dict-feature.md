# 词典背单词功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "单词书架 → 卡片背词" feature using the existing `dict.db` database.

**Architecture:** New `internal/dict/` Go package handles dict.db queries; App struct mounts `DbDict*` methods exposed to frontend via Wails binding. Frontend gets two new pages (DictPage bookshelf, ReviewPage flashcard) and a Zustand store.

**Tech Stack:** Go 1.25 + modernc.org/sqlite + Wails v2 + React + TypeScript + Zustand + Tailwind CSS + react-router-dom + lucide-react

---

### Task 1: Go backend — dict package + App methods

**Files:**
- Create: `internal/dict/models.go`
- Create: `internal/dict/dict.go`
- Modify: `app.go`
- Modify: `go.mod` (no changes needed, `modernc.org/sqlite` already imported)

**Interfaces:**
- Consumes: `var db *sql.DB` is the userData.db connection (used for `AddWordsToList`)
- Produces: Functions called by App methods:
  - `dict.OpenDictDB(dataDir string) error`
  - `dict.GetTags() ([]DictTag, error)`
  - `dict.GetWordsByTag(tag string) ([]DictWord, error)`
  - `dict.AddWordsToList(words []DictWord) (added, skipped int, err error)`

- [ ] **Step 1: Create `internal/dict/models.go`**

```go
package dict

type DictWord struct {
	Word        string `json:"word"`
	Phonetic    string `json:"phonetic"`
	Translation string `json:"translation"`
	Definition  string `json:"definition"`
	Pos         string `json:"pos"`
	Tag         string `json:"tag"`
}

type DictTag struct {
	Tag   string `json:"tag"`
	Count int    `json:"count"`
}
```

- [ ] **Step 2: Create `internal/dict/dict.go` with DB init and queries**

```go
package dict

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
)

var dictDB *sql.DB

func OpenDictDB(dataDir string) error {
	// Try dataDir first, then fall back to executable directory
	paths := []string{
		filepath.Join(dataDir, "dict.db"),
		"dict.db",
	}
	exe, _ := os.Executable()
	if exe != "" {
		paths = append(paths, filepath.Join(filepath.Dir(exe), "dict.db"))
	}

	var dbPath string
	for _, p := range paths {
		if _, err := os.Stat(p); err == nil {
			dbPath = p
			break
		}
	}
	if dbPath == "" {
		return fmt.Errorf("dict.db not found")
	}

	var err error
	dictDB, err = sql.Open("sqlite", dbPath)
	if err != nil {
		return err
	}
	return dictDB.Ping()
}

func GetTags() ([]DictTag, error) {
	rows, err := dictDB.Query("SELECT DISTINCT tag FROM mini_dict ORDER BY tag")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tagSet := make(map[string]int)
	for rows.Next() {
		var tagStr string
		if err := rows.Scan(&tagStr); err != nil {
			continue
		}
		tags := strings.Fields(tagStr)
		for _, t := range tags {
			tagSet[t]++
		}
	}
	// Hmm, this won't give accurate counts per tag because
	// we're counting rows that CONTAIN the tag, not rows PER tag.
	// Let me fix this approach.
}

// Actually, let me reconsider. The tag column is space-separated, e.g.
// "gk cet4 cet6 ky toefl gre". So a single row can have multiple tags.
// For the bookshelf, we want: for each known tag, count how many rows
// have it. Then list only non-empty tags.

func GetTags() ([]DictTag, error) {
	rows, err := dictDB.Query("SELECT tag FROM mini_dict")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tagCount := make(map[string]int)
	for rows.Next() {
		var tagStr string
		if err := rows.Scan(&tagStr); err != nil {
			continue
		}
		for _, t := range strings.Fields(tagStr) {
			tagCount[t]++
		}
	}

	var result []DictTag
	for tag, count := range tagCount {
		result = append(result, DictTag{Tag: tag, Count: count})
	}
	return result, nil
}
```

Wait, the above approach scans all rows which is fine for 10K entries. Let me write the proper final version.

- [ ] **Step 2: Create `internal/dict/dict.go`**

```go
package dict

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
)

var dictDB *sql.DB
var userDB *sql.DB

func OpenDictDB(dataDir string, userDataDB *sql.DB) error {
	userDB = userDataDB
	paths := []string{
		filepath.Join(dataDir, "dict.db"),
		"dict.db",
	}
	exe, _ := os.Executable()
	if exe != "" {
		paths = append(paths, filepath.Join(filepath.Dir(exe), "dict.db"))
	}
	var dbPath string
	for _, p := range paths {
		if _, err := os.Stat(p); err == nil {
			dbPath = p
			break
		}
	}
	if dbPath == "" {
		return fmt.Errorf("dict.db not found in any search path")
	}
	var err error
	dictDB, err = sql.Open("sqlite", dbPath)
	if err != nil {
		return err
	}
	return dictDB.Ping()
}

func GetTags() ([]DictTag, error) {
	rows, err := dictDB.Query("SELECT tag FROM mini_dict")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tagCount := make(map[string]int)
	for rows.Next() {
		var tagStr string
		if err := rows.Scan(&tagStr); err != nil {
			continue
		}
		for _, t := range strings.Fields(tagStr) {
			tagCount[t]++
		}
	}

	var result []DictTag
	for tag, count := range tagCount {
		result = append(result, DictTag{Tag: tag, Count: count})
	}
	return result, nil
}

func GetWordsByTag(tag string) ([]DictWord, error) {
	rows, err := dictDB.Query(
		"SELECT word, phonetic, translation, definition, pos, tag FROM mini_dict WHERE tag LIKE ? ORDER BY word",
		"%"+tag+"%",
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var words []DictWord
	for rows.Next() {
		var w DictWord
		if err := rows.Scan(&w.Word, &w.Phonetic, &w.Translation, &w.Definition, &w.Pos, &w.Tag); err != nil {
			continue
		}
		words = append(words, w)
	}
	return words, nil
}

func AddWordsToList(words []DictWord) (added, skipped int, err error) {
	tx, err := userDB.Begin()
	if err != nil {
		return 0, 0, err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare("INSERT OR IGNORE INTO words (word, definition, phonetic, tags) VALUES (?, ?, ?, ?)")
	if err != nil {
		return 0, 0, err
	}
	defer stmt.Close()

	for _, w := range words {
		// Combine Chinese translation and English definition
		def := w.Translation
		if w.Definition != "" {
			def += "\n" + w.Definition
		}
		res, err := stmt.Exec(w.Word, def, w.Phonetic, w.Tag)
		if err != nil {
			skipped++
			continue
		}
		n, _ := res.RowsAffected()
		if n > 0 {
			added++
		} else {
			skipped++
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, 0, err
	}
	return added, skipped, nil
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/lxy/work/aling-go && go vet ./internal/dict/`
Expected: no errors

- [ ] **Step 4: Modify `app.go` — init dictDB in startup and add methods**

Add import for `"aling-go/internal/dict"` and initialize after `initDB`:

```go
// In startup, after initDB:
if err := initDB(a.dataDir); err != nil {
    println("DB init error:", err.Error())
}
if err := dict.OpenDictDB(a.dataDir, db); err != nil {
    println("Dict DB init error:", err.Error())
}
```

Add methods at the end of App struct:

```go
// --- Dictionary ---

func (a *App) DbDictTags() []dict.DictTag {
	tags, err := dict.GetTags()
	if err != nil {
		return []dict.DictTag{}
	}
	return tags
}

func (a *App) DbDictWords(tag string) []dict.DictWord {
	words, err := dict.GetWordsByTag(tag)
	if err != nil {
		return []dict.DictWord{}
	}
	return words
}

type DictAddResult struct {
	Added   int `json:"added"`
	Skipped int `json:"skipped"`
}

func (a *App) DbDictAddToWordList(jsonStr string) DictAddResult {
	var words []dict.DictWord
	if err := json.Unmarshal([]byte(jsonStr), &words); err != nil {
		return DictAddResult{}
	}
	added, skipped, _ := dict.AddWordsToList(words)
	return DictAddResult{Added: added, Skipped: skipped}
}
```

Add `"encoding/json"` to imports if not already present (it is, in database.go, but app.go might not have it — add it in app.go's import block).

- [ ] **Step 5: Verify full build compiles**

Run: `cd /Users/lxy/work/aling-go && go vet ./...`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add internal/dict/ app.go
git commit -m "feat: add dict.db backend - tag listing, word queries, add to wordlist"
```

---

### Task 2: Frontend — bridge bindings + dictStore

**Files:**
- Modify: `frontend/src/api/bridge.ts`
- Create: `frontend/src/stores/dictStore.ts`

**Interfaces:**
- Consumes: Go methods `DbDictTags`, `DbDictWords`, `DbDictAddToWordList`
- Produces: `useDictStore` hook used by DictPage and ReviewPage

- [ ] **Step 1: Add dict API bindings to `bridge.ts`**

Add after the `getMediaPort` line at the end of the `window.api` object:

```typescript
// Dictionary
dbDictTags: () => app.DbDictTags(),
dbDictWords: (tag: string) => app.DbDictWords(tag),
dbDictAddToWordList: (words: any[]) => app.DbDictAddToWordList(JSON.stringify(words)),
```

- [ ] **Step 2: Create `frontend/src/stores/dictStore.ts`**

```typescript
import { create } from 'zustand'

export interface DictWord {
  word: string
  phonetic: string
  translation: string
  definition: string
  pos: string
  tag: string
}

export interface DictTag {
  tag: string
  count: number
}

interface DictStore {
  books: DictTag[]
  currentBook: string | null
  words: DictWord[]
  currentIndex: number
  knownWords: Set<string>
  unknownWords: Set<string>
  loading: boolean

  loadBooks: () => Promise<void>
  openBook: (tag: string) => Promise<void>
  markKnown: () => void
  markUnknown: () => void
  addToWordList: (word: DictWord) => Promise<void>
  addAllUnknown: () => Promise<void>
  reset: () => void
  setCurrentIndex: (i: number) => void
}

export const useDictStore = create<DictStore>((set, get) => ({
  books: [],
  currentBook: null,
  words: [],
  currentIndex: 0,
  knownWords: new Set(),
  unknownWords: new Set(),
  loading: false,

  loadBooks: async () => {
    const books = await window.api.dbDictTags()
    set({ books })
  },

  openBook: async (tag: string) => {
    set({ loading: true, currentBook: tag, currentIndex: 0, knownWords: new Set(), unknownWords: new Set() })
    const words = await window.api.dbDictWords(tag)
    set({ words, loading: false })
  },

  markKnown: () => {
    const { words, currentIndex, knownWords } = get()
    if (currentIndex < words.length) {
      const next = new Set(knownWords)
      next.add(words[currentIndex].word)
      set({ knownWords: next, currentIndex: currentIndex + 1 })
    }
  },

  markUnknown: () => {
    const { words, currentIndex, unknownWords } = get()
    if (currentIndex < words.length) {
      const next = new Set(unknownWords)
      next.add(words[currentIndex].word)
      set({ unknownWords: next, currentIndex: currentIndex + 1 })
    }
  },

  addToWordList: async (word: DictWord) => {
    await window.api.dbDictAddToWordList([word])
  },

  addAllUnknown: async () => {
    const { words, unknownWords } = get()
    const toAdd = words.filter(w => unknownWords.has(w.word))
    if (toAdd.length > 0) {
      await window.api.dbDictAddToWordList(toAdd)
    }
  },

  reset: () => {
    set({ currentBook: null, words: [], currentIndex: 0, knownWords: new Set(), unknownWords: new Set() })
  },

  setCurrentIndex: (i: number) => set({ currentIndex: i }),
}))
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/bridge.ts frontend/src/stores/dictStore.ts
git commit -m "feat: add dict store and bridge bindings"
```

---

### Task 3: Frontend — DictPage (单词书架)

**Files:**
- Create: `frontend/src/pages/DictPage.tsx`

**Interfaces:**
- Consumes: `useDictStore` hook, `DictTag`, `DictWord` types
- Produces: Navigate to `/dict/:tag` when book clicked

- [ ] **Step 1: Create `frontend/src/pages/DictPage.tsx`**

```typescript
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDictStore } from '@/stores/dictStore'
import { BookOpen } from 'lucide-react'

const tagLabels: Record<string, string> = {
  zk: '中考',
  gk: '高考',
  cet4: 'CET-4',
  cet6: 'CET-6',
  ky: '考研',
  toefl: 'TOEFL',
  ielts: 'IELTS',
  gre: 'GRE',
}

export default function DictPage() {
  const navigate = useNavigate()
  const books = useDictStore((s) => s.books)
  const loadBooks = useDictStore((s) => s.loadBooks)

  useEffect(() => {
    loadBooks()
  }, [loadBooks])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">单词书</h1>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {books.map((book) => (
          <button
            key={book.tag}
            onClick={() => navigate(`/dict/${book.tag}`)}
            className="flex flex-col items-center gap-3 p-6 rounded-xl border bg-card hover:bg-accent hover:border-primary/50 transition-colors cursor-pointer"
          >
            <BookOpen className="h-8 w-8 text-primary" />
            <div className="text-center">
              <div className="font-semibold">{tagLabels[book.tag] || book.tag.toUpperCase()}</div>
              <div className="text-sm text-muted-foreground">{book.count} 词</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/DictPage.tsx
git commit -m "feat: add DictPage bookshelf"
```

---

### Task 4: Frontend — ReviewPage (卡片背诵)

**Files:**
- Create: `frontend/src/pages/ReviewPage.tsx`

**Interfaces:**
- Consumes: `useDictStore`, `useParams` for tag
- Produces: Flashcard review UI with known/unknown/add actions

- [ ] **Step 1: Create `frontend/src/pages/ReviewPage.tsx`**

```typescript
import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useDictStore, DictWord } from '@/stores/dictStore'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ThumbsUp, ThumbsDown, Plus, BookOpen } from 'lucide-react'

const tagLabels: Record<string, string> = {
  zk: '中考', gk: '高考', cet4: 'CET-4', cet6: 'CET-6',
  ky: '考研', toefl: 'TOEFL', ielts: 'IELTS', gre: 'GRE',
}

export default function ReviewPage() {
  const { tag } = useParams<{ tag: string }>()
  const navigate = useNavigate()
  const { words, currentIndex, loading, openBook, markKnown, markUnknown, addToWordList, addAllUnknown, unknownWords, knownWords, reset } = useDictStore()
  const [flipped, setFlipped] = useState(false)
  const [addedSet, setAddedSet] = useState<Set<string>>(new Set())

  const label = tagLabels[tag || ''] || (tag || '').toUpperCase()
  const current = words[currentIndex]
  const isDone = currentIndex >= words.length

  useEffect(() => {
    if (tag) {
      openBook(tag)
    }
    return () => { reset() }
  }, [tag])

  const handleAdd = async (word: DictWord) => {
    await addToWordList(word)
    setAddedSet((prev) => new Set(prev).add(word.word))
  }

  const handleFinish = async () => {
    if (unknownWords.size > 0) {
      await addAllUnknown()
    }
    navigate('/dict')
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground">加载中...</div>
  }

  if (isDone) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <BookOpen className="h-12 w-12 text-primary" />
        <h2 className="text-xl font-bold">复习完成！</h2>
        <p className="text-muted-foreground">
          认识 {knownWords.size} 词 · 不认识 {unknownWords.size} 词
          {unknownWords.size > 0 && '（已自动添加到词库）'}
        </p>
        <Button onClick={handleFinish}>返回单词书</Button>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => navigate('/dict')}>
          <ChevronLeft className="h-4 w-4 mr-1" /> 返回
        </Button>
        <span className="text-sm text-muted-foreground">
          {label} · {currentIndex + 1}/{words.length}
        </span>
      </div>

      {/* Card */}
      <div
        className="min-h-[300px] rounded-xl border bg-card p-8 flex flex-col items-center justify-center cursor-pointer select-none"
        onClick={() => setFlipped(!flipped)}
      >
        {!flipped ? (
          <div className="text-3xl font-bold">{current?.word}</div>
        ) : (
          <div className="text-center space-y-3">
            <div className="text-3xl font-bold">{current?.word}</div>
            {current?.phonetic && (
              <div className="text-lg text-muted-foreground">{current.phonetic}</div>
            )}
            <div className="text-lg">{current?.translation}</div>
            {current?.definition && (
              <div className="text-sm text-muted-foreground max-w-md">{current.definition}</div>
            )}
            {current?.tag && (
              <div className="flex gap-1 justify-center flex-wrap">
                {current.tag.split(' ').map((t) => (
                  <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                    {tagLabels[t] || t}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="mt-4 text-xs text-muted-foreground">点击翻转</div>
      </div>

      {/* Actions */}
      <div className="flex justify-center gap-4">
        <Button variant="outline" size="lg" className="gap-2" onClick={markUnknown}>
          <ThumbsDown className="h-5 w-5" /> 不认识
        </Button>
        <Button variant="outline" size="lg" className="gap-2" onClick={markKnown}>
          <ThumbsUp className="h-5 w-5" /> 认识
        </Button>
        {current && (
          <Button
            variant="outline"
            size="lg"
            className="gap-2"
            onClick={() => handleAdd(current)}
            disabled={addedSet.has(current.word)}
          >
            <Plus className="h-5 w-5" /> {addedSet.has(current.word) ? '已入库' : '入库'}
          </Button>
        )}
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${((currentIndex + 1) / words.length) * 100}%` }}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify the frontend builds (at least TypeScript check)**

Run: `cd /Users/lxy/work/aling-go/frontend && npx tsc --noEmit`
Expected: type errors may occur due to missing imports/types in shims — if so, check if `tsconfig.json` has `noEmit` and verify the project uses `window.api` typing via a declaration file.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/ReviewPage.tsx
git commit -m "feat: add ReviewPage flashcard review"
```

---

### Task 5: Frontend — routing + navigation

**Files:**
- Modify: `frontend/src/App.tsx` — add `/dict` and `/dict/:tag` routes
- Modify: `frontend/src/components/Layout.tsx` — add nav item for dict

- [ ] **Step 1: Update `App.tsx`**

Add imports:
```typescript
const Dict = lazy(() => import('@/pages/DictPage'))
const Review = lazy(() => import('@/pages/ReviewPage'))
```

Add routes inside `<Routes>`:
```tsx
<Route path="/dict" element={<Dict />} />
<Route path="/dict/:tag" element={<Review />} />
```

- [ ] **Step 2: Update `Layout.tsx`**

Add import: `import { Library } from 'lucide-react'`

Add nav item at position 3 (after 生词库, before 卡片背诵):
```typescript
{ path: '/dict', label: '单词书', icon: Library },
```

- [ ] **Step 3: Verify frontend builds**

Run: `cd /Users/lxy/work/aling-go/frontend && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Full build verification**

Run: `cd /Users/lxy/work/aling-go && go vet ./...`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/Layout.tsx
git commit -m "feat: add dict routes and nav item"
```

---

## Integration Notes

- `dict.db` must exist in the project root for development (`wails dev` runs from project root)
- For production builds, dict.db needs to be bundled alongside the binary — add it to `build/` or embed via `//go:embed` (requires handling read-only SQLite)
- No existing tests in the project; verification is manual via `wails dev`
