import { create } from 'zustand'
import { createVideoPlayer } from 'expo-video'
import type { VideoPlayer, PlayingChangeEventPayload } from 'expo-video'
import { SubtitleItem } from '../types'

type Unsubscribe = () => void

interface PlayerState {
  fileUri: string | null
  fileName: string | null
  player: VideoPlayer | null
  playing: boolean
  subtitles: SubtitleItem[]
  currentSubtitleIndex: number
  isTranscribing: boolean
  whisperProgress: number
  chunkIndex: number
  chunkTotal: number
  setFile: (uri: string, name: string) => void
  setSubtitles: (subs: SubtitleItem[]) => void
  appendSubtitles: (subs: SubtitleItem[]) => void
  setCurrentSubtitleIndex: (index: number) => void
  setTranscribing: (v: boolean) => void
  setWhisperProgress: (p: number) => void
  setChunkProgress: (idx: number, total: number) => void
  reset: () => void
}

let currentPlayer: VideoPlayer | null = null
let unlistenPlaying: Unsubscribe | null = null

function releasePlayer() {
  if (unlistenPlaying) {
    try { unlistenPlaying() } catch {}
    unlistenPlaying = null
  }
  if (currentPlayer) {
    try { currentPlayer.release() } catch {}
    currentPlayer = null
  }
}

export const usePlayerStore = create<PlayerState>((set) => ({
  fileUri: null,
  fileName: null,
  player: null,
  playing: false,
  subtitles: [],
  currentSubtitleIndex: -1,
  isTranscribing: false,
  whisperProgress: 0,
  chunkIndex: 0,
  chunkTotal: 0,
  setFile: (uri, name) => {
    releasePlayer()
    const p = createVideoPlayer(uri)
    p.timeUpdateEventInterval = 0.25
    currentPlayer = p
    const sub = p.addListener('playingChange', (e: PlayingChangeEventPayload) => {
      set({ playing: e.isPlaying })
    })
    unlistenPlaying = () => { try { sub.remove() } catch {} }
    set({
      fileUri: uri,
      fileName: name,
      player: p,
      playing: false,
      subtitles: [],
      currentSubtitleIndex: -1,
    })
  },
  setSubtitles: (subs) => set({ subtitles: subs, currentSubtitleIndex: -1 }),
  appendSubtitles: (subs) => set({ subtitles: subs }),
  setCurrentSubtitleIndex: (index) => set({ currentSubtitleIndex: index }),
  setTranscribing: (v) => set({ isTranscribing: v, whisperProgress: v ? 0 : 0, chunkIndex: 0, chunkTotal: 0 }),
  setWhisperProgress: (p) => set({ whisperProgress: p }),
  setChunkProgress: (idx, total) => set({ chunkIndex: idx, chunkTotal: total }),
  reset: () => {
    releasePlayer()
    set({
      fileUri: null,
      fileName: null,
      player: null,
      playing: false,
      subtitles: [],
      currentSubtitleIndex: -1,
      isTranscribing: false,
      whisperProgress: 0,
      chunkIndex: 0,
      chunkTotal: 0,
    })
  },
}))
