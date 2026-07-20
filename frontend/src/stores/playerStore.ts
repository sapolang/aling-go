import { create } from 'zustand'

interface SubtitleItem {
  id: number
  startTime: number
  endTime: number
  text: string
}

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
  seekTo: number | null         // Layout 消费后置 null

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

  setFilePath: (filePath) => set({
    filePath, playing: false, played: 0, duration: 0, playbackRate: 1,
    subtitles: [], subtitlePath: null, currentSubtitleIndex: -1,
    loopStart: null, loopEnd: null, seekTo: null
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
  closeFile: () => set({
    filePath: null, playing: false, played: 0, duration: 0, playbackRate: 1,
    subtitles: [], subtitlePath: null, currentSubtitleIndex: -1,
    loopStart: null, loopEnd: null, transcribing: false, transcriptionProgress: 0, seekTo: null
  })
}))
