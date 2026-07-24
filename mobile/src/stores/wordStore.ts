import { create } from 'zustand'
import { Word } from '../types'

interface WordState {
  words: Word[]
  searchQuery: string
  selectedTag: string | null
  isLoading: boolean
  setWords: (words: Word[]) => void
  setSearchQuery: (q: string) => void
  setSelectedTag: (tag: string | null) => void
  setLoading: (v: boolean) => void
}

export const useWordStore = create<WordState>((set) => ({
  words: [],
  searchQuery: '',
  selectedTag: null,
  isLoading: false,
  setWords: (words) => set({ words }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setSelectedTag: (tag) => set({ selectedTag: tag }),
  setLoading: (v) => set({ isLoading: v }),
}))
