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
    try {
      const words = await window.api.dbDictWords(tag)
      const savedIndex = await window.api.dbDictGetProgress(tag)
      const startIndex = (savedIndex > 0 && savedIndex < words.length) ? savedIndex : 0
      set({ words, currentIndex: startIndex })
    } catch (e) {
      console.error('openBook error:', e)
    }
    set({ loading: false })
  },

  markKnown: () => {
    const { words, currentIndex, knownWords, currentBook } = get()
    if (currentIndex < words.length) {
      const next = new Set(knownWords)
      next.add(words[currentIndex].word)
      const newIndex = currentIndex + 1
      set({ knownWords: next, currentIndex: newIndex })
      if (currentBook) {
        window.api.dbDictSaveProgress(currentBook, newIndex)
      }
    }
  },

  markUnknown: () => {
    const { words, currentIndex, unknownWords, currentBook } = get()
    if (currentIndex < words.length) {
      const next = new Set(unknownWords)
      next.add(words[currentIndex].word)
      const newIndex = currentIndex + 1
      set({ unknownWords: next, currentIndex: newIndex })
      if (currentBook) {
        window.api.dbDictSaveProgress(currentBook, newIndex)
      }
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