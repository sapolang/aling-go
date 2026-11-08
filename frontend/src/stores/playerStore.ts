import { create } from 'zustand'

const PODCAST_MODE_KEY = 'aling.podcastMode'
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

const saveSubtitleOffset = (filePath: string | null, offset: number) => {
  if (!filePath) return
  try {
    localStorage.setItem(SUBTITLE_OFFSET_PREFIX + filePath, String(offset))
  } catch {
    // 忽略持久化失败（如隐私模式）
  }
}

interface SubtitleItem {
  id: number
  startTime: number
  endTime: number
  text: string
}

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
  podcastMode: boolean
  autoNextEpisode: boolean
  autoPause: boolean
  hoverPause: boolean
  subtitleDisplayMode: SubtitleDisplayMode
  volume: number
  muted: boolean
  subtitleFontScale: number

  setFilePath: (path: string | null) => void
  setPlaying: (playing: boolean) => void
  setPlayed: (played: number) => void
  setDuration: (duration: number) => void
  setPlaybackRate: (rate: number) => void
  setSubtitles: (subs: SubtitleItem[]) => void
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
  setPodcastMode: (v: boolean) => void
  setAutoNextEpisode: (v: boolean) => void
  setAutoPause: (v: boolean) => void
  setHoverPause: (v: boolean) => void
  setSubtitleDisplayMode: (mode: SubtitleDisplayMode) => void
  adjustVolume: (delta: number) => void
  toggleMuted: () => void
  adjustSubtitleFontScale: (delta: number) => void
}

export const usePlayerStore = create<PlayerStore>((set) => ({
  filePath: null,
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
  podcastMode:
    typeof localStorage !== 'undefined' && localStorage.getItem(PODCAST_MODE_KEY) === '1',
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

  setFilePath: (filePath) =>
    set({
      filePath,
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
    }),
  setPlaying: (playing) => set({ playing }),
  setPlayed: (played) => set({ played }),
  setDuration: (duration) => set({ duration }),
  setPlaybackRate: (playbackRate) => set({ playbackRate }),
  setSubtitles: (subtitles) => set({ subtitles, currentSubtitleIndex: -1 }),
  setSubtitlePath: (subtitlePath) => set({ subtitlePath }),
  setCurrentSubtitleIndex: (currentSubtitleIndex) => set({ currentSubtitleIndex }),
  setLoop: (loopStart, loopEnd) => set({ loopStart, loopEnd }),
  setTranscribing: (transcribing) => set({ transcribing }),
  setTranscriptionProgress: (transcriptionProgress) => set({ transcriptionProgress }),
  requestSeek: (time) => set({ seekTo: time }),
  closeFile: () =>
    set({
      filePath: null,
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
  setPodcastMode: (podcastMode) => {
    try {
      localStorage.setItem(PODCAST_MODE_KEY, podcastMode ? '1' : '0')
    } catch {
      // 忽略持久化失败（如隐私模式）
    }
    set({ podcastMode })
  },
  setAutoNextEpisode: (autoNextEpisode) => {
    try {
      localStorage.setItem(AUTO_NEXT_KEY, autoNextEpisode ? '1' : '0')
    } catch {
      // 忽略持久化失败（如隐私模式）
    }
    set({ autoNextEpisode })
  },
  setAutoPause: (autoPause) => {
    try {
      localStorage.setItem(AUTO_PAUSE_KEY, autoPause ? '1' : '0')
    } catch {
      // 忽略持久化失败（如隐私模式）
    }
    set({ autoPause })
  },
  setHoverPause: (hoverPause) => {
    try {
      localStorage.setItem(HOVER_PAUSE_KEY, hoverPause ? '1' : '0')
    } catch {
      // 忽略持久化失败（如隐私模式）
    }
    set({ hoverPause })
  },
  setSubtitleDisplayMode: (subtitleDisplayMode) => {
    try {
      localStorage.setItem(SUBTITLE_MODE_KEY, subtitleDisplayMode)
    } catch {
      // 忽略持久化失败（如隐私模式）
    }
    set({ subtitleDisplayMode })
  },
  adjustVolume: (delta) =>
    set((s) => {
      const volume = Math.round(Math.min(1, Math.max(0, s.volume + delta)) * 10) / 10
      const muted = delta > 0 ? false : s.muted
      try {
        localStorage.setItem(VOLUME_KEY, String(volume))
        localStorage.setItem(MUTED_KEY, muted ? '1' : '0')
      } catch {
        // 忽略持久化失败（如隐私模式）
      }
      return { volume, muted }
    }),
  toggleMuted: () =>
    set((s) => {
      const muted = !s.muted
      try {
        localStorage.setItem(MUTED_KEY, muted ? '1' : '0')
      } catch {
        // 忽略持久化失败（如隐私模式）
      }
      return { muted }
    }),
  adjustSubtitleFontScale: (delta) =>
    set((s) => {
      const subtitleFontScale =
        Math.round(Math.min(1.6, Math.max(0.8, s.subtitleFontScale + delta)) * 10) / 10
      try {
        localStorage.setItem(FONT_SCALE_KEY, String(subtitleFontScale))
      } catch {
        // 忽略持久化失败（如隐私模式）
      }
      return { subtitleFontScale }
    }),
}))
