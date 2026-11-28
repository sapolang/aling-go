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
  /** 订阅源给出的视频直链，在线播放但不下载 */
  mediaUrl: string
  link: string
  duration: number
  publishedAt: string
  localPath: string
  image: string
}

interface FeedStore {
  feeds: Feed[]
  episodes: FeedEpisode[]
  selectedFeedId: number | null
  loadingFeeds: boolean
  loadingEpisodes: boolean
  /** 节目列表是否还有下一页 */
  hasMoreEpisodes: boolean
  /** 正在追加加载下一页，防止重复点击 */
  loadingMoreEpisodes: boolean
  /** null 未刷新，0 全部刷新，大于 0 为正在刷新的订阅源 ID */
  refreshing: number | null
  /** episodeId -> 下载进度百分比 */
  downloadProgress: Record<number, number>

  loadFeeds: () => Promise<void>
  addFeed: (url: string) => Promise<{ ok: boolean; message: string }>
  removeFeed: (id: number, deleteDownloads: boolean) => Promise<void>
  refreshFeed: (id: number) => Promise<{ ok: boolean; message: string }>
  selectFeed: (id: number) => Promise<void>
  loadEpisodes: (id: number) => Promise<void>
  loadMoreEpisodes: () => Promise<void>
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
  hasMoreEpisodes: false,
  loadingMoreEpisodes: false,
  refreshing: null,
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

  removeFeed: async (id, deleteDownloads) => {
    await window.api.feedRemove(id, deleteDownloads)
    const { selectedFeedId } = get()
    if (selectedFeedId === id) {
      set({ selectedFeedId: null, episodes: [], hasMoreEpisodes: false })
    }
    await get().loadFeeds()
  },

  refreshFeed: async (id) => {
    set({ refreshing: id })
    try {
      const res = await window.api.feedRefresh(id)
      await get().loadFeeds()
      if (get().selectedFeedId) {
        await get().loadEpisodes(get().selectedFeedId as number)
      }
      return { ok: !!res?.ok, message: res?.error || res?.message || '' }
    } finally {
      set({ refreshing: null })
    }
  },

  selectFeed: async (id) => {
    set({ selectedFeedId: id, episodes: [] })
    await get().loadEpisodes(id)
  },

  loadEpisodes: async (id) => {
    set({ loadingEpisodes: true, hasMoreEpisodes: false })
    try {
      const res = await window.api.feedEpisodes(id, 30, 0)
      // 请求返回时用户可能已经切到别的订阅源，丢弃过期结果
      if (get().selectedFeedId === id) {
        set({
          episodes: res?.episodes || [],
          hasMoreEpisodes: !!res?.hasMore,
          loadingEpisodes: false,
        })
      }
    } catch (err) {
      console.error('[feed] loadEpisodes failed', err)
      set({ loadingEpisodes: false })
    }
  },

  loadMoreEpisodes: async () => {
    const { selectedFeedId, episodes, hasMoreEpisodes, loadingMoreEpisodes } = get()
    if (selectedFeedId == null || !hasMoreEpisodes || loadingMoreEpisodes) return
    set({ loadingMoreEpisodes: true })
    try {
      const res = await window.api.feedEpisodes(selectedFeedId, 30, episodes.length)
      // 翻页期间切到别的订阅源时丢弃过期结果
      if (get().selectedFeedId === selectedFeedId) {
        set((s) => ({
          episodes: [...s.episodes, ...(res?.episodes || [])],
          hasMoreEpisodes: !!res?.hasMore,
          loadingMoreEpisodes: false,
        }))
      } else {
        set({ loadingMoreEpisodes: false })
      }
    } catch (err) {
      console.error('[feed] loadMoreEpisodes failed', err)
      set({ loadingMoreEpisodes: false })
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
