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
    const article = await window.api.getArticle(id)
    set({ currentArticle: article || null })
  },

  loadTypingProgress: async (articleId: number, mode: string) => {
    const progress = await window.api.getTypingProgress(articleId, mode)
    set({ typingProgress: progress || null })
  },

  loadTypingRecords: async (articleId: number) => {
    const records = await window.api.getTypingRecords(articleId)
    set({ typingRecords: records })
  },

  saveTypingProgress: async (p) => {
    await window.api.saveTypingProgress(JSON.stringify(p))
  },

  saveTypingRecord: async (r) => {
    await window.api.saveTypingRecord(JSON.stringify(r))
  },
}))
