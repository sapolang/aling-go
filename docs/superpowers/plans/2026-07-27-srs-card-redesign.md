# SRS Card Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the SRS card review page with Anki-style two-step interaction, SM-2 algorithm, and refreshed visual layout.

**Architecture:** Go backend gains 3 new DB columns (`repetitions`, `efactor`, `interval`) and updated queries; frontend adds a shared `srs.ts` lib for SM-2 computation, rewrites `WordCard.tsx` with new interaction flow, and updates word store/bridge types.

**Tech Stack:** Go (Wails), React 18 + TypeScript, Zustand, Tailwind CSS, SQLite

## Global Constraints

- SQLite ALTER TABLE does not support IF NOT EXISTS; handle migration with error-tolerant approach
- Existing `level` field kept but no longer drives SRS scheduling
- Export/import JSON must include new fields with backward-compatible defaults
- All Go methods exposed via Wails IPC to frontend

---

### Task 1: Go — Add SRS fields to Word struct and DB schema

**Files:**
- Modify: `types.go`
- Modify: `database.go:30-48` (createTables)
- Modify: `database.go:63-71` (dbWordsAdd)
- Modify: `database.go:79-91` (dbWordsUpdate)
- Modify: `database.go:206-216` (scanWords)
- Modify: `database.go:181-184` (dbImport)
- Modify: `database.go:206-216` (scanWords)

**Interfaces:**
- Produces: `Word` struct with `Repetitions int`, `EFactor float64`, `Interval int`

- [ ] **Step 1: Add fields to Word struct**

In `types.go`, add three fields to `Word`:

```go
type Word struct {
	ID           int     `json:"id"`
	Word         string  `json:"word"`
	Definition   string  `json:"definition"`
	Phonetic     string  `json:"phonetic"`
	Example      string  `json:"example"`
	Tags         string  `json:"tags"`
	Level        int     `json:"level"`
	NextReview   string  `json:"next_review"`
	CreatedAt    string  `json:"created_at"`
	UpdatedAt    string  `json:"updated_at"`
	Repetitions  int     `json:"repetitions"`
	EFactor      float64 `json:"efactor"`
	Interval     int     `json:"interval"`
}
```

- [ ] **Step 2: Add columns to CREATE TABLE**

In `database.go` `createTables()`, add the new columns to the words DDL:

```go
_, err := db.Exec(`
	CREATE TABLE IF NOT EXISTS words (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		word TEXT NOT NULL,
		definition TEXT DEFAULT '',
		phonetic TEXT DEFAULT '',
		example TEXT DEFAULT '',
		tags TEXT DEFAULT '',
		level INTEGER DEFAULT 1,
		next_review TEXT DEFAULT (date('now')),
		created_at TEXT DEFAULT (datetime('now','localtime')),
		updated_at TEXT DEFAULT (datetime('now','localtime')),
		repetitions INTEGER DEFAULT 0,
		efactor REAL DEFAULT 2.5,
		interval INTEGER DEFAULT 0
	);
	CREATE TABLE IF NOT EXISTS tags (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL UNIQUE,
		color TEXT NOT NULL DEFAULT '#3b82f6'
	);
`)
```

- [ ] **Step 3: Update dbWordsAdd to include new fields**

```go
func dbWordsAdd(wordJSON string) int {
	var w Word
	if err := json.Unmarshal([]byte(wordJSON), &w); err != nil {
		return 0
	}
	res, err := db.Exec(
		"INSERT INTO words (word, definition, phonetic, example, tags, level, next_review, repetitions, efactor, interval) VALUES (?,?,?,?,?,?,?,?,?,?)",
		w.Word, w.Definition, w.Phonetic, w.Example, w.Tags, w.Level, w.NextReview, w.Repetitions, w.EFactor, w.Interval,
	)
	if err != nil {
		return 0
	}
	id, _ := res.LastInsertId()
	return int(id)
}
```

- [ ] **Step 4: Update dbWordsUpdate to accept new fields**

```go
func dbWordsUpdate(id int, dataJSON string) {
	var data map[string]interface{}
	if err := json.Unmarshal([]byte(dataJSON), &data); err != nil {
		return
	}
	if _, err := db.Exec(
		"UPDATE words SET word=?, definition=?, phonetic=?, example=?, tags=?, level=?, next_review=?, repetitions=?, efactor=?, interval=?, updated_at=datetime('now','localtime') WHERE id=?",
		data["word"], data["definition"], data["phonetic"], data["example"],
		data["tags"], data["level"], data["next_review"],
		data["repetitions"], data["efactor"], data["interval"], id,
	); err != nil {
		fmt.Fprintf(os.Stderr, "dbWordsUpdate: %v\n", err)
	}
}
```

- [ ] **Step 5: Update scanWords to scan new columns**

```go
func scanWords(rows *sql.Rows) []Word {
	words := make([]Word, 0)
	for rows.Next() {
		var w Word
		if err := rows.Scan(&w.ID, &w.Word, &w.Definition, &w.Phonetic, &w.Example,
			&w.Tags, &w.Level, &w.NextReview, &w.CreatedAt, &w.UpdatedAt,
			&w.Repetitions, &w.EFactor, &w.Interval); err != nil {
			continue
		}
		words = append(words, w)
	}
	return words
}
```

- [ ] **Step 6: Update dbImport to include new fields**

```go
_, err := db.Exec(
	"INSERT OR IGNORE INTO words (word, definition, phonetic, example, tags, level, next_review, repetitions, efactor, interval) VALUES (?,?,?,?,?,?,?,?,?,?)",
	w.Word, w.Definition, w.Phonetic, w.Example, w.Tags, w.Level, w.NextReview, w.Repetitions, w.EFactor, w.Interval,
)
```

- [ ] **Step 7: Verify Go builds**

Run: `go vet ./...`
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add types.go database.go
git commit -m "feat: add SRS fields (repetitions, efactor, interval) to Word and DB schema"
```

---

### Task 2: Go — Add DB migration for existing installations

**Files:**
- Modify: `migrate.go`

**Interfaces:**
- Consumes: `Word` with new fields from Task 1
- Produces: existing `userData.db` databases get new columns

- [ ] **Step 1: Add migration function**

Add a new function in `migrate.go`:

```go
func migrateSRS() {
	// Try adding each column; ignore "duplicate column" errors
	cols := []struct{ name, def string }{
		{"repetitions", "INTEGER DEFAULT 0"},
		{"efactor", "REAL DEFAULT 2.5"},
		{"interval", "INTEGER DEFAULT 0"},
	}
	for _, c := range cols {
		db.Exec("ALTER TABLE words ADD COLUMN " + c.name + " " + c.def)
	}
}
```

- [ ] **Step 2: Call migration in migrateIfNeeded**

In `migrateIfNeeded()`, after the existing migration logic completes, add a call:

```go
func (a *App) migrateIfNeeded() {
	migrateFlag := filepath.Join(a.dataDir, ".migrated")
	if _, err := os.Stat(migrateFlag); err == nil {
		return
	}

	oldDBPath := a.findOldDatabase()
	if oldDBPath == "" {
		os.WriteFile(migrateFlag, []byte("skipped"), 0644)
		return
	}

	oldDB, err := sql.Open("sqlite", oldDBPath)
	if err != nil {
		return
	}
	defer oldDB.Close()

	rows, err := oldDB.Query("SELECT * FROM words")
	if err == nil {
		for rows.Next() {
			var w Word
			rows.Scan(&w.ID, &w.Word, &w.Definition, &w.Phonetic, &w.Example,
				&w.Tags, &w.Level, &w.NextReview, &w.CreatedAt, &w.UpdatedAt)
			db.Exec(
				"INSERT OR IGNORE INTO words (word, definition, phonetic, example, tags, level, next_review, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
				w.Word, w.Definition, w.Phonetic, w.Example, w.Tags, w.Level, w.NextReview, w.CreatedAt, w.UpdatedAt,
			)
		}
		rows.Close()
	}

	rows, err = oldDB.Query("SELECT * FROM tags")
	if err == nil {
		for rows.Next() {
			var t Tag
			rows.Scan(&t.ID, &t.Name, &t.Color)
			db.Exec("INSERT OR IGNORE INTO tags (name, color) VALUES (?,?)", t.Name, t.Color)
		}
		rows.Close()
	}

	migrateSRS()

	os.WriteFile(migrateFlag, []byte("done"), 0644)
}
```

Note: also call `migrateSRS()` in the non-migration path to ensure existing installations get the columns added. Add this after the `.migrated` flag check returns early:

```go
func (a *App) migrateIfNeeded() {
	// Run SRS migration even if .migrated exists (for users who already migrated)
	migrateSRS()

	migrateFlag := filepath.Join(a.dataDir, ".migrated")
	// ... rest of function
}
```

- [ ] **Step 3: Verify Go builds**

Run: `go vet ./...`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add migrate.go
git commit -m "feat: add DB migration for SRS columns on existing installations"
```

---

### Task 3: Go — Update review query and add review count

**Files:**
- Modify: `database.go:107-115` (dbWordsGetReview)
- Modify: `database.go` (add dbWordsGetReviewCount)
- Modify: `app.go` (add DbWordsGetReviewCount method)

**Interfaces:**
- Consumes: Word with new fields from Task 1
- Produces: `DbWordsGetReview() []Word` (no LIMIT), `DbWordsGetReviewCount() int`

- [ ] **Step 1: Remove LIMIT 20 from dbWordsGetReview**

```go
func dbWordsGetReview() []Word {
	today := time.Now().Format("2006-01-02")
	rows, err := db.Query("SELECT * FROM words WHERE next_review <= ? ORDER BY next_review ASC", today)
	if err != nil {
		return []Word{}
	}
	defer rows.Close()
	return scanWords(rows)
}
```

- [ ] **Step 2: Add dbWordsGetReviewCount function**

In `database.go`, add after `dbWordsGetReview`:

```go
func dbWordsGetReviewCount() int {
	today := time.Now().Format("2006-01-02")
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM words WHERE next_review <= ?", today).Scan(&count); err != nil {
		return 0
	}
	return count
}
```

- [ ] **Step 3: Expose in app.go**

In `app.go`, add after `DbWordsGetReview`:

```go
func (a *App) DbWordsGetReviewCount() int {
	return dbWordsGetReviewCount()
}
```

- [ ] **Step 4: Register in bindings**

In `main.go`, confirm that `App` struct methods are automatically bound by Wails. No additional changes needed since Wails auto-binds all exported methods on the `App` struct.

- [ ] **Step 5: Verify Go builds**

Run: `go vet ./...`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add database.go app.go
git commit -m "feat: remove LIMIT from review query, add review count endpoint"
```

---

### Task 4: Frontend — Create shared SRS library

**Files:**
- Create: `frontend/src/lib/srs.ts`

**Interfaces:**
- Produces:
  - `gradeOptions: Array<{ grade: number; label: string; key: string; className: string }>`
  - `sm2(efactor: number, interval: number, repetitions: number, quality: number): { nextReview: string; newEfactor: number; newInterval: number; newRepetitions: number }`

- [ ] **Step 1: Create srs.ts**

```typescript
export const gradeOptions = [
  { grade: 1, label: '忘记', key: '1', className: 'bg-red-500 hover:bg-red-600' },
  { grade: 3, label: '困难', key: '2', className: 'bg-orange-500 hover:bg-orange-600' },
  { grade: 4, label: '良好', key: '3', className: 'bg-blue-500 hover:bg-blue-600' },
  { grade: 5, label: '简单', key: '4', className: 'bg-green-500 hover:bg-green-600' },
]

export interface SrsResult {
  nextReview: string
  newEfactor: number
  newInterval: number
  newRepetitions: number
}

export function sm2(
  efactor: number,
  interval: number,
  repetitions: number,
  quality: number,
): SrsResult {
  if (efactor <= 0) efactor = 2.5

  let newInterval: number
  let newRepetitions: number

  if (quality < 3) {
    newInterval = 1
    newRepetitions = 0
  } else {
    if (repetitions === 0) {
      newInterval = 1
    } else if (repetitions === 1) {
      newInterval = 6
    } else {
      newInterval = Math.round(interval * efactor)
    }
    newRepetitions = repetitions + 1
  }

  if (quality === 3 && repetitions > 0) {
    newInterval = Math.max(1, Math.round(interval * 1.2))
  } else if (quality === 5) {
    newInterval = Math.round(newInterval * 1.3)
  }

  const newEfactor = Math.max(
    1.3,
    efactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)),
  )

  const nextDate = new Date(Date.now() + newInterval * 86400000)
  const nextReview = nextDate.toISOString().split('T')[0]

  return { nextReview, newEfactor, newInterval, newRepetitions }
}

export function srsIntervalLabel(quality: number, currentWord: {
  efactor: number
  interval: number
  repetitions: number
}): string {
  if (quality === 1) return '1天后'
  const result = sm2(currentWord.efactor, currentWord.interval, currentWord.repetitions, quality)
  return `${result.newInterval}天后`
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/srs.ts
git commit -m "feat: add shared SRS library (SM-2 algorithm, grade options)"
```

---

### Task 5: Frontend — Update word store with new fields and review count

**Files:**
- Modify: `frontend/src/stores/wordStore.ts`
- Modify: `frontend/src/api/bridge.ts` (add DbWordsGetReviewCount)

**Interfaces:**
- Consumes: `sm2` from Task 4
- Produces: `useWordStore` with `reviewTotal`, `reviewCompleted`, `loadReviewCount`, updated `Word` interface

- [ ] **Step 1: Update Word interface in wordStore.ts**

Replace the existing `Word` interface:

```typescript
interface Word {
  id: number
  word: string
  definition: string
  phonetic: string
  example: string
  tags: string
  level: number
  next_review: string
  created_at: string
  updated_at: string
  repetitions: number
  efactor: number
  interval: number
}
```

- [ ] **Step 2: Add reviewTotal and reviewCompleted to store**

Update the `WordStore` interface and initial state:

```typescript
interface WordStore {
  words: Word[]
  tags: Tag[]
  reviewWords: Word[]
  reviewTotal: number
  reviewCompleted: number
  searchQuery: string
  selectedTag: string
  loading: boolean

  loadWords: () => Promise<void>
  loadTags: () => Promise<void>
  loadReview: () => Promise<void>
  loadReviewCount: () => Promise<void>
  addWord: (word: any) => Promise<void>
  updateWord: (id: number, data: Partial<Word>) => Promise<void>
  deleteWord: (id: number) => Promise<void>
  deleteBatch: (ids: number[]) => Promise<void>
  setSearchQuery: (q: string) => void
  setSelectedTag: (tag: string) => void
  incrementCompleted: () => void
}

export const useWordStore = create<WordStore>((set, get) => ({
  words: [],
  tags: [],
  reviewWords: [],
  reviewTotal: 0,
  reviewCompleted: 0,
  searchQuery: '',
  selectedTag: '',
  loading: false,

  loadWords: async () => {
    set({ loading: true })
    const words = await window.api.dbWordsList()
    set({ words, loading: false })
  },
  loadTags: async () => {
    const tags = await window.api.dbTagsList()
    set({ tags })
  },
  loadReview: async () => {
    const reviewWords = await window.api.dbWordsGetReview()
    set({ reviewWords, reviewTotal: reviewWords.length, reviewCompleted: 0 })
  },
  loadReviewCount: async () => {
    const count = await window.api.dbWordsGetReviewCount()
    set({ reviewTotal: count })
  },
  addWord: async (word) => {
    await window.api.dbWordsAdd(word)
    get().loadWords()
  },
  updateWord: async (id, data) => {
    await window.api.dbWordsUpdate(id, data)
  },
  deleteWord: async (id) => {
    await window.api.dbWordsDelete(id)
    get().loadWords()
  },
  deleteBatch: async (ids) => {
    await window.api.dbWordsDeleteBatch(ids)
    get().loadWords()
  },
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setSelectedTag: (selectedTag) => set({ selectedTag }),
  incrementCompleted: () => set((s) => ({ reviewCompleted: s.reviewCompleted + 1 })),
}))
```

- [ ] **Step 3: Add DbWordsGetReviewCount to bridge.ts**

In `frontend/src/api/bridge.ts`, add after `dbWordsGetReview`:

```typescript
dbWordsGetReviewCount: () => app.DbWordsGetReviewCount(),
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/stores/wordStore.ts frontend/src/api/bridge.ts
git commit -m "feat: add review count and SRS fields to word store and bridge"
```

---

### Task 6: Frontend — Rewrite WordCard page

**Files:**
- Modify: `frontend/src/pages/WordCard.tsx`

**Interfaces:**
- Consumes: `useWordStore`, `gradeOptions`, `sm2`, `srsIntervalLabel` from Task 4, `speak` from `@/lib/tts`
- Produces: New card review page with two-step flow, SM-2 rating, progress bar, keyboard shortcuts

- [ ] **Step 1: Write the new WordCard.tsx**

Replace the entire content of `frontend/src/pages/WordCard.tsx`:

```typescript
import { useEffect, useState, useCallback, useRef } from 'react'
import { useWordStore } from '@/stores/wordStore'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { speak } from '@/lib/tts'
import { gradeOptions, sm2, srsIntervalLabel } from '@/lib/srs'
import { Speaker, ChevronLeft, ChevronRight } from 'lucide-react'

export default function WordCardPage() {
  const {
    reviewWords, reviewTotal, reviewCompleted,
    loadReview, updateWord, incrementCompleted,
  } = useWordStore()
  const [currentIndex, setCurrentIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [showButtons, setShowButtons] = useState(false)
  const [rating, setRating] = useState(false)
  const flipTimer = useRef<number>()

  useEffect(() => { loadReview() }, [])

  useEffect(() => {
    if (flipped) {
      flipTimer.current = window.setTimeout(() => setShowButtons(true), 300)
    } else {
      setShowButtons(false)
      clearTimeout(flipTimer.current)
    }
    return () => clearTimeout(flipTimer.current)
  }, [flipped])

  const current = reviewWords[currentIndex]

  const handleGrade = useCallback(async (quality: number) => {
    if (!current || rating) return
    setRating(true)
    const { nextReview, newEfactor, newInterval, newRepetitions } = sm2(
      current.efactor || 2.5,
      current.interval || 0,
      current.repetitions || 0,
      quality,
    )
    await updateWord(current.id, {
      level: quality === 1 ? 1 : quality === 3 ? 2 : 3,
      next_review: nextReview,
      repetitions: newRepetitions,
      efactor: newEfactor,
      interval: newInterval,
    })
    incrementCompleted()
    setRating(false)
    setFlipped(false)
    if (currentIndex < reviewWords.length - 1) {
      setCurrentIndex(currentIndex + 1)
    } else {
      loadReview()
      setCurrentIndex(0)
    }
  }, [current, currentIndex, rating, reviewWords.length, updateWord, incrementCompleted, loadReview])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === ' ') { e.preventDefault(); setFlipped((f) => !f) }
      if (!flipped) return
      if (e.key === '1') handleGrade(1)
      if (e.key === '2') handleGrade(3)
      if (e.key === '3') handleGrade(4)
      if (e.key === '4') handleGrade(5)
      if (e.key === 'ArrowLeft') { setFlipped(false); setCurrentIndex((i) => Math.max(0, i - 1)) }
      if (e.key === 'ArrowRight') { setFlipped(false); setCurrentIndex((i) => Math.min(reviewWords.length - 1, i + 1)) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [flipped, handleGrade, reviewWords.length])

  if (reviewWords.length === 0 && reviewCompleted === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <Card className="p-12 text-center">
          <p className="text-lg text-muted-foreground mb-2">今日没有待复习的词条</p>
          <p className="text-sm text-muted-foreground">前往播放器学习新词或浏览生词库</p>
        </Card>
      </div>
    )
  }

  if (reviewWords.length === 0 && reviewCompleted > 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <Card className="p-12 text-center">
          <p className="text-2xl font-bold mb-2">今日复习完成</p>
          <p className="text-lg text-muted-foreground mb-4">本次复习了 {reviewCompleted} 个词</p>
        </Card>
      </div>
    )
  }

  const progressPct = reviewTotal > 0 ? (reviewCompleted / reviewTotal) * 100 : 0

  return (
    <div className="max-w-lg mx-auto space-y-4 pt-6">
      <div className="space-y-1">
        <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground text-center">
          今日待复习 {reviewTotal} | 已完成 {reviewCompleted} | 剩余 {reviewTotal - reviewCompleted}
        </p>
      </div>

      <div
        className="cursor-pointer"
        style={{ perspective: '1000px' }}
        onClick={() => setFlipped(!flipped)}
      >
        <div
          className="transition-transform duration-500 relative"
          style={{
            transformStyle: 'preserve-3d',
            transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
            minHeight: '340px',
          }}
        >
          {/* 正面 */}
          <Card
            className="absolute inset-0 flex items-center justify-center"
            style={{ backfaceVisibility: 'hidden' }}
          >
            <CardContent className="text-center p-8">
              <h2 className="text-5xl font-bold mb-3">{current.word}</h2>
              {current.phonetic && (
                <p className="text-xl text-muted-foreground mb-6">{current.phonetic}</p>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => { e.stopPropagation(); speak(current.word) }}
              >
                <Speaker className="h-4 w-4 mr-1" /> 朗读
              </Button>
              <p className="text-xs text-muted-foreground mt-6">按空格键翻面</p>
            </CardContent>
          </Card>

          {/* 反面 */}
          <Card
            className="absolute inset-0 flex items-center justify-center"
            style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
          >
            <CardContent className="text-center p-8 space-y-3">
              <h2 className="text-2xl font-bold">{current.word}</h2>
              {current.phonetic && (
                <p className="text-sm text-muted-foreground">{current.phonetic}</p>
              )}
              <p className="text-3xl font-semibold text-primary">{current.definition}</p>
              {current.example && (
                <p className="text-base text-muted-foreground italic">"{current.example}"</p>
              )}
              {current.tags && (
                <div className="flex justify-center gap-1 flex-wrap">
                  {current.tags.split(',').map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs">{tag.trim()}</Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* 评分按钮 */}
      <div
        className={`flex gap-3 justify-center transition-all duration-200 ${
          showButtons ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
        }`}
      >
        {gradeOptions.map((opt) => (
          <Button
            key={opt.grade}
            disabled={rating}
            className={`${opt.className} text-white min-w-[80px] rounded-xl flex-col h-auto py-3 gap-0.5`}
            onClick={() => handleGrade(opt.grade)}
          >
            <span className="text-sm font-semibold">{opt.label}</span>
            <span className="text-xs opacity-80">
              {srsIntervalLabel(opt.grade, current)}
            </span>
            <span className="text-[10px] opacity-60">({opt.key})</span>
          </Button>
        ))}
      </div>

      {/* 导航按钮 */}
      <div className="flex justify-center gap-4">
        <Button variant="outline" size="sm" onClick={() => { setFlipped(false); setCurrentIndex(Math.max(0, currentIndex - 1)) }}>
          <ChevronLeft className="h-4 w-4 mr-1" /> 上一个
        </Button>
        <Button variant="outline" size="sm" onClick={() => { setFlipped(false); setCurrentIndex(Math.min(reviewWords.length - 1, currentIndex + 1)) }}>
          下一个 <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/WordCard.tsx
git commit -m "feat: rewrite WordCard with two-step SM-2 SRS, progress bar, keyboard shortcuts"
```

---

### Task 7: Final verification and linting

**Files:**
- None (verification only)

- [ ] **Step 1: Run Go vet**

Run: `go vet ./...`
Expected: no errors

- [ ] **Step 2: Run TypeScript type check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Run full build test**

Run: `make build`
Expected: builds without errors

- [ ] **Step 4: Commit (if any fixes needed)**

```bash
git add -A
git commit -m "chore: final lint fixes"
```
