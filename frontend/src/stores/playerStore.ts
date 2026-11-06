import { create } from 'zustand'

const PODCAST_MODE_KEY = 'aling.podcastMode'
const AUTO_NEXT_KEY = 'aling.autoNextEpisode'

interface SubtitleItem {
  id: number
  startTime: number
  endTime: number
  text: string
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
  podcastMode: boolean
  autoNextEpisode: boolean
  subtitleDisplayMode: SubtitleDisplayMode

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
  setPodcastMode: (v: boolean) => void
  setAutoNextEpisode: (v: boolean) => void
  setSubtitleDisplayMode: (mode: SubtitleDisplayMode) => void
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
  podcastMode:
    typeof localStorage !== 'undefined' && localStorage.getItem(PODCAST_MODE_KEY) === '1',
  // 默认开启；localStorage 存 '0' 表示关闭
  autoNextEpisode:
    typeof localStorage === 'undefined' || localStorage.getItem(AUTO_NEXT_KEY) !== '0',
  subtitleDisplayMode:
    (typeof localStorage !== 'undefined' &&
      (localStorage.getItem(SUBTITLE_MODE_KEY) as SubtitleDisplayMode)) ||
    'all',

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
      subtitleOffset: 0,
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
    set((s) => ({
      subtitleOffset: Math.round(Math.min(5, Math.max(-5, s.subtitleOffset + delta)) * 10) / 10,
    })),
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
  setSubtitleDisplayMode: (subtitleDisplayMode) => {
    try {
      localStorage.setItem(SUBTITLE_MODE_KEY, subtitleDisplayMode)
    } catch {
      // 忽略持久化失败（如隐私模式）
    }
    set({ subtitleDisplayMode })
  },
}))
