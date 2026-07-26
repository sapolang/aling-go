# Article Typing Practice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a typing practice feature where users type through English articles (from typewords.cc NCE corpus) with follow/dictation modes, progress tracking, and mistake-to-vocabulary integration.

**Architecture:** Go backend opens `articles.db` (SQLite, 275 articles across 4 NCE categories) and exposes query methods to the React frontend via Wails bridge. An `articleStore` (Zustand) manages data; two new pages (`ArticleList`, `ArticleTyping`) handle UI. Typing interaction uses character-by-character state tracking. Typing records/progress are stored in `userData.db`. Audio streams directly from typewords.cc CDN.

**Tech Stack:** Go + modernc.org/sqlite + Wails v2 + React 18 + TypeScript + Zustand + TailwindCSS + shadcn/ui + lucide-react

## Global Constraints

- Follow existing patterns: Go methods return JSON-serializable types; frontend stores use Zustand; bridge.ts wraps `window.go.main.App` calls
- `articles.db` opened at startup with multi-path search (data dir, cwd, exe dir, exe/Resources)
- Typing progress/records via `userData.db` with auto-migration in `createTables()`
- Audio CDN base: `https://files.typewords.cc`, appending `article.audioSrc` yields full URL
- Wails v2 auto-marshals Go return values: slices return directly, pointers/structs serialize to JSON strings that bridge must `.then(s => JSON.parse(s))` or handle null
- `lrcPosition` in DB is JSON string like `[[14.2,19.03],[19.03,28.91],...]` — parsed on frontend
- Use Tailwind multi-theme `--background`, `--card`, `--muted-foreground`, `--border`, `--primary` etc.

---

### Task 1: Go backend — types + articles_db.go + tables + app wiring

**Files:**
- Modify: `types.go` (+ new types)
- Create: `articles_db.go`
- Modify: `database.go:29-53` (createTables)
- Modify: `app.go:39-48` (startup) + end of file (new methods)

**Interfaces:**
- Produces: `ArticleCategory`, `ArticleItem`, `TypingRecord`, `TypingProgress` types; `openArticleDB`, `dbGetCategories`, `dbGetArticles`, `dbGetArticle`, `dbGetTypingProgress`, `dbSaveTypingProgress`, `dbGetTypingRecords`, `dbSaveTypingRecord`, `dbAddWordsBatch`
- Exposes via App methods: `GetCategories`, `GetArticles`, `GetArticle`, `GetTypingProgress`, `SaveTypingProgress`, `GetTypingRecords`, `SaveTypingRecord`, `AddWordsBatch`

- [ ] **Step 1: Add types to types.go**

Append to `types.go`:

```go
type ArticleCategory struct {
	ID          int    `json:"id"`
	EnName      string `json:"enName"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Cover       string `json:"cover"`
	Length      int    `json:"length"`
}

type ArticleItem struct {
	ID             int    `json:"id"`
	CategoryEnName string `json:"categoryEnName"`
	Title          string `json:"title"`
	TitleTranslate string `json:"titleTranslate"`
	Text           string `json:"text"`
	TextTranslate  string `json:"textTranslate"`
	AudioSrc       string `json:"audioSrc"`
	LrcPosition    string `json:"lrcPosition"`
	QuestionJSON   string `json:"questionJson"`
	IndexOrder     int    `json:"indexOrder"`
}

type TypingRecord struct {
	ID        int     `json:"id"`
	ArticleID int     `json:"articleId"`
	Mode      string  `json:"mode"`
	Accuracy  float64 `json:"accuracy"`
	WPM       float64 `json:"wpm"`
	Duration  int     `json:"duration"`
	Mistakes  string  `json:"mistakes"`
	CreatedAt string  `json:"createdAt"`
}

type TypingProgress struct {
	ArticleID    int     `json:"articleId"`
	Mode         string  `json:"mode"`
	Position     int     `json:"position"`
	Completed    bool    `json:"completed"`
	BestAccuracy float64 `json:"bestAccuracy"`
	BestWPM      float64 `json:"bestWpm"`
	UpdatedAt    string  `json:"updatedAt"`
}
```

- [ ] **Step 2: Add typing tables to createTables()**

In `database.go`, in `createTables()` `db.Exec` SQL string, append after the existing `tags` table CREATE:

```sql
CREATE TABLE IF NOT EXISTS typing_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id INTEGER NOT NULL,
    mode TEXT NOT NULL,
    accuracy REAL DEFAULT 0,
    wpm REAL DEFAULT 0,
    duration INTEGER DEFAULT 0,
    mistakes TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS typing_progress (
    article_id INTEGER NOT NULL,
    mode TEXT NOT NULL,
    position INTEGER DEFAULT 0,
    completed INTEGER DEFAULT 0,
    best_accuracy REAL DEFAULT 0,
    best_wpm REAL DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (article_id, mode)
);
```

- [ ] **Step 3: Build Go to verify types compile**

```bash
go build -o /dev/null . 2>&1
```

Expected: no errors. (tables won't execute yet, just verify the types compile)

- [ ] **Step 4: Commit types + tables**

```bash
git add types.go database.go && git commit -m "feat: add article/typing types and DB tables"
```

- [ ] **Step 5: Create articles_db.go**

Create `articles_db.go`:

```go
package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

var articleDB *sql.DB

func openArticleDB(dataDir string) error {
	paths := []string{
		filepath.Join(dataDir, "articles.db"),
		"articles.db",
	}
	exe, _ := os.Executable()
	if exe != "" {
		exeDir := filepath.Dir(exe)
		paths = append(paths, filepath.Join(exeDir, "articles.db"))
		paths = append(paths, filepath.Join(exeDir, "..", "Resources", "articles.db"))
	}
	var dbPath string
	for _, p := range paths {
		if _, err := os.Stat(p); err == nil {
			dbPath = p
			break
		}
	}
	if dbPath == "" {
		return fmt.Errorf("articles.db not found in any search path")
	}
	var err error
	articleDB, err = sql.Open("sqlite", dbPath)
	if err != nil {
		return err
	}
	return articleDB.Ping()
}

func dbGetCategories() []ArticleCategory {
	rows, err := articleDB.Query("SELECT id, en_name, name, description, cover, length FROM categories ORDER BY id")
	if err != nil {
		return []ArticleCategory{}
	}
	defer rows.Close()
	var cats []ArticleCategory
	for rows.Next() {
		var c ArticleCategory
		if err := rows.Scan(&c.ID, &c.EnName, &c.Name, &c.Description, &c.Cover, &c.Length); err != nil {
			continue
		}
		cats = append(cats, c)
	}
	return cats
}

func dbGetArticles(categoryEnName string) []ArticleItem {
	rows, err := articleDB.Query(
		`SELECT id, category_en_name, title, title_translate, text, text_translate,
		        audio_src, lrc_position, question_json, index_order
		 FROM articles WHERE category_en_name=? ORDER BY index_order`,
		categoryEnName,
	)
	if err != nil {
		return []ArticleItem{}
	}
	defer rows.Close()
	var items []ArticleItem
	for rows.Next() {
		var a ArticleItem
		if err := rows.Scan(&a.ID, &a.CategoryEnName, &a.Title, &a.TitleTranslate,
			&a.Text, &a.TextTranslate, &a.AudioSrc, &a.LrcPosition, &a.QuestionJSON, &a.IndexOrder); err != nil {
			continue
		}
		items = append(items, a)
	}
	return items
}

func dbGetArticle(id int) *ArticleItem {
	var a ArticleItem
	err := articleDB.QueryRow(
		`SELECT id, category_en_name, title, title_translate, text, text_translate,
		        audio_src, lrc_position, question_json, index_order
		 FROM articles WHERE id=?`, id,
	).Scan(&a.ID, &a.CategoryEnName, &a.Title, &a.TitleTranslate,
		&a.Text, &a.TextTranslate, &a.AudioSrc, &a.LrcPosition, &a.QuestionJSON, &a.IndexOrder)
	if err != nil {
		return nil
	}
	return &a
}

func dbGetTypingProgress(articleID int, mode string) string {
	var p TypingProgress
	err := db.QueryRow(
		`SELECT article_id, mode, position, completed, best_accuracy, best_wpm, updated_at
		 FROM typing_progress WHERE article_id=? AND mode=?`,
		articleID, mode,
	).Scan(&p.ArticleID, &p.Mode, &p.Position, &p.Completed, &p.BestAccuracy, &p.BestWPM, &p.UpdatedAt)
	if err != nil {
		return ""
	}
	b, _ := json.Marshal(p)
	return string(b)
}

func dbSaveTypingProgress(progressJSON string) {
	var p TypingProgress
	if err := json.Unmarshal([]byte(progressJSON), &p); err != nil {
		return
	}
	_, _ = db.Exec(
		`INSERT OR REPLACE INTO typing_progress (article_id, mode, position, completed, best_accuracy, best_wpm, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'))`,
		p.ArticleID, p.Mode, p.Position, boolToInt(p.Completed), p.BestAccuracy, p.BestWPM,
	)
}

func boolToInt(b bool) int {
	if b { return 1 }
	return 0
}

func dbGetTypingRecords(articleID int) string {
	rows, err := db.Query(
		`SELECT id, article_id, mode, accuracy, wpm, duration, mistakes, created_at
		 FROM typing_records WHERE article_id=? ORDER BY created_at DESC`,
		articleID,
	)
	if err != nil {
		return "[]"
	}
	defer rows.Close()
	var records []TypingRecord
	for rows.Next() {
		var r TypingRecord
		if err := rows.Scan(&r.ID, &r.ArticleID, &r.Mode, &r.Accuracy, &r.WPM, &r.Duration, &r.Mistakes, &r.CreatedAt); err != nil {
			continue
		}
		records = append(records, r)
	}
	b, _ := json.Marshal(records)
	return string(b)
}

func dbSaveTypingRecord(recordJSON string) {
	var r TypingRecord
	if err := json.Unmarshal([]byte(recordJSON), &r); err != nil {
		return
	}
	_, _ = db.Exec(
		`INSERT INTO typing_records (article_id, mode, accuracy, wpm, duration, mistakes) VALUES (?, ?, ?, ?, ?, ?)`,
		r.ArticleID, r.Mode, r.Accuracy, r.WPM, r.Duration, r.Mistakes,
	)
}

func dbAddWordsBatch(wordsJSON string) int {
	var words []Word
	if err := json.Unmarshal([]byte(wordsJSON), &words); err != nil {
		return 0
	}
	count := 0
	for _, w := range words {
		res, err := db.Exec(
			"INSERT OR IGNORE INTO words (word, definition, phonetic) VALUES (?, ?, ?)",
			w.Word, w.Definition, w.Phonetic,
		)
		if err != nil {
			continue
		}
		n, _ := res.RowsAffected()
		if n > 0 {
			count++
		}
	}
	return count
}
```

- [ ] **Step 6: Wire article DB open in app.go startup**

In `app.go` `startup()`, AFTER the `dict.OpenDictDB(a.dataDir, db)` line, add:

```go
if err := openArticleDB(a.dataDir); err != nil {
    println("Article DB init error:", err.Error())
}
```

- [ ] **Step 7: Add App method wrappers in app.go**

Add at end of `app.go`:

```go
// --- Articles ---

func (a *App) GetCategories() []ArticleCategory {
	return dbGetCategories()
}

func (a *App) GetArticles(categoryEnName string) []ArticleItem {
	return dbGetArticles(categoryEnName)
}

func (a *App) GetArticle(id int) string {
	item := dbGetArticle(id)
	if item == nil {
		return ""
	}
	b, _ := json.Marshal(item)
	return string(b)
}

func (a *App) GetTypingProgress(articleID int, mode string) string {
	return dbGetTypingProgress(articleID, mode)
}

func (a *App) SaveTypingProgress(progressJSON string) {
	dbSaveTypingProgress(progressJSON)
}

func (a *App) GetTypingRecords(articleID int) string {
	return dbGetTypingRecords(articleID)
}

func (a *App) SaveTypingRecord(recordJSON string) {
	dbSaveTypingRecord(recordJSON)
}

func (a *App) AddWordsBatch(wordsJSON string) int {
	return dbAddWordsBatch(wordsJSON)
}
```

- [ ] **Step 8: Build and verify Go compiles**

```bash
go build -o /dev/null . 2>&1
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add articles_db.go app.go && git commit -m "feat: add article DB backend with typing progress/records"
```

---

### Task 2: Frontend types + bridge API

**Files:**
- Modify: `frontend/src/types/electron.d.ts`
- Modify: `frontend/src/api/bridge.ts`

- [ ] **Step 1: Add TypeScript types to electron.d.ts**

Add BEFORE `export interface ElectronAPI {`:

```typescript
export interface ArticleCategory {
  id: number
  enName: string
  name: string
  description: string
  cover: string
  length: number
}

export interface ArticleItem {
  id: number
  categoryEnName: string
  title: string
  titleTranslate: string
  text: string
  textTranslate: string
  audioSrc: string
  lrcPosition: string
  questionJson: string
  indexOrder: number
}

export interface TypingProgress {
  articleId: number
  mode: string
  position: number
  completed: boolean
  bestAccuracy: number
  bestWpm: number
  updatedAt: string
}

export interface TypingRecord {
  id: number
  articleId: number
  mode: string
  accuracy: number
  wpm: number
  duration: number
  mistakes: string
  createdAt: string
}
```

- [ ] **Step 2: Add API method signatures to ElectronAPI interface**

Inside `export interface ElectronAPI {`, before `}`, add:

```typescript
  // Articles
  getCategories: () => Promise<ArticleCategory[]>
  getArticles: (categoryEnName: string) => Promise<ArticleItem[]>
  getArticle: (id: number) => Promise<string>
  getTypingProgress: (articleId: number, mode: string) => Promise<string>
  saveTypingProgress: (progressJson: string) => Promise<void>
  getTypingRecords: (articleId: number) => Promise<string>
  saveTypingRecord: (recordJson: string) => Promise<void>
  addWordsBatch: (wordsJson: string) => Promise<number>
```

- [ ] **Step 3: Add bridge methods to bridge.ts**

Inside `initBridge()`, `window.api = {` block, add:

```typescript
      // Articles
      getCategories: () => app.GetCategories(),
      getArticles: (categoryEnName: string) => app.GetArticles(categoryEnName),
      getArticle: (id: number) => app.GetArticle(id),
      getTypingProgress: (articleId: number, mode: string) => app.GetTypingProgress(articleId, mode),
      saveTypingProgress: (progressJson: string) => app.SaveTypingProgress(progressJson),
      getTypingRecords: (articleId: number) => app.GetTypingRecords(articleId),
      saveTypingRecord: (recordJson: string) => app.SaveTypingRecord(recordJson),
      addWordsBatch: (wordsJson: string) => app.AddWordsBatch(wordsJson),
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/electron.d.ts frontend/src/api/bridge.ts && git commit -m "feat: add article types and bridge API"
```

---

### Task 3: Frontend article store

**Files:**
- Create: `frontend/src/stores/articleStore.ts`

- [ ] **Step 1: Create articleStore.ts**

Create `frontend/src/stores/articleStore.ts`:

```typescript
import { create } from 'zustand'
import type { ArticleCategory, ArticleItem, TypingProgress, TypingRecord } from '@/types/electron'

interface ArticleStore {
  categories: ArticleCategory[]
  currentCategory: ArticleCategory | null
  articles: ArticleItem[]
  currentArticle: ArticleItem | null
  typingProgress: TypingProgress | null
  typingRecords: TypingRecord[]
  loading: boolean

  loadCategories: () => Promise<void>
  loadArticles: (categoryEnName: string) => Promise<void>
  loadArticle: (id: number) => Promise<void>
  loadTypingProgress: (articleId: number, mode: string) => Promise<void>
  loadTypingRecords: (articleId: number) => Promise<void>
  saveTypingProgress: (p: Omit<TypingProgress, 'updatedAt'>) => Promise<void>
  saveTypingRecord: (r: Omit<TypingRecord, 'id' | 'createdAt'>) => Promise<void>
}

export const useArticleStore = create<ArticleStore>((set, get) => ({
  categories: [],
  currentCategory: null,
  articles: [],
  currentArticle: null,
  typingProgress: null,
  typingRecords: [],
  loading: false,

  loadCategories: async () => {
    set({ loading: true })
    const categories = await window.api.getCategories()
    set({ categories, loading: false })
  },

  loadArticles: async (categoryEnName: string) => {
    set({ loading: true })
    const articles = await window.api.getArticles(categoryEnName)
    set({ articles, currentCategory: get().categories.find(c => c.enName === categoryEnName) || null, loading: false })
  },

  loadArticle: async (id: number) => {
    const json = await window.api.getArticle(id)
    if (json) {
      const article: ArticleItem = JSON.parse(json)
      set({ currentArticle: article })
    } else {
      set({ currentArticle: null })
    }
  },

  loadTypingProgress: async (articleId: number, mode: string) => {
    const json = await window.api.getTypingProgress(articleId, mode)
    if (json) {
      const progress: TypingProgress = JSON.parse(json)
      set({ typingProgress: progress })
    } else {
      set({ typingProgress: null })
    }
  },

  loadTypingRecords: async (articleId: number) => {
    const json = await window.api.getTypingRecords(articleId)
    const records: TypingRecord[] = JSON.parse(json)
    set({ typingRecords: records })
  },

  saveTypingProgress: async (p) => {
    await window.api.saveTypingProgress(JSON.stringify(p))
  },

  saveTypingRecord: async (r) => {
    await window.api.saveTypingRecord(JSON.stringify(r))
  },
}))
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/stores/articleStore.ts && git commit -m "feat: add article store (Zustand)"
```

---

### Task 4: Frontend ArticleList page

**Files:**
- Create: `frontend/src/pages/ArticleList.tsx`

- [ ] **Step 1: Create ArticleList.tsx**

Create `frontend/src/pages/ArticleList.tsx`:

```tsx
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useArticleStore } from '@/stores/articleStore'
import { Card, CardContent } from '@/components/ui/card'
import { BookOpen, Check } from 'lucide-react'

export default function ArticleListPage() {
  const navigate = useNavigate()
  const { categories, articles, currentCategory, loading, loadCategories, loadArticles } = useArticleStore()

  useEffect(() => { loadCategories() }, [])

  const handleCategoryClick = (enName: string) => {
    loadArticles(enName)
  }

  const handleArticleClick = (id: number) => {
    navigate(`/articles/${id}`)
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 pt-4">
      <div className="flex items-center gap-2 mb-4">
        <BookOpen className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">文章打字</h2>
      </div>

      <div className="flex gap-2 flex-wrap">
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => handleCategoryClick(cat.enName)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              currentCategory?.enName === cat.enName
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted hover:bg-muted/70 text-foreground'
            }`}
          >
            {cat.name}
            <span className="ml-1.5 text-xs opacity-60">{cat.length}篇</span>
          </button>
        ))}
      </div>

      {currentCategory && (
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground mb-3">{currentCategory.description}</p>
        </div>
      )}

      {loading ? (
        <div className="text-center text-muted-foreground py-12">加载中...</div>
      ) : articles.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">
          {currentCategory ? '该分类暂无文章' : '选择一个分类开始练习'}
        </div>
      ) : (
        <div className="space-y-2">
          {articles.map((a, i) => (
            <Card
              key={a.id}
              className="cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => handleArticleClick(a.id)}
            >
              <CardContent className="p-4 flex items-center gap-4">
                <span className="text-sm text-muted-foreground w-8 shrink-0">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium truncate">{a.title}</h3>
                  {a.titleTranslate && (
                    <p className="text-sm text-muted-foreground truncate">{a.titleTranslate}</p>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/ArticleList.tsx && git commit -m "feat: add article list page"
```

---

### Task 5: Frontend ArticleTyping page (the big one)

**Files:**
- Create: `frontend/src/pages/ArticleTyping.tsx`

- [ ] **Step 1: Create ArticleTyping.tsx**

Create `frontend/src/pages/ArticleTyping.tsx`:

```tsx
import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useArticleStore } from '@/stores/articleStore'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Speaker, ArrowLeft, Pencil, Eye, Check } from 'lucide-react'

const CDN_BASE = 'https://files.typewords.cc'

type Mode = 'follow' | 'dictation'

interface CharState {
  char: string
  status: 'pending' | 'current' | 'correct' | 'wrong'
}

export default function ArticleTypingPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const {
    currentArticle, typingProgress,
    loadArticle, loadTypingProgress, saveTypingProgress, saveTypingRecord,
  } = useArticleStore()

  const [mode, setMode] = useState<Mode>('follow')
  const [typed, setTyped] = useState('')
  const [started, setStarted] = useState(false)
  const [startTime, setStartTime] = useState(0)
  const [finished, setFinished] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [showHint, setShowHint] = useState(false)
  const [hintWord, setHintWord] = useState('')
  const [showResult, setShowResult] = useState(false)
  const [dictationResults, setDictationResults] = useState<{ word: string; typed: string; correct: boolean }[]>([])
  const audioRef = useRef<HTMLAudioElement>(null)
  const hideHintTimer = useRef<ReturnType<typeof setTimeout>>()

  const articleId = Number(id)

  useEffect(() => {
    loadArticle(articleId)
  }, [articleId])

  useEffect(() => {
    if (currentArticle) {
      loadTypingProgress(articleId, mode)
    }
  }, [currentArticle, mode, articleId])

  useEffect(() => {
    if (typingProgress && typingProgress.position > 0 && !started) {
      setTyped(currentArticle?.text.slice(0, typingProgress.position) || '')
    }
  }, [typingProgress, currentArticle])

  useEffect(() => {
    if (!started) return
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [started, startTime])

  const text = currentArticle?.text || ''
  const totalChars = text.length
  const typedChars = typed.length

  const charStates: CharState[] = useMemo(() => {
    return text.split('').map((char, i) => {
      if (i < typed.length) {
        const isCorrect = typed[i] === char
        return { char, status: isCorrect ? 'correct' : 'wrong' }
      }
      if (i === typed.length) return { char, status: 'current' }
      return { char, status: 'pending' }
    })
  }, [text, typed])

  const correctCount = useMemo(() => {
    let count = 0
    for (let i = 0; i < typed.length; i++) {
      if (typed[i] === text[i]) count++
    }
    return count
  }, [typed, text])

  const accuracy = typed.length > 0 ? correctCount / typed.length : 1
  const wpm = elapsed > 0 ? Math.round((typedChars / 5) / (elapsed / 60)) : 0

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (finished || showResult) return

    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
      if (!started) {
        setStarted(true)
        setStartTime(Date.now())
      }
      if (typed.length < text.length) {
        setTyped(prev => prev + e.key)
        if (typed.length + 1 >= text.length) {
          setFinished(true)
          setShowResult(true)
        }
      }
      return
    }

    if (e.key === 'Backspace') {
      e.preventDefault()
      setTyped(prev => prev.slice(0, -1))
      return
    }

    if (e.key === 'Tab' && mode === 'dictation') {
      e.preventDefault()
      const remaining = text.slice(typed.length)
      const nextWord = remaining.match(/^\S+/)?.[0] || ''
      setHintWord(nextWord)
      setShowHint(true)
      clearTimeout(hideHintTimer.current)
      hideHintTimer.current = setTimeout(() => setShowHint(false), 3000)
      return
    }
  }, [finished, showResult, started, text, typed, mode])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  useEffect(() => {
    return () => clearTimeout(hideHintTimer.current)
  }, [])

  const progress = totalChars > 0 ? (typedChars / totalChars) * 100 : 0

  const getAudioURL = () => {
    if (!currentArticle?.audioSrc) return ''
    return CDN_BASE + currentArticle.audioSrc
  }

  const handleRestart = () => {
    setTyped('')
    setStarted(false)
    setFinished(false)
    setElapsed(0)
    setShowResult(false)
    setDictationResults([])
  }

  const handleComplete = async () => {
    const mistakeWords: { word: string; typed: string; position: number }[] = []
    const words = text.split(/\s+/)
    let pos = 0
    for (const word of words) {
      const endPos = pos + word.length
      const typedSegment = typed.slice(pos, endPos)
      if (typedSegment.toLowerCase() !== word.toLowerCase() && typedSegment.length > 0) {
        mistakeWords.push({ word, typed: typedSegment, position: pos })
      }
      pos = endPos + 1
    }

    const record = {
      articleId,
      mode,
      accuracy,
      wpm,
      duration: elapsed,
      mistakes: JSON.stringify(mistakeWords),
    }
    await saveTypingRecord(record)

    const currentBestAccuracy = typingProgress?.bestAccuracy || 0
    const currentBestWpm = typingProgress?.bestWpm || 0
    await saveTypingProgress({
      articleId,
      mode,
      position: typedChars,
      completed: true,
      bestAccuracy: Math.max(accuracy, currentBestAccuracy),
      bestWpm: Math.max(wpm, currentBestWpm),
    })
  }

  // Auto-save on finish
  useEffect(() => {
    if (finished) {
      handleComplete()
    }
  }, [finished])

  // Render character display for follow mode
  const renderFollowText = () => (
    <div className="font-mono text-xl leading-relaxed whitespace-pre-wrap break-words select-none"
      style={{ letterSpacing: '0.05em' }}>
      {charStates.map((cs, i) => (
        <span
          key={i}
          className={
            cs.status === 'correct' ? 'text-green-600 dark:text-green-400' :
            cs.status === 'wrong' ? 'bg-red-200 dark:bg-red-800 text-red-800 dark:text-red-200 rounded' :
            cs.status === 'current' ? 'border-b-2 border-blue-500 text-muted-foreground' :
            'text-muted-foreground'
          }
        >
          {cs.char === '\n' ? '↵\n' : cs.char === ' ' && cs.status === 'current' ? '␣' : cs.char}
        </span>
      ))}
    </div>
  )

  // Render dictation mode: typed words with reveal
  const renderDictationText = () => {
    const originalWords = text.split(/(\s+)/)
    let typedPos = 0
    const typedWords = typed.split(/(\s+)/)

    return (
      <div className="font-mono text-xl leading-relaxed whitespace-pre-wrap break-words select-none">
        {/* Show already typed words */}
        {typedWords.map((tw, i) => {
          typedPos += tw.length
          const ow = originalWords[i]
          const isSpace = /^\s+$/.test(tw)
          if (isSpace) return <span key={i}>{tw}</span>
          if (!ow) return <span key={i} className="text-muted-foreground">{tw}</span>
          const matched = ow.toLowerCase() === tw.toLowerCase()
          return (
            <span key={i} className={matched ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}>
              {matched ? tw : <span className="line-through mr-1">{tw}</span>}
              {!matched && <span className="text-green-600 text-xs align-super">{ow}</span>}
            </span>
          )
        })}
        {/* Show cursor for remaining */}
        {typed.length < text.length && (
          <span className="border-b-2 border-blue-500 animate-pulse">&nbsp;</span>
        )}
        {/* Show remaining as hidden */}
        {mode === 'dictation' && (
          <span className="text-muted-foreground/20">
            {'█'.repeat(Math.min(50, text.length - typed.length))}
          </span>
        )}
      </div>
    )
  }

  const mistakesFromErrors = (() => {
    const words = text.split(/\s+/)
    const typedWords = typed.split(/\s+/)
    const result: { word: string; typed: string }[] = []
    for (let i = 0; i < Math.min(words.length, typedWords.length); i++) {
      if (words[i].toLowerCase() !== typedWords[i].toLowerCase()) {
        result.push({ word: words[i], typed: typedWords[i] })
      }
    }
    return result
  })()

  const handleAddMistakesToWords = async () => {
    const uniqueWords = [...new Set(mistakesFromErrors.map(m => m.word))]
    const wordsToAdd = uniqueWords.map(word => ({
      word,
      definition: '',
      phonetic: '',
    }))
    const count = await window.api.addWordsBatch(JSON.stringify(wordsToAdd))
    alert(`已添加 ${count} 个生词`)
  }

  if (!currentArticle) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        加载中...
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 pt-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/articles')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h2 className="font-semibold">{currentArticle.title}</h2>
          <p className="text-sm text-muted-foreground">{currentArticle.titleTranslate}</p>
        </div>
        <div className="flex gap-1 bg-muted rounded-lg p-0.5">
          <button
            onClick={() => { setMode('follow'); handleRestart() }}
            className={`px-3 py-1 text-xs rounded-md transition-colors ${
              mode === 'follow' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'
            }`}
          >
            跟打
          </button>
          <button
            onClick={() => { setMode('dictation'); handleRestart() }}
            className={`px-3 py-1 text-xs rounded-md transition-colors ${
              mode === 'dictation' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'
            }`}
          >
            默写
          </button>
        </div>
        {currentArticle.audioSrc && (
          <Button variant="ghost" size="icon" onClick={() => audioRef.current?.play()}>
            <Speaker className="h-4 w-4" />
          </Button>
        )}
      </div>

      {currentArticle.audioSrc && (
        <audio ref={audioRef} src={getAudioURL()} preload="none" className="hidden" />
      )}

      {/* Progress bar */}
      <div className="space-y-1">
        <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-150 rounded-full"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{typedChars} / {totalChars} 字符</span>
          <span>{Math.round(progress)}%</span>
        </div>
      </div>

      {/* Tip for dictation mode */}
      {mode === 'dictation' && showHint && (
        <div className="text-center text-sm text-primary font-medium animate-pulse">
          提示: {hintWord}
        </div>
      )}

      {/* Text display */}
      <Card className="p-6">
        {mode === 'follow' ? renderFollowText() : renderDictationText()}
      </Card>

      {/* Stats */}
      <div className="flex gap-6 justify-center text-sm text-muted-foreground">
        <div>正确率 <span className="text-foreground font-medium">{Math.round(accuracy * 100)}%</span></div>
        <div>速度 <span className="text-foreground font-medium">{wpm}</span> WPM</div>
        <div>耗时 <span className="text-foreground font-medium">{elapsed}s</span></div>
      </div>

      {/* Mode hint */}
      <p className="text-xs text-muted-foreground text-center">
        {mode === 'follow' ? '逐字输入，大小写和标点需完全匹配 · Backspace 回退' : '凭记忆输入每个词，空格确认 · Tab 查看提示'}
      </p>

      {/* Result modal */}
      {showResult && (
        <Card className="p-6 space-y-4">
          <h3 className="text-lg font-semibold text-center">练习完成</h3>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold text-primary">{Math.round(accuracy * 100)}%</div>
              <div className="text-xs text-muted-foreground">正确率</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-primary">{wpm}</div>
              <div className="text-xs text-muted-foreground">WPM</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-primary">{elapsed}s</div>
              <div className="text-xs text-muted-foreground">耗时</div>
            </div>
          </div>

          {mistakesFromErrors.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium">错词 ({mistakesFromErrors.length}个)</h4>
              <div className="max-h-32 overflow-y-auto space-y-1 text-sm">
                {mistakesFromErrors.map((m, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="text-red-500 line-through">{m.typed}</span>
                    <span className="text-muted-foreground">→</span>
                    <span className="text-green-600">{m.word}</span>
                  </div>
                ))}
              </div>
              <Button size="sm" variant="outline" onClick={handleAddMistakesToWords}>
                将错词加入生词库
              </Button>
            </div>
          )}

          <div className="flex gap-3 justify-center">
            <Button onClick={handleRestart}>再来一次</Button>
            <Button variant="outline" onClick={() => navigate('/articles')}>返回列表</Button>
          </div>
        </Card>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit --project frontend/tsconfig.json 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/ArticleTyping.tsx && git commit -m "feat: add article typing page with follow/dictation modes"
```

---

### Task 6: Wiring — routing + navigation

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/Layout.tsx`

- [ ] **Step 1: Add lazy imports and routes in App.tsx**

In `frontend/src/App.tsx`, after the existing lazy imports, add:

```typescript
const ArticleList = lazy(() => import('@/pages/ArticleList'))
const ArticleTyping = lazy(() => import('@/pages/ArticleTyping'))
```

Then in the `<Routes>` block, add (after `<Route path="/card" ... />`):

```tsx
<Route path="/articles" element={<ArticleList />} />
<Route path="/articles/:id" element={<ArticleTyping />} />
```

- [ ] **Step 2: Add nav item in Layout.tsx**

In `frontend/src/components/Layout.tsx`, add `Type` icon to the lucide-react import:

```typescript
import { Home, Play, BookOpen, FlipVertical, Settings, Pause, Loader2, X, Library, PanelLeftClose, PanelLeft, Type } from 'lucide-react'
```

Then in the `navItems` array, add after the `/card` entry:

```typescript
  { path: '/articles', label: '文章打字', icon: Type },
```

- [ ] **Step 3: Build frontend to verify**

```bash
npx tsc --noEmit --project frontend/tsconfig.json 2>&1 | head -30
```

Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/Layout.tsx && git commit -m "feat: wire article pages into routing and navigation"
```

---

## Verification

After all tasks complete:

1. `go build -o /dev/null .` — Go compiles
2. `npx tsc --noEmit --project frontend/tsconfig.json` — TypeScript compiles
3. `wails dev` — app launches, navigate to `/articles`, see 4 NCE categories, click one, click an article, type through it
