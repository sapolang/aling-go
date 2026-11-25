import { useCallback, useEffect, useRef, useState } from 'react'

export type TtsEngine = 'edge' | 'local' | 'browser' | ''

interface SentenceLike {
  text: string
}

interface CacheEntry {
  url: string
  engine: TtsEngine
}

export interface UseTtsQueuePlayerOptions {
  sentences: SentenceLike[]
  voice: string
  /** 同一个页面切换到不同 PDF 时用它清空队列和内存缓存 */
  sourceKey: string
  /** 初始句下标（0 开始），通常来自上次阅读进度 */
  initialIndex?: number
  onIndexChange?: (index: number) => void
  onError?: (message: string) => void
}

export interface TtsQueuePlayerHandle {
  index: number
  playing: boolean
  loading: boolean
  engine: TtsEngine
  rate: number
  repeat: boolean
  gap: number
  play: (from?: number) => void
  playAt: (index: number) => void
  pause: () => void
  toggle: () => void
  next: () => void
  prev: () => void
  setRate: (rate: number) => void
  setRepeat: (repeat: boolean) => void
  setGap: (gap: number) => void
}

const MAX_CACHE_ENTRIES = 7

function clampIndex(index: number, length: number) {
  if (length <= 0) return 0
  return Math.min(Math.max(index, 0), length - 1)
}

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * 单句流式 TTS 队列：当前句播放时静默预取后两句，音频只存在于内存 Blob URL。
 * 在线/本地合成失败时自动降级到 window.speechSynthesis。
 */
export function useTtsQueuePlayer({
  sentences,
  voice,
  sourceKey,
  initialIndex = 0,
  onIndexChange,
  onError,
}: UseTtsQueuePlayerOptions): TtsQueuePlayerHandle {
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [engine, setEngine] = useState<TtsEngine>('')
  const [rate, setRateState] = useState(1)
  const [repeat, setRepeatState] = useState(false)
  const [gap, setGapState] = useState(0)

  const mountedRef = useRef(true)
  const sentencesRef = useRef<SentenceLike[]>(sentences)
  const voiceRef = useRef(voice)
  const indexRef = useRef(0)
  const playingRef = useRef(false)
  const rateRef = useRef(1)
  const repeatRef = useRef(false)
  const gapRef = useRef(0)
  const tokenRef = useRef(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const speechRef = useRef<SpeechSynthesisUtterance | null>(null)
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map())
  const inflightRef = useRef<Map<string, Promise<CacheEntry | null>>>(new Map())
  const currentKeyRef = useRef('')
  const onIndexChangeRef = useRef(onIndexChange)
  const onErrorRef = useRef(onError)

  sentencesRef.current = sentences
  voiceRef.current = voice
  onIndexChangeRef.current = onIndexChange
  onErrorRef.current = onError

  const cacheKey = useCallback((text: string) => `${voiceRef.current}\u0000${text}`, [])

  const revokeAll = useCallback(() => {
    for (const entry of cacheRef.current.values()) URL.revokeObjectURL(entry.url)
    cacheRef.current.clear()
    inflightRef.current.clear()
    currentKeyRef.current = ''
  }, [])

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const stopAudio = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.onended = null
    audio.onerror = null
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
  }, [])

  const cancelSpeech = useCallback(() => {
    speechRef.current = null
    window.speechSynthesis?.cancel()
  }, [])

  const stopEverything = useCallback(() => {
    clearTimer()
    stopAudio()
    cancelSpeech()
  }, [cancelSpeech, clearTimer, stopAudio])

  const remember = useCallback((key: string, entry: CacheEntry) => {
    cacheRef.current.set(key, entry)
    while (cacheRef.current.size > MAX_CACHE_ENTRIES) {
      let evicted = false
      for (const candidate of cacheRef.current.keys()) {
        if (candidate === currentKeyRef.current) continue
        const old = cacheRef.current.get(candidate)
        if (old) URL.revokeObjectURL(old.url)
        cacheRef.current.delete(candidate)
        evicted = true
        break
      }
      if (!evicted) break
    }
  }, [])

  const getCached = useCallback((key: string) => {
    const entry = cacheRef.current.get(key)
    if (!entry) return null
    // 刷新 LRU 顺序
    cacheRef.current.delete(key)
    cacheRef.current.set(key, entry)
    return entry
  }, [])

  const synthesize = useCallback(
    async (text: string): Promise<CacheEntry | null> => {
      const key = cacheKey(text)
      const cached = getCached(key)
      if (cached) return cached
      const inflight = inflightRef.current.get(key)
      if (inflight) return inflight

      const task = (async () => {
        try {
          const result = await window.api.ttsSynthesize(text, voiceRef.current)
          if (!result || !result.audioBase64 || result.engine === 'fallback') return null
          const bytes = decodeBase64(result.audioBase64)
          if (!mountedRef.current) return null
          const blob = new Blob([bytes.buffer as ArrayBuffer], {
            type: result.mimeType || 'audio/mpeg',
          })
          const url = URL.createObjectURL(blob)
          const entry: CacheEntry = {
            url,
            engine: result.engine === 'local' ? 'local' : 'edge',
          }
          if (!mountedRef.current) {
            URL.revokeObjectURL(url)
            return null
          }
          remember(key, entry)
          return entry
        } catch {
          return null
        } finally {
          inflightRef.current.delete(key)
        }
      })()
      inflightRef.current.set(key, task)
      return task
    },
    [cacheKey, getCached, remember],
  )

  const finish = useCallback(() => {
    playingRef.current = false
    setPlaying(false)
    setLoading(false)
  }, [])

  const speakWithBrowser = useCallback(
    (text: string, token: number) => {
      if (token !== tokenRef.current) return
      setEngine('browser')
      setLoading(false)
      const synth = window.speechSynthesis
      if (!synth) {
        onErrorRef.current?.('浏览器不支持语音朗读')
        finish()
        return
      }
      synth.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = 'en-US'
      utterance.rate = rateRef.current
      utterance.pitch = 1
      utterance.onend = () => {
        if (token !== tokenRef.current) return
        speechRef.current = null
        afterSentenceRef.current(indexRef.current, token)
      }
      utterance.onerror = () => {
        if (token !== tokenRef.current) return
        speechRef.current = null
        afterSentenceRef.current(indexRef.current, token)
      }
      speechRef.current = utterance
      synth.speak(utterance)
    },
    [finish],
  )

  const afterSentenceRef = useRef<(index: number, token: number) => void>(() => {})

  const startSentence = useCallback(
    async (target: number, token: number) => {
      const list = sentencesRef.current
      if (token !== tokenRef.current) return
      if (list.length === 0) {
        finish()
        return
      }
      const nextIndex = clampIndex(target, list.length)
      indexRef.current = nextIndex
      setIndex(nextIndex)
      onIndexChangeRef.current?.(nextIndex)
      setLoading(true)

      const text = list[nextIndex]?.text?.trim() ?? ''
      if (!text) {
        afterSentenceRef.current(nextIndex, token)
        return
      }

      // 先发后两句的预取，不阻塞当前句。
      const preload = (offset: number) => {
        const preloadText = list[nextIndex + offset]?.text?.trim()
        if (preloadText) void synthesize(preloadText)
      }
      preload(1)
      preload(2)

      const entry = await synthesize(text)
      if (token !== tokenRef.current) return
      if (!entry) {
        speakWithBrowser(text, token)
        return
      }

      currentKeyRef.current = cacheKey(text)
      setEngine(entry.engine)
      const audio = audioRef.current ?? new Audio()
      audioRef.current = audio
      audio.onended = null
      audio.onerror = null
      audio.pause()
      audio.src = entry.url
      audio.playbackRate = rateRef.current
      audio.onended = () => {
        if (token !== tokenRef.current) return
        afterSentenceRef.current(nextIndex, token)
      }
      audio.onerror = () => {
        if (token !== tokenRef.current) return
        speakWithBrowser(text, token)
      }
      setLoading(false)
      try {
        await audio.play()
      } catch {
        if (token === tokenRef.current) speakWithBrowser(text, token)
      }
    },
    [cacheKey, finish, speakWithBrowser, synthesize],
  )

  afterSentenceRef.current = (current: number, token: number) => {
    if (token !== tokenRef.current) return
    const list = sentencesRef.current
    const nextIndex = repeatRef.current ? current : current + 1
    if (nextIndex >= list.length) {
      finish()
      return
    }
    const pauseMs = Math.max(0, gapRef.current) * 1000
    if (pauseMs > 0) {
      clearTimer()
      timerRef.current = setTimeout(() => {
        if (token !== tokenRef.current) return
        void startSentence(nextIndex, token)
      }, pauseMs)
    } else {
      void startSentence(nextIndex, token)
    }
  }

  const playAt = useCallback(
    (target: number) => {
      const token = ++tokenRef.current
      stopEverything()
      if (sentencesRef.current.length === 0) {
        finish()
        return
      }
      playingRef.current = true
      setPlaying(true)
      void startSentence(target, token)
    },
    [finish, startSentence, stopEverything],
  )

  const play = useCallback(
    (from?: number) => {
      playAt(from ?? indexRef.current)
    },
    [playAt],
  )

  const pause = useCallback(() => {
    tokenRef.current++
    stopEverything()
    playingRef.current = false
    setPlaying(false)
    setLoading(false)
  }, [stopEverything])

  const toggle = useCallback(() => {
    if (playingRef.current) pause()
    else playAt(indexRef.current)
  }, [pause, playAt])

  const next = useCallback(() => {
    playAt(indexRef.current + 1)
  }, [playAt])

  const prev = useCallback(() => {
    playAt(indexRef.current - 1)
  }, [playAt])

  const setRate = useCallback((value: number) => {
    rateRef.current = value
    setRateState(value)
    if (audioRef.current) audioRef.current.playbackRate = value
  }, [])

  const setRepeat = useCallback((value: boolean) => {
    repeatRef.current = value
    setRepeatState(value)
  }, [])

  const setGap = useCallback((value: number) => {
    gapRef.current = value
    setGapState(value)
  }, [])

  // 切换文档时完全重置队列和状态。
  useEffect(() => {
    mountedRef.current = true
    tokenRef.current++
    stopEverything()
    revokeAll()
    playingRef.current = false
    setPlaying(false)
    setLoading(false)
    setEngine('')
    const start = clampIndex(initialIndex, sentencesRef.current.length)
    indexRef.current = start
    setIndex(start)
    return () => {
      mountedRef.current = false
      tokenRef.current++
      stopEverything()
      revokeAll()
    }
    // initialIndex 只用于文档切换时的首次定位，不随父级进度回调反复重置队列。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey])

  // 切换发音时，只换音频源，保留当前句位置和播放状态——正在播放的话从当前句用新发音续播。
  useEffect(() => {
    if (!mountedRef.current) return
    tokenRef.current++
    stopEverything()
    revokeAll()
    setLoading(false)
    setEngine('')
    if (playingRef.current) {
      // 之前正在播放 → 从当前句用新发音自动续播
      void playAt(indexRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice])

  return {
    index,
    playing,
    loading,
    engine,
    rate,
    repeat,
    gap,
    play,
    playAt,
    pause,
    toggle,
    next,
    prev,
    setRate,
    setRepeat,
    setGap,
  }
}
