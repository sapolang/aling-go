import { create } from 'zustand'

export interface Word {
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

interface Tag {
  id: number
  name: string
  color: string
}

export const DEFAULT_NEW_LIMIT = 20
export const DEFAULT_REVIEW_LIMIT = 100
const NEW_LIMIT_KEY = 'aling-review-new-limit'
const REVIEW_LIMIT_KEY = 'aling-review-limit'

function loadLimit(key: string, fallback: number): number {
  if (typeof localStorage === 'undefined') return fallback
  const n = parseInt(localStorage.getItem(key) || '', 10)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

function saveLimit(key: string, value: number) {
  if (typeof localStorage !== 'undefined') localStorage.setItem(key, String(value))
}

interface WordStore {
  words: Word[]
  tags: Tag[]
  reviewWords: Word[]
  reviewTotal: number
  reviewCompleted: number
  newLimit: number
  reviewLimit: number
  truncatedNew: number
  truncatedReview: number
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
  decrementCompleted: () => void
  restoreReviewWord: (word: Word, index: number) => void
  setNewLimit: (n: number) => void
  setReviewLimit: (n: number) => void
}

export const useWordStore = create<WordStore>((set, get) => ({
  words: [],
  tags: [],
  reviewWords: [],
  reviewTotal: 0,
  reviewCompleted: 0,
  newLimit: loadLimit(NEW_LIMIT_KEY, DEFAULT_NEW_LIMIT),
  reviewLimit: loadLimit(REVIEW_LIMIT_KEY, DEFAULT_REVIEW_LIMIT),
  truncatedNew: 0,
  truncatedReview: 0,
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
    const all = await window.api.dbWordsGetReview()
    const { newLimit, reviewLimit } = get()
    // 新词（从未复习过，repetitions 为 0）与复习词分别按每日上限截断，保持原有顺序
    let newSeen = 0
    let reviewSeen = 0
    const reviewWords: Word[] = []
    for (const w of all) {
      if (!w.repetitions || w.repetitions <= 0) {
        newSeen++
        if (newSeen <= newLimit) reviewWords.push(w)
      } else {
        reviewSeen++
        if (reviewSeen <= reviewLimit) reviewWords.push(w)
      }
    }
    set({
      reviewWords,
      reviewTotal: reviewWords.length,
      reviewCompleted: 0,
      truncatedNew: Math.max(0, newSeen - newLimit),
      truncatedReview: Math.max(0, reviewSeen - reviewLimit),
    })
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
  decrementCompleted: () => set((s) => ({ reviewCompleted: Math.max(0, s.reviewCompleted - 1) })),
  restoreReviewWord: (word, index) =>
    set((s) => {
      const list = s.reviewWords.filter((w) => w.id !== word.id)
      const i = Math.max(0, Math.min(index, list.length))
      list.splice(i, 0, word)
      return { reviewWords: list }
    }),
  setNewLimit: (n) => {
    const v = Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_NEW_LIMIT
    saveLimit(NEW_LIMIT_KEY, v)
    set({ newLimit: v })
  },
  setReviewLimit: (n) => {
    const v = Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_REVIEW_LIMIT
    saveLimit(REVIEW_LIMIT_KEY, v)
    set({ reviewLimit: v })
  },
}))
