import { create } from 'zustand'
import { SubtitleItem } from '../types'

interface PlayerState {
  fileUri: string | null
  fileName: string | null
  subtitles: SubtitleItem[]
  currentSubtitleIndex: number
  isTranscribing: boolean
  whisperProgress: number
  // actions
  setFile: (uri: string, name: string) => void
  setSubtitles: (subs: SubtitleItem[]) => void
  setCurrentSubtitleIndex: (index: number) => void
  setTranscribing: (v: boolean) => void
  setWhisperProgress: (p: number) => void
  reset: () => void
}

export const usePlayerStore = create<PlayerState>((set) => ({
  fileUri: null,
  fileName: null,
  subtitles: [],
  currentSubtitleIndex: -1,
  isTranscribing: false,
  whisperProgress: 0,
  setFile: (uri, name) => set({ fileUri: uri, fileName: name, subtitles: [], currentSubtitleIndex: -1 }),
  setSubtitles: (subs) => set({ subtitles: subs, currentSubtitleIndex: -1 }),
  setCurrentSubtitleIndex: (index) => set({ currentSubtitleIndex: index }),
  setTranscribing: (v) => set({ isTranscribing: v, whisperProgress: v ? 0 : 0 }),
  setWhisperProgress: (p) => set({ whisperProgress: p }),
  reset: () =>
    set({
      fileUri: null,
      fileName: null,
      subtitles: [],
      currentSubtitleIndex: -1,
      isTranscribing: false,
      whisperProgress: 0,
    }),
}))
