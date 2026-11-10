import { create } from 'zustand'

export interface Feed {
  id: number
  url: string
  title: string
  description: string
  image: string
  siteUrl: string
  lastFetchedAt: string
  lastError: string
  episodeCount: number
}

export interface FeedEpisode {
  id: number
  feedId: number
  title: string
  description: string
  audioUrl: string
  duration: number
  publishedAt: string
  localPath: string
}

interface FeedStore {
  feeds: Feed[]
  episodes: FeedEpisode[]
  selectedFeedId: number | null
  loadingFeeds: boolean
  loadingEpisodes: boolean
  refreshing: boolean
  /** episodeId -> 下载进度百分比 */
  downloadProgress: Record<number, number>

  loadFeeds: () => Promise<void>
  addFeed: (url: string) => Promise<{ ok: boolean; message: string }>
  removeFeed: (id: number) => Promise<void>
  refreshFeed: (id: number) => Promise<{ ok: boolean; message: string }>
  selectFeed: (id: number) => Promise<void>
  loadEpisodes: (id: number) => Promise<void>
  downloadEpisode: (id: number) => Promise<{ ok: boolean; message: string }>
  setDownloadProgress: (episodeId: number, pct: number) => void
  resetDownloadProgress: (episodeId: number) => void
}

export const useFeedStore = create<FeedStore>((set, get) => ({
  feeds: [],
  episodes: [],
  selectedFeedId: null,
  loadingFeeds: false,
  loadingEpisodes: false,
  refreshing: false,
  downloadProgress: {},

  loadFeeds: async () => {
    set({ loadingFeeds: true })
    try {
      const res = await window.api.feedList()
      const feeds: Feed[] = res?.feeds || []
      set({ feeds, loadingFeeds: false })
      // 首次进入自动选中第一个订阅源
      if (!get().selectedFeedId && feeds.length > 0) {
        await get().selectFeed(feeds[0].id)
      }
    } catch (err) {
      console.error('[feed] loadFeeds failed', err)
      set({ loadingFeeds: false })
    }
  },

  addFeed: async (url) => {
    const res = await window.api.feedAdd(url)
    if (res?.ok) {
      await get().loadFeeds()
    }
    return { ok: !!res?.ok, message: res?.error || res?.message || '' }
  },

  removeFeed: async (id) => {
    await window.api.feedRemove(id)
    const { selectedFeedId } = get()
    if (selectedFeedId === id) {
      set({ selectedFeedId: null, episodes: [] })
    }
    await get().loadFeeds()
  },

  refreshFeed: async (id) => {
    set({ refreshing: true })
    try {
      const res = await window.api.feedRefresh(id)
      await get().loadFeeds()
      if (get().selectedFeedId) {
        await get().loadEpisodes(get().selectedFeedId as number)
      }
      return { ok: !!res?.ok, message: res?.error || res?.message || '' }
    } finally {
      set({ refreshing: false })
    }
  },

  selectFeed: async (id) => {
    set({ selectedFeedId: id, episodes: [] })
    await get().loadEpisodes(id)
  },

  loadEpisodes: async (id) => {
    set({ loadingEpisodes: true })
    try {
      const res = await window.api.feedEpisodes(id, 100)
      // 请求返回时用户可能已经切到别的订阅源，丢弃过期结果
      if (get().selectedFeedId === id) {
        set({ episodes: res?.episodes || [], loadingEpisodes: false })
      }
    } catch (err) {
      console.error('[feed] loadEpisodes failed', err)
      set({ loadingEpisodes: false })
    }
  },

  downloadEpisode: async (id) => {
    set((s) => ({ downloadProgress: { ...s.downloadProgress, [id]: 0 } }))
    try {
      const res = await window.api.episodeDownload(id)
      if (res?.ok) {
        set((s) => {
          const next = { ...s.downloadProgress }
          delete next[id]
          return {
            downloadProgress: next,
            episodes: s.episodes.map((e) => (e.id === id ? { ...e, localPath: res.path } : e)),
          }
        })
        return { ok: true, message: '' }
      }
      get().resetDownloadProgress(id)
      return { ok: false, message: res?.error || '下载失败' }
    } catch (err: any) {
      get().resetDownloadProgress(id)
      return { ok: false, message: err?.message || String(err) }
    }
  },

  setDownloadProgress: (episodeId, pct) =>
    set((s) => ({ downloadProgress: { ...s.downloadProgress, [episodeId]: pct } })),

  resetDownloadProgress: (episodeId) =>
    set((s) => {
      const next = { ...s.downloadProgress }
      delete next[episodeId]
      return { downloadProgress: next }
    }),
}))
