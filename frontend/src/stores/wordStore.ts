import { create } from 'zustand'

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

interface Tag {
  id: number
  name: string
  color: string
}

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
