import { useCallback, useEffect, useRef, useState } from 'react'

export type ReadAloudEngine = 'edge' | 'local' | 'browser' | ''

export interface ReadAloudParagraph {
  /** 段落序号，从 1 开始 */
  number: number
  page: number
  /** 段落内各句文本，用于高亮映射 */
  sentences: string[]
  /** 整段拼接后的朗读文本 */
  text: string
  /** 每句在 text 中的结束字符位置（不含），用于把播放进度映射到句 */
  ends: number[]
}

export interface UsePdfReadAloudOptions {
  paragraphs: ReadAloudParagraph[]
  voice: string
  /** 切换文档时清空缓存和播放状态 */
  sourceKey: string
  /** 初始段落下标（0 开始），来自上次阅读进度 */
  initialIndex?: number
  onIndexChange?: (index: number) => void
  onError?: (message: string) => void
}

export interface PdfReadAloudHandle {
  index: number
  /** 当前段落内正在朗读的句子下标（0 开始） */
  sentenceIndex: number
  playing: boolean
  loading: boolean
  engine: ReadAloudEngine
  rate: number
  play: (from?: number) => void
  playAt: (index: number) => void
  /** 只定位当前段、不开始播放 */
  seek: (index: number) => void
  pause: () => void
  toggle: () => void
  next: () => void
  prev: () => void
  setRate: (rate: number) => void
}

const MAX_CACHE_ENTRIES = 6

interface CacheEntry {
  url: string
  engine: ReadAloudEngine
}

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
 * 按段落朗读 PDF：整段一次合成，音频连贯；播放时按字符进度把高亮映射到段内句子。
 * 在线/本地合成失败时降级到浏览器语音。音频只在内存里缓存，不落盘。
 */
export function usePdfReadAloud({
  paragraphs,
  voice,
  sourceKey,
  initialIndex = 0,
  onIndexChange,
  onError,
}: UsePdfReadAloudOptions): PdfReadAloudHandle {
  const [index, setIndex] = useState(0)
  const [sentenceIndex, setSentenceIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [engine, setEngine] = useState<ReadAloudEngine>('')
  const [rate, setRateState] = useState(1)

  const mountedRef = useRef(true)
  const paragraphsRef = useRef(paragraphs)
  const voiceRef = useRef(voice)
  const indexRef = useRef(0)
  const playingRef = useRef(false)
  const rateRef = useRef(1)
  const tokenRef = useRef(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const speechRef = useRef<SpeechSynthesisUtterance | null>(null)
  const speechTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map())
  const inflightRef = useRef<Map<string, Promise<CacheEntry | null>>>(new Map())
  const currentKeyRef = useRef('')
  const onIndexChangeRef = useRef(onIndexChange)
  const onErrorRef = useRef(onError)

  paragraphsRef.current = paragraphs
  voiceRef.current = voice
  onIndexChangeRef.current = onIndexChange
  onErrorRef.current = onError

  const cacheKey = useCallback((text: string) => `${voiceRef.current}\u0000${text}`, [])

  const afterParagraphRef = useRef<(current: number, token: number) => void>(() => {})

  const clearSpeechTimer = useCallback(() => {
    if (speechTimerRef.current) {
      clearInterval(speechTimerRef.current)
      speechTimerRef.current = null
    }
  }, [])

  const stopAudio = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.onended = null
    audio.onerror = null
    audio.ontimeupdate = null
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
  }, [])

  const cancelSpeech = useCallback(() => {
    clearSpeechTimer()
    speechRef.current = null
    window.speechSynthesis?.cancel()
  }, [clearSpeechTimer])

  const stopEverything = useCallback(() => {
    stopAudio()
    cancelSpeech()
  }, [cancelSpeech, stopAudio])

  const revokeAll = useCallback(() => {
    for (const entry of cacheRef.current.values()) URL.revokeObjectURL(entry.url)
    cacheRef.current.clear()
    inflightRef.current.clear()
    currentKeyRef.current = ''
  }, [])

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

  // 按播放比例定位段内句子：ends[k] 是第 k 句结束的字符位置。
  const syncSentence = useCallback((ratio: number, paragraph: ReadAloudParagraph) => {
    if (paragraph.ends.length === 0 || paragraph.text.length === 0) return
    const pos = Math.max(0, Math.min(ratio, 1)) * paragraph.text.length
    let next = paragraph.ends.findIndex((end) => pos < end)
    if (next < 0) next = paragraph.ends.length - 1
    setSentenceIndex((prev) => (prev === next ? prev : next))
  }, [])

  // 浏览器语音降级：用定时器估算进度，驱动句级高亮。
  const speakWithBrowser = useCallback(
    (paragraph: ReadAloudParagraph, target: number, token: number) => {
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
      const utterance = new SpeechSynthesisUtterance(paragraph.text)
      utterance.lang = 'en-US'
      utterance.rate = rateRef.current
      utterance.pitch = 1
      utterance.onend = () => {
        if (token !== tokenRef.current) return
        speechRef.current = null
        afterParagraphRef.current(target, token)
      }
      utterance.onerror = () => {
        if (token !== tokenRef.current) return
        speechRef.current = null
        afterParagraphRef.current(target, token)
      }
      speechRef.current = utterance
      synth.speak(utterance)

      // 浏览器不返回音频时长，按每段平均每秒 14 个字符粗略推进高亮。
      const started = Date.now()
      const estimateMs = Math.max(1200, ((paragraph.text.length / 14) * 1000) / rateRef.current)
      clearSpeechTimer()
      speechTimerRef.current = setInterval(() => {
        if (token !== tokenRef.current) return
        syncSentence((Date.now() - started) / estimateMs, paragraph)
      }, 120)
    },
    [clearSpeechTimer, finish, syncSentence],
  )

  const startParagraph = useCallback(
    async (target: number, token: number) => {
      const list = paragraphsRef.current
      if (token !== tokenRef.current) return
      if (list.length === 0) {
        finish()
        return
      }
      const nextIndex = clampIndex(target, list.length)
      indexRef.current = nextIndex
      setIndex(nextIndex)
      setSentenceIndex(0)
      onIndexChangeRef.current?.(nextIndex)
      setLoading(true)

      const paragraph = list[nextIndex]
      if (!paragraph || !paragraph.text.trim()) {
        afterParagraphRef.current(nextIndex, token)
        return
      }

      // 预取后一段，减少段间等待。
      const upcoming = list[nextIndex + 1]
      if (upcoming?.text.trim()) void synthesize(upcoming.text)

      const entry = await synthesize(paragraph.text)
      if (token !== tokenRef.current) return
      if (!entry) {
        speakWithBrowser(paragraph, nextIndex, token)
        return
      }

      currentKeyRef.current = cacheKey(paragraph.text)
      setEngine(entry.engine)
      const audio = audioRef.current ?? new Audio()
      audioRef.current = audio
      audio.onended = null
      audio.onerror = null
      audio.ontimeupdate = null
      audio.pause()
      audio.src = entry.url
      audio.playbackRate = rateRef.current
      audio.ontimeupdate = () => {
        if (token !== tokenRef.current) return
        const duration = audio.duration
        if (!Number.isFinite(duration) || duration <= 0) return
        syncSentence(audio.currentTime / duration, paragraph)
      }
      audio.onended = () => {
        if (token !== tokenRef.current) return
        afterParagraphRef.current(nextIndex, token)
      }
      audio.onerror = () => {
        if (token !== tokenRef.current) return
        speakWithBrowser(paragraph, nextIndex, token)
      }
      setLoading(false)
      try {
        await audio.play()
      } catch {
        if (token === tokenRef.current) speakWithBrowser(paragraph, nextIndex, token)
      }
    },
    [cacheKey, finish, speakWithBrowser, synthesize, syncSentence],
  )

  afterParagraphRef.current = (current: number, token: number) => {
    if (token !== tokenRef.current) return
    const next = current + 1
    if (next >= paragraphsRef.current.length) {
      finish()
      return
    }
    void startParagraph(next, token)
  }

  const playAt = useCallback(
    (target: number) => {
      const token = ++tokenRef.current
      stopEverything()
      if (paragraphsRef.current.length === 0) {
        finish()
        return
      }
      playingRef.current = true
      setPlaying(true)
      void startParagraph(target, token)
    },
    [finish, startParagraph, stopEverything],
  )

  const play = useCallback((from?: number) => playAt(from ?? indexRef.current), [playAt])

  const seek = useCallback((target: number) => {
    const next = clampIndex(target, paragraphsRef.current.length)
    indexRef.current = next
    setIndex(next)
    setSentenceIndex(0)
  }, [])

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

  const next = useCallback(() => playAt(indexRef.current + 1), [playAt])
  const prev = useCallback(() => playAt(indexRef.current - 1), [playAt])

  const setRate = useCallback((value: number) => {
    rateRef.current = value
    setRateState(value)
    if (audioRef.current) audioRef.current.playbackRate = value
  }, [])

  // 切换文档：清空缓存并重置到传入进度。
  useEffect(() => {
    mountedRef.current = true
    tokenRef.current++
    stopEverything()
    revokeAll()
    playingRef.current = false
    setPlaying(false)
    setLoading(false)
    setEngine('')
    const start = clampIndex(initialIndex, paragraphsRef.current.length)
    indexRef.current = start
    setIndex(start)
    setSentenceIndex(0)
    return () => {
      mountedRef.current = false
      tokenRef.current++
      stopEverything()
      revokeAll()
    }
    // initialIndex 只用于文档切换时的首次定位，避免进度回调反复重置队列。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey])

  // 切换发音：保留段落位置，播放中则用新发音续播。
  useEffect(() => {
    if (!mountedRef.current) return
    tokenRef.current++
    stopEverything()
    revokeAll()
    setLoading(false)
    setEngine('')
    if (playingRef.current) void playAt(indexRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice])

  return {
    index,
    sentenceIndex,
    playing,
    loading,
    engine,
    rate,
    play,
    playAt,
    seek,
    pause,
    toggle,
    next,
    prev,
    setRate,
  }
}
