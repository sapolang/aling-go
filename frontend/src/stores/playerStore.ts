import { create } from 'zustand'
import { sortByStartTime } from '@/lib/subtitles'

const FOCUS_MODE_KEY = 'aling.focusMode'
const AUTO_NEXT_KEY = 'aling.autoNextEpisode'
const AUTO_PAUSE_KEY = 'aling.autoPause'
const HOVER_PAUSE_KEY = 'aling.hoverPause'
const SUBTITLE_OFFSET_PREFIX = 'aling.subtitleOffset:'
const VOLUME_KEY = 'aling.volume'
const MUTED_KEY = 'aling.muted'
const FONT_SCALE_KEY = 'aling.subtitleFontScale'

// 音量：0~1，默认满音量
const loadVolume = (): number => {
  if (typeof localStorage === 'undefined') return 1
  const value = parseFloat(localStorage.getItem(VOLUME_KEY) ?? '')
  if (!Number.isFinite(value)) return 1
  return Math.round(Math.min(1, Math.max(0, value)) * 10) / 10
}

// 字幕字号缩放：0.8~1.6，默认 1
const loadFontScale = (): number => {
  if (typeof localStorage === 'undefined') return 1
  const value = parseFloat(localStorage.getItem(FONT_SCALE_KEY) ?? '')
  if (!Number.isFinite(value)) return 1
  return Math.round(Math.min(1.6, Math.max(0.8, value)) * 10) / 10
}

// 字幕偏移按文件记住，换回同一个文件时无需重新对准
const loadSubtitleOffset = (filePath: string | null): number => {
  if (!filePath || typeof localStorage === 'undefined') return 0
  const raw = localStorage.getItem(SUBTITLE_OFFSET_PREFIX + filePath)
  const value = raw === null ? NaN : parseFloat(raw)
  if (!Number.isFinite(value)) return 0
  return Math.round(Math.min(5, Math.max(-5, value)) * 10) / 10
}

// 应用内偏好全部落在 localStorage：隐私模式等场景写入会抛错，统一忽略
const persist = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value)
  } catch {
    // 忽略持久化失败
  }
}

const saveSubtitleOffset = (filePath: string | null, offset: number) => {
  if (!filePath) return
  persist(SUBTITLE_OFFSET_PREFIX + filePath, String(offset))
}

interface SubtitleItem {
  id: number
  startTime: number
  endTime: number
  text: string
}

// 播放源类型：决定媒体 URL 如何解析、由哪个播放器渲染
export type SourceKind = 'html5' | 'bilibili' | 'youtube'

// 媒体形态：决定 UI 用音频 deck 还是视频舞台；null 表示按扩展名/URL 自动推断
export type MediaKind = 'audio' | 'video'

interface PlayClipRequest {
  filePath: string
  startTime: number
  endTime: number
}

// 字幕显示模式：all=全部（双语）、en=仅英文、zh=仅中文、off=隐藏悬浮字幕
export type SubtitleDisplayMode = 'all' | 'en' | 'zh' | 'off'

const SUBTITLE_MODE_KEY = 'aling.subtitleDisplayMode'

interface PlayerStore {
  filePath: string | null
  sourceKind: SourceKind
  mediaKind: MediaKind | null
  mediaTitle: string
  mediaEpisodeID: number
  // 播放历史的稳定标识：B站流地址每次会话都会变，用 bili:<bvid> 代替代理地址
  historyKey: string
  // 订阅源里的视频直链统一走本地代理，复用播客页配置的网络代理
  preferProxy: boolean
  historyCover: string
  historySourceUrl: string
  // 每次 setFilePath 自增，用于区分「重新播放同一个媒体」与页面内已有的播放会话
  playSession: number
  playing: boolean
  played: number
  duration: number
  playbackRate: number
  subtitles: SubtitleItem[]
  subtitlePath: string | null
  currentSubtitleIndex: number
  loopStart: number | null
  loopEnd: number | null
  transcribing: boolean
  transcriptionProgress: number
  seekTo: number | null
  waveformData: number[]
  waveformLoading: boolean
  subtitleOffset: number
  playClip: PlayClipRequest | null
  focusMode: boolean
  autoNextEpisode: boolean
  autoPause: boolean
  hoverPause: boolean
  subtitleDisplayMode: SubtitleDisplayMode
  volume: number
  muted: boolean
  subtitleFontScale: number

  setFilePath: (
    path: string | null,
    title?: string,
    episodeID?: number,
    opts?: {
      sourceKind?: SourceKind
      mediaKind?: MediaKind
      historyKey?: string
      cover?: string
      sourceUrl?: string
      preferProxy?: boolean
    },
  ) => void
  setPlaying: (playing: boolean) => void
  setPlayed: (played: number) => void
  setDuration: (duration: number) => void
  setPlaybackRate: (rate: number) => void
  setSubtitles: (subs: SubtitleItem[]) => void
  /** 增量追加字幕：只增不删，按 startTime+text 去重后排序 */
  appendSubtitles: (subs: SubtitleItem[]) => void
  setSubtitlePath: (path: string | null) => void
  setCurrentSubtitleIndex: (index: number) => void
  setLoop: (start: number | null, end: number | null) => void
  setTranscribing: (v: boolean) => void
  setTranscriptionProgress: (p: number) => void
  requestSeek: (time: number) => void
  closeFile: () => void
  setWaveformData: (data: number[]) => void
  setWaveformLoading: (loading: boolean) => void
  adjustSubtitleOffset: (delta: number) => void
  setPlayClip: (clip: PlayClipRequest | null) => void
  setFocusMode: (v: boolean) => void
  setAutoNextEpisode: (v: boolean) => void
  setAutoPause: (v: boolean) => void
  setHoverPause: (v: boolean) => void
  setSubtitleDisplayMode: (mode: SubtitleDisplayMode) => void
  adjustVolume: (delta: number) => void
  setVolume: (volume: number) => void
  toggleMuted: () => void
  adjustSubtitleFontScale: (delta: number) => void
}

export const usePlayerStore = create<PlayerStore>((set) => ({
  filePath: null,
  sourceKind: 'html5',
  mediaKind: null,
  mediaTitle: '',
  mediaEpisodeID: 0,
  historyKey: '',
  preferProxy: false,
  historyCover: '',
  historySourceUrl: '',
  playSession: 0,
  playing: false,
  played: 0,
  duration: 0,
  playbackRate: 1,
  subtitles: [],
  subtitlePath: null,
  currentSubtitleIndex: -1,
  loopStart: null,
  loopEnd: null,
  transcribing: false,
  transcriptionProgress: 0,
  seekTo: null,
  waveformData: [],
  waveformLoading: false,
  subtitleOffset: 0,
  playClip: null,
  focusMode: typeof localStorage !== 'undefined' && localStorage.getItem(FOCUS_MODE_KEY) === '1',
  // 默认开启；localStorage 存 '0' 表示关闭
  autoNextEpisode:
    typeof localStorage === 'undefined' || localStorage.getItem(AUTO_NEXT_KEY) !== '0',
  autoPause: typeof localStorage !== 'undefined' && localStorage.getItem(AUTO_PAUSE_KEY) === '1',
  // 默认开启；localStorage 存 '0' 表示关闭
  hoverPause: typeof localStorage === 'undefined' || localStorage.getItem(HOVER_PAUSE_KEY) !== '0',
  subtitleDisplayMode:
    (typeof localStorage !== 'undefined' &&
      (localStorage.getItem(SUBTITLE_MODE_KEY) as SubtitleDisplayMode)) ||
    'all',
  volume: loadVolume(),
  muted: typeof localStorage !== 'undefined' && localStorage.getItem(MUTED_KEY) === '1',
  subtitleFontScale: loadFontScale(),

  setFilePath: (filePath, title, episodeID, opts) =>
    set((s) => ({
      filePath,
      sourceKind: opts?.sourceKind ?? 'html5',
      mediaKind: opts?.mediaKind ?? null,
      mediaTitle: title || '',
      mediaEpisodeID: episodeID || 0,
      historyKey: opts?.historyKey ?? '',
      preferProxy: opts?.preferProxy ?? false,
      historyCover: opts?.cover ?? '',
      historySourceUrl: opts?.sourceUrl ?? '',
      playSession: s.playSession + 1,
      playing: false,
      played: 0,
      duration: 0,
      playbackRate: 1,
      subtitles: [],
      subtitlePath: null,
      currentSubtitleIndex: -1,
      loopStart: null,
      loopEnd: null,
      seekTo: null,
      waveformData: [],
      waveformLoading: false,
      subtitleOffset: loadSubtitleOffset(filePath),
    })),
  setPlaying: (playing) => set({ playing }),
  setPlayed: (played) => set({ played }),
  setDuration: (duration) => set({ duration }),
  setPlaybackRate: (playbackRate) => set({ playbackRate }),
  // 字幕入库统一按开始时间排序，供播放进度二分定位与跳句逻辑使用
  setSubtitles: (subtitles) =>
    set({ subtitles: sortByStartTime(subtitles), currentSubtitleIndex: -1 }),
  // 增量字幕：Whisper stdout 逐段吐出来时用；只增不删，避免切文件时残留。
  // 用毫秒整数做去重键：stdout 解析的秒数与最终 JSON 的 offsets/1000 浮点表示可能不同，
  // 直接比较原始浮点会让同一句在重新转录时无法去重。
  appendSubtitles: (incoming) =>
    set((s) => {
      if (incoming.length === 0) return {}
      const keyOf = (it: SubtitleItem) => `${Math.round(it.startTime * 1000)}|${it.text}`
      const seen = new Set(s.subtitles.map(keyOf))
      const fresh = incoming.filter((it) => {
        const key = keyOf(it)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      if (fresh.length === 0) return {}
      return {
        subtitles: sortByStartTime([...s.subtitles, ...fresh]),
      }
    }),
  setSubtitlePath: (subtitlePath) => set({ subtitlePath }),
  setCurrentSubtitleIndex: (currentSubtitleIndex) => set({ currentSubtitleIndex }),
  setLoop: (loopStart, loopEnd) => set({ loopStart, loopEnd }),
  setTranscribing: (transcribing) => set({ transcribing }),
  setTranscriptionProgress: (transcriptionProgress) => set({ transcriptionProgress }),
  requestSeek: (time) => set({ seekTo: time }),
  closeFile: () =>
    set({
      filePath: null,
      sourceKind: 'html5',
      mediaKind: null,
      mediaTitle: '',
      mediaEpisodeID: 0,
      historyKey: '',
      preferProxy: false,
      historyCover: '',
      historySourceUrl: '',
      playing: false,
      played: 0,
      duration: 0,
      playbackRate: 1,
      subtitles: [],
      subtitlePath: null,
      currentSubtitleIndex: -1,
      loopStart: null,
      loopEnd: null,
      transcribing: false,
      transcriptionProgress: 0,
      seekTo: null,
      waveformData: [],
      waveformLoading: false,
      subtitleOffset: 0,
    }),
  setWaveformData: (waveformData) => set({ waveformData, waveformLoading: false }),
  setWaveformLoading: (waveformLoading) => set({ waveformLoading }),
  adjustSubtitleOffset: (delta) =>
    set((s) => {
      const next = Math.round(Math.min(5, Math.max(-5, s.subtitleOffset + delta)) * 10) / 10
      saveSubtitleOffset(s.filePath, next)
      return { subtitleOffset: next }
    }),
  setPlayClip: (playClip) => set({ playClip }),
  setFocusMode: (focusMode) => {
    persist(FOCUS_MODE_KEY, focusMode ? '1' : '0')
    set({ focusMode })
  },
  setAutoNextEpisode: (autoNextEpisode) => {
    persist(AUTO_NEXT_KEY, autoNextEpisode ? '1' : '0')
    set({ autoNextEpisode })
  },
  setAutoPause: (autoPause) => {
    persist(AUTO_PAUSE_KEY, autoPause ? '1' : '0')
    set({ autoPause })
  },
  setHoverPause: (hoverPause) => {
    persist(HOVER_PAUSE_KEY, hoverPause ? '1' : '0')
    set({ hoverPause })
  },
  setSubtitleDisplayMode: (subtitleDisplayMode) => {
    persist(SUBTITLE_MODE_KEY, subtitleDisplayMode)
    set({ subtitleDisplayMode })
  },
  adjustVolume: (delta) =>
    set((s) => {
      const volume = Math.round(Math.min(1, Math.max(0, s.volume + delta)) * 10) / 10
      const muted = delta > 0 ? false : s.muted
      persist(VOLUME_KEY, String(volume))
      persist(MUTED_KEY, muted ? '1' : '0')
      return { volume, muted }
    }),
  setVolume: (value) =>
    set(() => {
      const volume = Math.round(Math.min(1, Math.max(0, value)) * 100) / 100
      // 拖动音量条即视为调整音量，归零时自动静音、非零时自动取消静音
      const muted = volume === 0
      persist(VOLUME_KEY, String(volume))
      persist(MUTED_KEY, muted ? '1' : '0')
      return { volume, muted }
    }),
  toggleMuted: () =>
    set((s) => {
      const muted = !s.muted
      persist(MUTED_KEY, muted ? '1' : '0')
      return { muted }
    }),
  adjustSubtitleFontScale: (delta) =>
    set((s) => {
      const subtitleFontScale =
        Math.round(Math.min(1.6, Math.max(0.8, s.subtitleFontScale + delta)) * 10) / 10
      persist(FONT_SCALE_KEY, String(subtitleFontScale))
      return { subtitleFontScale }
    }),
}))
