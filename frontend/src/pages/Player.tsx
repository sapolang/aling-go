import { useState, useRef, useEffect, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { usePlayerStore } from '@/stores/playerStore'
import { useWordStore } from '@/stores/wordStore'
import type { LibraryFile } from '@/stores/libraryStore'
import type { SubtitleDisplayMode } from '@/stores/playerStore'
import { useThemeStore } from '@/stores/themeStore'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { showToast } from '@/components/feedback'
import { speak } from '@/lib/tts'
import Waveform from '@/components/Waveform'
import WordLookupModal from '@/components/WordLookupModal'
import WordHoverCard from '@/components/WordHoverCard'
import {
  Play,
  Pause,
  Repeat,
  SkipForward,
  CirclePause,
  Pin,
  PinOff,
  Subtitles,
  Loader2,
  Volume2 as Speaker,
  MoreHorizontal,
  Download,
  RotateCcw,
  X as XIcon,
  FileDown,
  ArrowLeft,
  Globe,
  Star,
  Headphones,
  Sparkles,
  Languages,
  BookOpen,
} from 'lucide-react'
import SrtParser from 'srt-parser-2'
import { timeToSeconds } from '@/lib/srt'

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]

const SUBTITLE_MODE_LABELS: Record<SubtitleDisplayMode, string> = {
  all: '全部',
  en: '仅英文',
  zh: '仅中文',
  off: '隐藏',
}

// 匹配 CJK 表意文字、假名、谚文及全角标点，用于区分中/英字幕行
const CJK_RE = /[\u2e80-\u9fff\uf900-\ufaff\u3000-\u303f\u3040-\u30ff\uac00-\ud7af]/

// 按显示模式过滤字幕文本行；off 模式在悬浮层隐藏，列表仍显示全文
const filterSubtitleText = (text: string, mode: SubtitleDisplayMode): string => {
  if (mode === 'all' || mode === 'off') return text
  return text
    .split('\n')
    .filter((line) => (mode === 'zh' ? CJK_RE.test(line) : !CJK_RE.test(line)))
    .join('\n')
    .trim()
}

export default function PlayerPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const isActive = location.pathname === '/player'
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const store = usePlayerStore()
  const dark = useThemeStore((s) => s.dark)
  const [selectedWord, setSelectedWord] = useState('')
  const [currentSentence, setCurrentSentence] = useState('')
  const [hover, setHover] = useState<{ word: string; sentence: string; anchor: DOMRect } | null>(
    null,
  )
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoverHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showLookup, setShowLookup] = useState(false)
  const [playError, setPlayError] = useState<string | null>(null)
  const [showSubMenu, setShowSubMenu] = useState(false)
  const [transcribingLabel, setTranscribingLabel] = useState('')
  const [mediaPort, setMediaPort] = useState(0)
  const [showTranscribeLangModal, setShowTranscribeLangModal] = useState(false)
  const [transcribeLang, setTranscribeLang] = useState('auto')
  const [favTarget, setFavTarget] = useState<{
    startTime: number
    endTime: number
    text: string
  } | null>(null)
  const [favWord, setFavWord] = useState('')
  const [favTags, setFavTags] = useState<{ id: number; name: string }[]>([])
  const [favTagId, setFavTagId] = useState(0)
  const [favNewTag, setFavNewTag] = useState('')
  // 字幕列表拖选：记录起止行，松开后成段循环
  const [dragRange, setDragRange] = useState<{ start: number; end: number } | null>(null)
  const dragRef = useRef<{ active: boolean; anchor: number; current: number }>({
    active: false,
    anchor: -1,
    current: -1,
  })
  // 字幕列表是否跟随播放自动滚动；用户手动滚动后暂停跟随
  const [autoFollow, setAutoFollow] = useState(true)
  // 视频内嵌控制条：鼠标静止 2 秒后淡出，可钉住常显
  const [controlsPinned, setControlsPinned] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const controlsPinnedRef = useRef(false)
  const controlsHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearControlsTimer = () => {
    if (controlsHideTimerRef.current) {
      clearTimeout(controlsHideTimerRef.current)
      controlsHideTimerRef.current = null
    }
  }

  const showPlayerControls = () => {
    setControlsVisible(true)
    clearControlsTimer()
    if (!controlsPinnedRef.current) {
      controlsHideTimerRef.current = setTimeout(() => setControlsVisible(false), 2000)
    }
  }

  const scheduleHideControls = () => {
    clearControlsTimer()
    if (!controlsPinnedRef.current && store.playing) {
      controlsHideTimerRef.current = setTimeout(() => setControlsVisible(false), 2000)
    }
  }

  const toggleControlsPin = () => {
    const next = !controlsPinnedRef.current
    controlsPinnedRef.current = next
    setControlsPinned(next)
    if (next) {
      clearControlsTimer()
      setControlsVisible(true)
    } else {
      showPlayerControls()
    }
  }

  useEffect(() => clearControlsTimer, [])

  // --- AI 选句翻译 / 详解 ---
  const [selPop, setSelPop] = useState<{
    text: string
    context: string
    x: number
    y: number
  } | null>(null)
  const [aiTranslate, setAiTranslate] = useState<{
    reqId: string
    text: string
    loading: boolean
    error?: string
  } | null>(null)
  const [aiExplain, setAiExplain] = useState<{
    loading: boolean
    error?: string
    data?: any
    text?: string
  } | null>(null)
  const aiReqRef = useRef(0)
  const aiActiveReq = useRef('')

  useEffect(() => {
    if (!isActive) return
    const onMouseUp = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      // 点击浮层自身不算重新选区
      if (target?.closest('[data-ai-pop]')) return
      const sel = window.getSelection()
      const raw = sel?.toString().trim() ?? ''
      if (!raw || raw.length < 2) {
        setSelPop(null)
        return
      }
      const range = sel?.rangeCount ? sel.getRangeAt(0) : null
      if (!range) return
      const rect = range.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) return
      const cur = store.subtitles[store.currentSubtitleIndex]
      setSelPop({
        text: raw,
        context: cur ? cur.text : '',
        x: rect.left + rect.width / 2,
        y: rect.top,
      })
      setAiTranslate(null)
      setAiExplain(null)
    }
    document.addEventListener('mouseup', onMouseUp)
    return () => document.removeEventListener('mouseup', onMouseUp)
  }, [isActive, store.subtitles, store.currentSubtitleIndex])

  useEffect(() => {
    const offChunk = window.api.aiOnChunk(({ reqId, delta }: any) => {
      if (reqId !== aiActiveReq.current) return
      setAiTranslate((s) => (s ? { ...s, text: s.text + delta, loading: true } : s))
    })
    const offDone = window.api.aiOnDone(({ reqId, text, error }: any) => {
      if (reqId !== aiActiveReq.current) return
      setAiTranslate({ reqId, text: text || '', loading: false, error })
    })
    return () => {
      offChunk()
      offDone()
    }
  }, [])

  const ensureAIConfig = async () => {
    const cfg = await window.api.aiGetConfig()
    if (!cfg.hasKey) {
      setSelPop(null)
      showToast('请先在「设置 → AI 翻译」中填写 API Key', 'warning')
      navigate('/settings')
      return false
    }
    return true
  }

  const handleAITranslate = async () => {
    if (!selPop || !(await ensureAIConfig())) return
    const id = `t${++aiReqRef.current}`
    aiActiveReq.current = id
    setAiExplain(null)
    setAiTranslate({ reqId: id, text: '', loading: true })
    const r = await window.api.aiTranslateStream(selPop.text, selPop.context, id)
    if (r.error) {
      setAiTranslate((s) => (s ? { ...s, loading: false, error: r.error } : s))
      return
    }
    if (r.cached) setAiTranslate({ reqId: id, text: r.text, loading: false })
  }

  const handleAIExplain = async () => {
    if (!selPop || !(await ensureAIConfig())) return
    setAiTranslate(null)
    setAiExplain({ loading: true, text: selPop.text })
    const r = await window.api.aiExplain(selPop.text, selPop.context)
    if (!r.ok) setAiExplain({ loading: false, error: r.error, text: selPop.text })
    else setAiExplain({ loading: false, data: r.data, text: selPop.text })
  }

  const ext = store.filePath?.toLowerCase().match(/\.(\w+)$/)?.[1]
  const isAudio = ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac'].includes(ext || '')

  // 按显示模式派生字幕：过滤中/英文行，过滤后无内容的条目在列表中隐藏
  const displaySubtitles = useMemo(
    () =>
      store.subtitles
        .map((s) => ({
          ...s,
          displayText: filterSubtitleText(s.text, store.subtitleDisplayMode),
        }))
        .filter((s) => s.displayText.length > 0),
    [store.subtitles, store.subtitleDisplayMode],
  )

  useEffect(() => {
    window.api.getWhisperLang().then(setTranscribeLang)
  }, [])

  // 生词库词表：已收藏的词在字幕中高亮显示
  const savedWordList = useWordStore((s) => s.words)
  const loadWords = useWordStore((s) => s.loadWords)
  const savedWords = useMemo(
    () => new Set(savedWordList.map((w) => w.word.toLowerCase())),
    [savedWordList],
  )
  useEffect(() => {
    void loadWords()
  }, [])

  const isSavedWord = (part: string) => {
    let clean = part.toLowerCase().replace(/[^a-z0-9\-']/g, '')
    if (clean.endsWith("'s")) clean = clean.slice(0, -2)
    return clean.length > 1 && savedWords.has(clean)
  }
  const savedWordMark = 'text-amber-500 underline decoration-dotted underline-offset-2'

  // 当前循环区间覆盖的字幕行，用于在列表中持续高亮
  const loopRange = useMemo(() => {
    if (store.loopStart === null || store.loopEnd === null) return null
    const off = store.subtitleOffset
    let start = -1
    let end = -1
    displaySubtitles.forEach((s, i) => {
      if (s.endTime + off > store.loopStart! && s.startTime + off < store.loopEnd!) {
        if (start === -1) start = i
        end = i
      }
    })
    return start === -1 ? null : { start, end }
  }, [store.loopStart, store.loopEnd, store.subtitleOffset, displaySubtitles])

  // 拖选结束：选多行成段循环，单行保持原来的跳转行为
  const dragFinalizeRef = useRef<() => void>(() => {})
  dragFinalizeRef.current = () => {
    const drag = dragRef.current
    if (!drag.active) return
    dragRef.current = { active: false, anchor: -1, current: -1 }
    const start = Math.min(drag.anchor, drag.current)
    const end = Math.max(drag.anchor, drag.current)
    setDragRange(null)
    cancelHover()
    const a = displaySubtitles[start]
    const b = displaySubtitles[end]
    if (!a || !b) return
    const st = usePlayerStore.getState()
    const off = st.subtitleOffset
    if (end > start) {
      st.setLoop(a.startTime + off, b.endTime + off)
      st.requestSeek(a.startTime + off)
      st.setPlaying(true)
      showToast(`已循环第 ${start + 1}–${end + 1} 句`, 'info')
    } else {
      st.requestSeek(a.startTime + off)
    }
  }

  useEffect(() => {
    const onUp = () => dragFinalizeRef.current()
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [])

  // --- Refs for event handlers (avoid stale closures) ---
  const onTimeUpdateRef = useRef<() => void>(() => {})
  const onMetaRef = useRef<() => void>(() => {})
  const lastPosSaveRef = useRef(0)
  const resumedForRef = useRef('')
  // 自动暂停：记录上一帧所在句和播放时间，用于判断是否刚刚越过句尾
  const prevSubIdxRef = useRef(-1)
  const lastTickTimeRef = useRef(0)
  // 悬停查词时暂停播放；鼠标离开后恢复
  const hoverPauseRef = useRef(false)

  onTimeUpdateRef.current = () => {
    const el = mediaRef.current
    if (!el) return
    store.setPlayed(el.currentTime)
    store.setPlaying(!el.paused)
    // 字幕匹配使用偏移后的时间：offset>0 表示字幕整体延后
    const t = el.currentTime - store.subtitleOffset
    const idx = store.subtitles.findIndex((s) => t >= s.startTime - 0.08 && t <= s.endTime)
    if (idx !== -1) store.setCurrentSubtitleIndex(idx)

    // 播完本句自动暂停：本帧越过上一句句尾时停在边界处（循环模式优先级更高）
    const prevIdx = prevSubIdxRef.current
    const prevTick = lastTickTimeRef.current
    lastTickTimeRef.current = el.currentTime
    // 拖动进度/跳句会造成时间突跳，此时不做自动暂停判定，避免刚跳过去就被拉回
    const jumped = prevTick > 0 && Math.abs(el.currentTime - prevTick) > 1
    if (store.autoPause && !el.paused && prevIdx >= 0 && !store.loopEnd && !jumped) {
      const prevSub = store.subtitles[prevIdx]
      const boundary = prevSub ? prevSub.endTime + store.subtitleOffset : -1
      if (prevSub && prevTick < boundary && el.currentTime >= boundary) {
        el.pause()
        el.currentTime = boundary
        store.setPlayed(boundary)
        store.setPlaying(false)
        if (store.filePath) {
          lastPosSaveRef.current = boundary
          window.api.recentUpdatePosition(store.filePath, boundary)
        }
        prevSubIdxRef.current = -1
        return
      }
    }
    prevSubIdxRef.current = idx
    if (store.loopEnd && el.currentTime >= store.loopEnd) {
      el.currentTime = store.loopStart || 0
    }
    // 每 5s 节流保存播放位置
    if (store.filePath && Math.abs(el.currentTime - lastPosSaveRef.current) >= 5) {
      lastPosSaveRef.current = el.currentTime
      window.api.recentUpdatePosition(store.filePath, el.currentTime)
    }
  }

  onMetaRef.current = () => {
    const el = mediaRef.current
    if (!el) return
    store.setDuration(el.duration)
    const fp = store.filePath
    if (!fp) return
    // 收藏片段跳转：定位到片段起点并循环，优先于续播位置
    const pc = usePlayerStore.getState().playClip
    if (pc && pc.filePath === fp) {
      resumedForRef.current = fp
      lastPosSaveRef.current = pc.startTime
      el.currentTime = pc.startTime
      store.setLoop(pc.startTime, pc.endTime)
      store.setPlaying(true)
      store.setPlayClip(null)
      return
    }
    // 打开文件后续播上次位置；剩余 <15s 或 <5% 视为已看完，归零
    if (resumedForRef.current === fp) return
    resumedForRef.current = fp
    lastPosSaveRef.current = 0
    window.api.recentGetPosition(fp).then((pos: number) => {
      if (!pos || pos <= 0) return
      const dur = el.duration || 0
      const remaining = dur - pos
      if (dur > 0 && (remaining < 15 || remaining / dur < 0.05)) {
        window.api.recentUpdatePosition(fp, 0)
        return
      }
      el.currentTime = pos
      lastPosSaveRef.current = pos
    })
  }

  // --- Media element event wiring ---
  useEffect(() => {
    const el = mediaRef.current
    if (!el) return
    const onTime = () => onTimeUpdateRef.current()
    const onMeta = () => onMetaRef.current()
    const onEnded = () => {
      store.setPlaying(false)
      const st = usePlayerStore.getState()
      const endedPath = st.filePath
      if (!st.autoNextEpisode || !endedPath) return
      findNextEpisode(endedPath).then((next) => {
        // 等待期间用户可能已手动切换文件
        if (next && usePlayerStore.getState().filePath === endedPath) openMediaFile(next)
      })
    }
    const onError = () => setPlayError('媒体加载失败')
    el.addEventListener('timeupdate', onTime)
    el.addEventListener('loadedmetadata', onMeta)
    el.addEventListener('ended', onEnded)
    el.addEventListener('error', onError)
    if (el.duration) onMetaRef.current()
    return () => {
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('loadedmetadata', onMeta)
      el.removeEventListener('ended', onEnded)
      el.removeEventListener('error', onError)
    }
  }, [store.filePath])

  // --- Auto play on file open ---
  useEffect(() => {
    if (!store.filePath) return
    const el = mediaRef.current
    if (el && el.readyState >= 1) {
      store.setPlaying(true)
      return
    }
    const onLoaded = () => store.setPlaying(true)
    el?.addEventListener('canplay', onLoaded, { once: true })
    return () => el?.removeEventListener('canplay', onLoaded)
  }, [store.filePath])

  // --- Sync play/pause/rate ---
  useEffect(() => {
    const el = mediaRef.current
    if (!el) return
    if (store.playing) el.play().catch(() => {})
    else el.pause()
    el.playbackRate = store.playbackRate
  }, [store.playing, store.playbackRate])

  // --- Consume seek command ---
  useEffect(() => {
    const el = mediaRef.current
    if (el && store.seekTo !== null && store.seekTo >= 0) {
      el.currentTime = store.seekTo
      store.requestSeek(-1)
    }
  }, [store.seekTo])

  // --- Reset scroll to top when file changes ---
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
    prevSubIdxRef.current = -1
    lastTickTimeRef.current = 0
    hoverPauseRef.current = false
    setAutoFollow(true)
  }, [store.filePath, store.subtitles])

  // --- 当前字幕切换时自动滚动到容器中间（用户手动浏览时暂停跟随） ---
  const lastSubIdx = useRef(-2)
  useEffect(() => {
    if (!autoFollow) return
    const el = scrollRef.current
    if (!el || displaySubtitles.length === 0) return
    const t = store.played - store.subtitleOffset
    const idx = displaySubtitles.findIndex((s) => t >= s.startTime - 0.08 && t < s.endTime)
    if (idx <= 0 || idx === lastSubIdx.current) return
    lastSubIdx.current = idx
    const child = el.children[idx] as HTMLElement
    if (child) child.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [store.played, store.subtitleOffset, displaySubtitles, autoFollow])

  // 回到当前句并恢复自动跟随
  const resumeFollow = () => {
    lastSubIdx.current = -2
    setAutoFollow(true)
    const el = scrollRef.current
    if (!el || displaySubtitles.length === 0) return
    const t = store.played - store.subtitleOffset
    const idx = displaySubtitles.findIndex((s) => t >= s.startTime - 0.08 && t < s.endTime)
    const child = idx >= 0 ? (el.children[idx] as HTMLElement) : null
    if (child) child.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  // --- Close sub menu on outside click ---
  useEffect(() => {
    if (!showSubMenu) return
    const close = () => setShowSubMenu(false)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [showSubMenu])

  // --- Keyboard shortcuts ---
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!isActive) return
      const el = mediaRef.current
      if (!el) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.code === 'Space') {
        e.preventDefault()
        hoverPauseRef.current = false
        store.playing ? el.pause() : el.play()
        store.setPlaying(!store.playing)
      }
      if (e.code === 'ArrowLeft') el.currentTime = Math.max(0, el.currentTime - 5)
      if (e.code === 'ArrowRight') el.currentTime = Math.min(el.duration || 0, el.currentTime + 5)
      // --- 逐句复读与字幕微调（用 getState 避免闭包捕获旧状态） ---
      const st = usePlayerStore.getState()
      const subs = st.subtitles
      const off = st.subtitleOffset
      if (e.code === 'Comma') st.adjustSubtitleOffset(-0.1)
      if (e.code === 'Period') st.adjustSubtitleOffset(0.1)
      if (e.code === 'KeyU') {
        e.preventDefault()
        st.setAutoPause(!st.autoPause)
        showToast(st.autoPause ? '已关闭自动暂停' : '已开启自动暂停', 'info')
      }
      if (e.code === 'KeyE') {
        e.preventDefault()
        const modes: SubtitleDisplayMode[] = ['all', 'en', 'zh', 'off']
        const next = modes[(modes.indexOf(st.subtitleDisplayMode) + 1) % modes.length]
        st.setSubtitleDisplayMode(next)
        showToast(`字幕显示：${SUBTITLE_MODE_LABELS[next]}`, 'info')
      }
      if (e.code === 'KeyP') {
        e.preventDefault()
        const next =
          PLAYBACK_RATES[(PLAYBACK_RATES.indexOf(st.playbackRate) + 1) % PLAYBACK_RATES.length]
        st.setPlaybackRate(next)
        showToast(`播放速度 ${next}x`, 'info')
      }
      if (subs.length === 0) return
      const t = el.currentTime - off
      const curIdx = subs.findIndex((s) => t >= s.startTime - 0.08 && t <= s.endTime)
      const lastBefore = (time: number) => {
        let idx = -1
        for (let i = 0; i < subs.length; i++) {
          if (subs[i].startTime + off <= time + 0.3) idx = i
          else break
        }
        return idx
      }
      const seekToSub = (i: number) => {
        if (i < 0 || i >= subs.length) return
        el.currentTime = subs[i].startTime + off
        el.play().catch(() => {})
        st.setPlaying(true)
      }
      if (e.code === 'BracketLeft') {
        e.preventDefault()
        if (e.shiftKey) {
          // Shift+[ 上一句
          if (curIdx > 0) seekToSub(curIdx - 1)
          else if (curIdx === -1) seekToSub(Math.max(0, lastBefore(t) - 1))
        } else {
          // [ 重播当前句（不在句内时重播最近的一句）
          seekToSub(curIdx >= 0 ? curIdx : lastBefore(t))
        }
      }
      if (e.code === 'BracketRight') {
        e.preventDefault()
        // ] 下一句
        if (curIdx >= 0) seekToSub(curIdx + 1)
        else {
          const next = subs.findIndex((s) => s.startTime + off > t + 0.3)
          if (next !== -1) seekToSub(next)
        }
      }
      if (e.code === 'KeyR') {
        e.preventDefault()
        // R 重播当前句
        seekToSub(curIdx >= 0 ? curIdx : lastBefore(t))
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isActive, store.playing])

  // 打开媒体文件：设置路径、加载波形、加载字幕（缓存优先，回退同名 SRT）
  const openMediaFile = async (filePath: string) => {
    store.setFilePath(filePath)
    setPlayError(null)
    window.api.recentAdd(filePath)
    store.setWaveformLoading(true)
    window.api
      .getWaveformData(filePath)
      .then((data: number[]) => {
        if (data && data.length > 0) store.setWaveformData(data)
        else store.setWaveformLoading(false)
      })
      .catch(() => store.setWaveformLoading(false))
    try {
      const cached = await window.api.getCachedSubtitles(filePath)
      if (cached && cached.length > 0) {
        store.setSubtitles(cached)
        return
      }
      const srtPath = filePath.replace(/\.[^.]+$/, '.srt')
      try {
        await window.api.readTextFile(srtPath)
        loadSrtFile(srtPath)
      } catch (e) {
        console.error('Failed to load SRT:', e)
      }
    } catch (e) {
      console.error('Failed to load cached subtitles:', e)
    }
  }

  const handleOpenFile = async () => {
    const filePath = await window.api.openFile()
    if (filePath) openMediaFile(filePath)
  }

  // 媒体库同文件夹内按名称自然排序，取当前文件的下一个（自动下一集）
  const findNextEpisode = async (current: string): Promise<string | null> => {
    try {
      const lib = await window.api.libraryList()
      const files = ((lib?.files || []) as LibraryFile[]).filter((f) => f.type !== 'pdf')
      const cur = files.find((f) => f.path === current)
      if (!cur) return null
      const siblings = files
        .filter((f) => f.folderId === cur.folderId)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      const idx = siblings.findIndex((f) => f.path === current)
      return idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1].path : null
    } catch {
      return null
    }
  }

  const handleLoadSrt = async () => {
    const path = await window.api.openSubtitle()
    if (path) loadSrtFile(path)
  }

  const loadSrtFile = async (path: string) => {
    try {
      const content = await window.api.readTextFile(path)
      const parsed = new SrtParser().fromSrt(content)
      const subs = parsed.map((s: any) => ({
        id: parseInt(s.id),
        startTime: timeToSeconds(s.startTime),
        endTime: timeToSeconds(s.endTime),
        text: s.text,
      }))
      store.setSubtitles(subs)
      store.setSubtitlePath(path)
      if (store.filePath) window.api.cacheSubtitles(store.filePath, subs)
    } catch (err) {
      console.error(err)
    }
  }

  const startTranscription = async (filePath: string, lang?: string) => {
    const status = await window.api.whisperStatus()
    if (!status.loaded) {
      store.setTranscribing(true)
      store.setTranscriptionProgress(0)
      setTranscribingLabel('下载模型')
      const dlCleanup = window.api.onDownloadProgress((pct: number) =>
        store.setTranscriptionProgress(pct),
      )
      try {
        await window.api.downloadWhisperModel('https://hf-mirror.com', 'tiny')
        await window.api.setWhisperModel('tiny')
      } catch (err: any) {
        dlCleanup()
        store.setTranscribing(false)
        setTranscribingLabel('')
        showToast('模型下载失败: ' + (err?.message || String(err)), 'error')
        return
      }
      dlCleanup()
    }
    store.setTranscribing(true)
    store.setTranscriptionProgress(0)
    setTranscribingLabel('转录中')
    const cleanup = window.api.onWhisperProgress((d: { progress: number }) =>
      store.setTranscriptionProgress(d.progress),
    )
    try {
      if (lang) {
        window.api.setWhisperLang(lang)
      }
      const subs = await window.api.whisperTranscribe(filePath)
      if (subs.length === 0) {
        showToast('转录完成，但未识别到语音。请在设置页检查模型和语言设置是否正确', 'warning')
      }
      store.setSubtitles(subs)
      window.api.cacheSubtitles(filePath, subs)
    } catch (err: any) {
      const msg = err?.message || String(err)
      store.setTranscriptionProgress(-1)
      if (msg.includes('fetch'))
        showToast('模型下载失败，设 HF_MIRROR=https://hf-mirror.com 后重试', 'error')
      else showToast(`转录失败: ${msg}`, 'error')
    } finally {
      cleanup()
      store.setTranscribing(false)
      setTranscribingLabel('')
    }
  }

  const exportSubtitles = async () => {
    if (store.subtitles.length === 0) return
    const toSrtTime = (s: number) => {
      const h = Math.floor(s / 3600)
      const m = Math.floor((s % 3600) / 60)
      const sec = s % 60
      const ms = Math.round((sec % 1) * 1000)
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${Math.floor(sec).toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`
    }
    const srt = store.subtitles
      .map((s, i) => `${i + 1}\n${toSrtTime(s.startTime)} --> ${toSrtTime(s.endTime)}\n${s.text}\n`)
      .join('\n')
    const filePath = await window.api.saveFile('subtitle.srt')
    if (filePath) {
      await window.api.writeTextFile(filePath, srt)
    }
  }

  const retranscribe = () => {
    if (store.filePath) setShowTranscribeLangModal(true)
  }
  const closeSubtitles = () => {
    store.setSubtitles([])
  }

  // 悬停查词暂停：只在本来正在播放时暂停，鼠标离开后自动续播
  const pauseForHover = () => {
    const st = usePlayerStore.getState()
    const el = mediaRef.current
    if (!st.hoverPause || hoverPauseRef.current || !el || el.paused) return
    el.pause()
    st.setPlaying(false)
    hoverPauseRef.current = true
  }

  const resumeAfterHover = () => {
    if (!hoverPauseRef.current) return
    hoverPauseRef.current = false
    const st = usePlayerStore.getState()
    const el = mediaRef.current
    if (!el || !st.filePath) return
    el.play().catch(() => {})
    st.setPlaying(true)
  }

  const handleWordClick = (word: string, sentence: string) => {
    const clean = word.replace(/[^a-zA-Z0-9\-']/g, '')
    if (!clean) return
    // 点词即查时暂停播放，方便看释义
    hoverPauseRef.current = false
    cancelHover()
    mediaRef.current?.pause()
    store.setPlaying(false)
    speak(clean)
    setSelectedWord(clean)
    setCurrentSentence(sentence)
    setShowLookup(true)
  }

  // 悬停 150ms 后弹出释义，避免扫过字幕时闪烁
  const scheduleHover = (word: string, sentence: string, el: HTMLElement) => {
    if (dragRef.current.active) return
    const clean = word.replace(/[^a-zA-Z0-9\-']/g, '')
    if (clean.length < 2) return
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    if (hoverHideTimer.current) clearTimeout(hoverHideTimer.current)
    const anchor = el.getBoundingClientRect()
    hoverTimer.current = setTimeout(() => {
      pauseForHover()
      setHover({ word: clean, sentence, anchor })
    }, 150)
  }

  // 移出单词后延迟收起，留出时间把鼠标移进浮层
  const scheduleHideHover = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    if (hoverHideTimer.current) clearTimeout(hoverHideTimer.current)
    hoverHideTimer.current = setTimeout(() => {
      setHover(null)
      resumeAfterHover()
    }, 250)
  }

  const keepHover = () => {
    if (hoverHideTimer.current) clearTimeout(hoverHideTimer.current)
  }

  const cancelHover = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    if (hoverHideTimer.current) clearTimeout(hoverHideTimer.current)
    hoverTimer.current = null
    hoverHideTimer.current = null
    setHover(null)
  }

  // 播放推进导致当前句切换时，悬停提示的位置已失效
  useEffect(() => {
    cancelHover()
  }, [store.currentSubtitleIndex])

  const openFavorite = (sub: { startTime: number; endTime: number; text: string }, word = '') => {
    setFavTarget({ startTime: sub.startTime, endTime: sub.endTime, text: sub.text })
    setFavWord(word)
    setFavTagId(0)
    setFavNewTag('')
    window.api.favoriteTagsList().then(setFavTags)
  }

  const saveFavorite = async () => {
    if (!favTarget || !store.filePath) return
    let tagId = favTagId
    const name = favNewTag.trim()
    if (name) {
      const id = await window.api.favoriteTagAdd(name)
      if (id > 0) tagId = id
    }
    await window.api.favoriteAdd({
      filePath: store.filePath,
      startTime: favTarget.startTime,
      endTime: favTarget.endTime,
      text: favTarget.text,
      tagId,
      word: favWord.trim(),
    })
    setFavTarget(null)
  }

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    return `${m}:${Math.floor(s % 60)
      .toString()
      .padStart(2, '0')}`
  }

  useEffect(() => {
    window.api.getMediaPort().then(setMediaPort)
  }, [])
  const mediaUrl =
    store.filePath && mediaPort
      ? `http://127.0.0.1:${mediaPort}/media/${encodeURIComponent(store.filePath)}`
      : ''

  // 播放控制按钮组：视频时内嵌到画面底部，音频时放在播放器下方
  const renderTransportControls = () => (
    <div className="flex items-center justify-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          hoverPauseRef.current = false
          store.setPlaying(!store.playing)
          showPlayerControls()
        }}
      >
        {store.playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
      </Button>
      <select
        value={store.playbackRate}
        onChange={(e) => store.setPlaybackRate(parseFloat(e.target.value))}
        className="bg-background border rounded px-2 py-1 text-sm"
        title="快捷键 P 循环切换倍速"
      >
        {PLAYBACK_RATES.map((r) => (
          <option key={r} value={r}>
            {r}x
          </option>
        ))}
      </select>
      <Button
        variant="ghost"
        size="sm"
        className={store.loopStart !== null ? 'text-primary' : ''}
        onClick={() =>
          store.loopStart !== null ? store.setLoop(null, null) : store.setLoop(store.played, null)
        }
      >
        <Repeat className="h-4 w-4" />
      </Button>
      {store.loopStart !== null && (
        <div className="flex items-center gap-1 text-xs">
          <span>A: {formatTime(store.loopStart)}</span>
          {store.loopEnd !== null ? (
            <>
              <span className="text-muted-foreground">B: {formatTime(store.loopEnd)}</span>
              <button
                className="px-1 text-muted-foreground hover:text-destructive"
                title="清除循环区间"
                onClick={() => store.setLoop(null, null)}
              >
                <XIcon className="h-3 w-3" />
              </button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => store.setLoop(store.loopStart, store.played)}
            >
              B: {formatTime(store.played)}
            </Button>
          )}
        </div>
      )}
      <Button
        variant="ghost"
        size="sm"
        className={store.podcastMode ? 'text-primary' : ''}
        onClick={() => store.setPodcastMode(!store.podcastMode)}
        title="播客模式"
      >
        <Headphones className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className={store.autoNextEpisode ? 'text-primary' : ''}
        title={store.autoNextEpisode ? '自动下一集：开' : '自动下一集：关'}
        onClick={() => store.setAutoNextEpisode(!store.autoNextEpisode)}
      >
        <SkipForward className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className={store.autoPause ? 'text-primary' : ''}
        title={store.autoPause ? '播完本句自动暂停：开（U）' : '播完本句自动暂停：关（U）'}
        onClick={() => store.setAutoPause(!store.autoPause)}
      >
        <CirclePause className="h-4 w-4" />
      </Button>
    </div>
  )

  const videoControlsShown = controlsPinned || !store.playing || controlsVisible

  // --- Player view ---
  const renderPlayer = () => (
    <div className="flex-1 flex flex-col lg:flex-row gap-4 min-h-0">
      <div className="flex-1 flex flex-col gap-2">
        <div
          className="relative"
          onMouseMove={isAudio ? undefined : showPlayerControls}
          onMouseLeave={isAudio ? undefined : scheduleHideControls}
        >
          <div
            className={`bg-black rounded-lg overflow-hidden relative flex items-center justify-center ${isAudio ? 'h-20' : 'aspect-video'} ${store.podcastMode ? 'hidden' : ''}`}
            onClick={() => {
              store.setPlaying(!store.playing)
              showPlayerControls()
            }}
          >
            {isAudio ? (
              <audio
                ref={mediaRef as any}
                src={mediaUrl}
                controls
                style={{ width: '90%', height: 50 }}
              />
            ) : (
              <video
                ref={mediaRef as any}
                src={mediaUrl}
                className="w-full h-full absolute inset-0 object-contain"
                playsInline
              />
            )}
            {playError && (
              <div className="absolute inset-0 flex items-center justify-center text-destructive bg-black/80">
                播放失败: {playError}
              </div>
            )}
            {!isAudio &&
              store.subtitleDisplayMode !== 'off' &&
              (() => {
                const pa = store.played - store.subtitleOffset
                const sub = store.subtitles.find((s) => pa >= s.startTime - 0.08 && pa <= s.endTime)
                const text = sub ? filterSubtitleText(sub.text, store.subtitleDisplayMode) : ''
                return sub && text ? (
                  <div
                    className={`absolute bottom-0 left-0 right-0 p-4 flex justify-center ${videoControlsShown ? 'pb-16' : 'pb-6'}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="bg-black/70 text-white px-4 py-2 rounded text-3xl text-center max-w-[90%] leading-relaxed whitespace-pre-line">
                      {text.split(/(\s+)/).map((part, i) => {
                        const clean = part.replace(/[^a-zA-Z0-9\-']/g, '')
                        if (clean.length > 1)
                          return (
                            <span
                              key={i}
                              className={`${isSavedWord(part) ? savedWordMark + ' ' : ''}cursor-pointer hover:text-primary hover:underline`}
                              onMouseEnter={(e) => scheduleHover(part, sub.text, e.currentTarget)}
                              onMouseLeave={scheduleHideHover}
                              onClick={(e) => {
                                e.stopPropagation()
                                handleWordClick(part, sub.text)
                              }}
                            >
                              {part}
                            </span>
                          )
                        return <span key={i}>{part}</span>
                      })}
                    </span>
                  </div>
                ) : null
              })()}
          </div>

          {!isAudio && store.filePath && !store.podcastMode && (
            <div
              className={`absolute inset-x-0 bottom-0 px-2 pb-2 pt-10 bg-gradient-to-t from-black/85 via-black/40 to-transparent transition-opacity duration-200 ${videoControlsShown ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-center gap-2 [&_button]:text-white [&_button:hover]:bg-white/10 [&_select]:bg-black/40 [&_select]:text-white [&_select]:border-white/30">
                {renderTransportControls()}
              </div>
              <button
                className="absolute right-2 top-1 p-1 text-white/70 hover:text-white"
                title={controlsPinned ? '取消固定控制条' : '固定控制条'}
                onClick={(e) => {
                  e.stopPropagation()
                  toggleControlsPin()
                }}
              >
                {controlsPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
              </button>
            </div>
          )}
        </div>

        {store.podcastMode && store.filePath && (
          <div className="rounded-lg border bg-gradient-to-br from-primary/15 via-muted/60 to-background flex flex-col items-center justify-center gap-3 py-10 px-4">
            <Headphones className="h-16 w-16 text-primary" />
            <div className="text-sm text-muted-foreground max-w-[80%] truncate">
              {store.filePath.split('/').pop()}
            </div>
            {(() => {
              const pa = store.played - store.subtitleOffset
              const sub = store.subtitles.find((s) => pa >= s.startTime - 0.08 && pa <= s.endTime)
              return sub ? (
                <div className="text-2xl font-medium text-center max-w-[85%] leading-relaxed whitespace-pre-line">
                  {sub.text}
                </div>
              ) : null
            })()}
          </div>
        )}

        {store.filePath && (
          <div
            className={
              store.podcastMode
                ? 'h-[160px] shrink-0'
                : isAudio
                  ? 'h-[100px] shrink-0'
                  : 'h-[48px] shrink-0'
            }
          >
            <Waveform
              data={store.waveformData}
              duration={store.duration}
              currentTime={store.played - store.subtitleOffset}
              subtitles={store.subtitles}
              loading={store.waveformLoading}
              dark={dark}
              onSeek={(t) => store.requestSeek(t)}
            />
          </div>
        )}

        {store.filePath && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-12 text-right">
              {formatTime(store.played)}
            </span>
            <input
              type="range"
              min={0}
              max={store.duration || 1}
              value={store.played}
              onChange={(e) => store.requestSeek(parseFloat(e.target.value))}
              className="flex-1 h-1 accent-primary"
            />
            <span className="text-xs text-muted-foreground w-12">{formatTime(store.duration)}</span>
          </div>
        )}

        {(isAudio || store.podcastMode) && store.filePath && renderTransportControls()}

        {store.transcribing && store.transcriptionProgress >= 0 && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>
              Whisper {transcribingLabel} {store.transcriptionProgress}%
            </span>
            <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden max-w-xs">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${store.transcriptionProgress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <div
        className="w-full lg:w-96 border rounded-lg bg-card flex flex-col"
        style={{ maxHeight: 'calc(100vh - 180px)' }}
      >
        <div className="flex items-center justify-between px-3 pt-3 pb-2 shrink-0">
          <h3 className="text-sm font-semibold">字幕</h3>
          <div className="flex items-center gap-3">
            {!autoFollow && (
              <button className="text-xs text-primary hover:underline" onClick={resumeFollow}>
                回到当前句
              </button>
            )}
            <div className="relative">
              <button
                className="p-1 hover:bg-muted rounded"
                onClick={(e) => {
                  e.stopPropagation()
                  setShowSubMenu(!showSubMenu)
                }}
                title="字幕操作"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
              {showSubMenu && (
                <div
                  className="absolute right-0 top-full mt-1 bg-popover border rounded shadow-lg py-1 z-50 min-w-[140px]"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent text-left"
                    onClick={() => {
                      setShowSubMenu(false)
                      exportSubtitles()
                    }}
                  >
                    <Download className="h-3.5 w-3.5" /> 导出 SRT
                  </button>
                  <button
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent text-left"
                    onClick={() => {
                      setShowSubMenu(false)
                      handleLoadSrt()
                    }}
                  >
                    <FileDown className="h-3.5 w-3.5" /> 导入 SRT
                  </button>
                  <div className="px-3 pt-2 pb-1 border-t border-border mt-1">
                    <div className="text-xs text-muted-foreground mb-1">显示模式</div>
                    <div className="flex gap-1">
                      {(
                        [
                          ['all', '全部'],
                          ['en', '仅英'],
                          ['zh', '仅中'],
                          ['off', '隐藏'],
                        ] as const
                      ).map(([m, label]) => (
                        <button
                          key={m}
                          className={`flex-1 px-1 py-1 text-xs rounded ${store.subtitleDisplayMode === m ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
                          onClick={() => store.setSubtitleDisplayMode(m)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="px-3 py-1 border-t border-border mt-1">
                    <button
                      className="flex items-center justify-between w-full text-xs hover:text-foreground"
                      onClick={() => store.setHoverPause(!store.hoverPause)}
                    >
                      <span className="text-muted-foreground">悬停查词时暂停</span>
                      <span className={store.hoverPause ? 'text-primary' : 'text-muted-foreground'}>
                        {store.hoverPause ? '开' : '关'}
                      </span>
                    </button>
                  </div>
                  <div className="px-3 pt-2 pb-1 border-t border-border mt-1">
                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                      <span>字幕偏移</span>
                      <span>{store.subtitleOffset.toFixed(1)}s</span>
                    </div>
                    <div className="flex gap-1">
                      <button
                        className="flex-1 px-1 py-1 text-xs hover:bg-accent rounded"
                        title="字幕提前 0.1s（快捷键 ,）"
                        onClick={() => store.adjustSubtitleOffset(-0.1)}
                      >
                        -0.1s
                      </button>
                      <button
                        className="flex-1 px-1 py-1 text-xs hover:bg-accent rounded"
                        onClick={() => store.adjustSubtitleOffset(-store.subtitleOffset)}
                      >
                        重置
                      </button>
                      <button
                        className="flex-1 px-1 py-1 text-xs hover:bg-accent rounded"
                        title="字幕延后 0.1s（快捷键 .）"
                        onClick={() => store.adjustSubtitleOffset(0.1)}
                      >
                        +0.1s
                      </button>
                    </div>
                  </div>
                  {store.subtitles.length > 0 && (
                    <>
                      <button
                        className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent text-left"
                        onClick={() => {
                          setShowSubMenu(false)
                          retranscribe()
                        }}
                      >
                        <RotateCcw className="h-3.5 w-3.5" /> 重新转录
                      </button>
                      <button
                        className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent text-left text-destructive"
                        onClick={() => {
                          setShowSubMenu(false)
                          closeSubtitles()
                        }}
                      >
                        <XIcon className="h-3.5 w-3.5" /> 关闭字幕
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        {displaySubtitles.length > 1 && (
          <div className="px-3 pb-1 text-[11px] text-muted-foreground/70 shrink-0">
            按住时间戳上下拖动，可选多句循环
          </div>
        )}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-3 pb-3"
          onWheel={(e) => {
            if (autoFollow && e.currentTarget.scrollHeight > e.currentTarget.clientHeight) {
              setAutoFollow(false)
            }
          }}
          onTouchMove={() => {
            if (autoFollow) setAutoFollow(false)
          }}
        >
          {store.subtitles.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 p-4">
              <p className="text-xs text-muted-foreground">暂无字幕</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={handleLoadSrt}>
                  <Subtitles className="h-4 w-4 mr-1" /> 导入字幕
                </Button>
                <Button
                  size="sm"
                  onClick={() => store.filePath && setShowTranscribeLangModal(true)}
                >
                  <Loader2 className="h-4 w-4 mr-1" /> 转录字幕
                </Button>
              </div>
            </div>
          ) : (
            displaySubtitles.map((sub, idx) => {
              const pa = store.played - store.subtitleOffset
              const isActive = pa >= sub.startTime - 0.08 && pa < sub.endTime
              const isPast = pa > sub.endTime
              const range = dragRange ?? loopRange
              const inRange = range !== null && idx >= range.start && idx <= range.end
              return (
                <div
                  key={sub.id}
                  onMouseEnter={() => {
                    if (!dragRef.current.active) return
                    dragRef.current.current = idx
                    const a = dragRef.current.anchor
                    setDragRange({ start: Math.min(a, idx), end: Math.max(a, idx) })
                  }}
                  className={`p-2 rounded text-lg cursor-pointer transition-colors mb-1 ${inRange ? 'bg-primary/15 ring-1 ring-inset ring-primary/30' : isActive ? 'bg-primary/10 border-l-2 border-primary font-medium' : isPast ? 'text-muted-foreground/60' : 'hover:bg-muted/50'}`}
                  onClick={() => store.requestSeek(sub.startTime + store.subtitleOffset)}
                >
                  <span
                    className="text-xs text-muted-foreground mr-2 cursor-grab select-none"
                    title="按住上下拖动，可选多句循环"
                    onMouseDown={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                      hoverPauseRef.current = false
                      dragRef.current = { active: true, anchor: idx, current: idx }
                      setDragRange({ start: idx, end: idx })
                      cancelHover()
                    }}
                  >
                    {formatTime(sub.startTime)}
                  </span>
                  {sub.displayText.split(/(\s+)/).map((part, i) => {
                    const clean = part.replace(/[^a-zA-Z0-9\-']/g, '')
                    if (clean.length > 1)
                      return (
                        <span
                          key={i}
                          className={`${isSavedWord(part) ? savedWordMark + ' ' : ''}cursor-pointer hover:text-primary hover:underline`}
                          onMouseEnter={(e) => scheduleHover(part, sub.text, e.currentTarget)}
                          onMouseLeave={scheduleHideHover}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleWordClick(part, sub.text)
                          }}
                        >
                          {part}
                        </span>
                      )
                    return <span key={i}>{part}</span>
                  })}
                  {isActive && (
                    <button
                      className="ml-2 text-primary hover:text-primary/80"
                      onClick={(e) => {
                        e.stopPropagation()
                        speak(sub.displayText)
                      }}
                    >
                      <Speaker className="h-3 w-3 inline" />
                    </button>
                  )}
                  {isActive && (
                    <button
                      className="ml-1 text-primary hover:text-primary/80"
                      title="收藏当前句"
                      onClick={(e) => {
                        e.stopPropagation()
                        openFavorite(sub, hover?.sentence === sub.text ? hover.word : '')
                      }}
                    >
                      <Star className="h-3 w-3 inline" />
                    </button>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div className={`${isActive ? 'h-full' : 'hidden'}`}>
      <div className="h-full flex flex-col gap-4">
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
            <ArrowLeft className="h-4 w-4 mr-1" /> 返回列表
          </Button>
          <Button onClick={handleLoadSrt} variant="outline" size="sm">
            <Subtitles className="h-4 w-4 mr-1" /> 加载SRT字幕
          </Button>
          {store.filePath && (
            <span className="text-sm text-muted-foreground truncate max-w-[200px]">
              {store.filePath.split('/').pop()}
            </span>
          )}
        </div>

        {store.filePath ? (
          renderPlayer()
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-4">
            <p className="text-lg">打开一个文件开始播放</p>
            <p className="text-sm">前往「文件库」页面导入文件</p>
          </div>
        )}

        {hover && (
          <WordHoverCard
            word={hover.word}
            sentence={hover.sentence}
            anchor={hover.anchor}
            onMouseEnter={keepHover}
            onMouseLeave={scheduleHideHover}
            onAdded={loadWords}
          />
        )}

        {showLookup && selectedWord && (
          <WordLookupModal
            word={selectedWord}
            sentence={currentSentence}
            onClose={() => {
              setShowLookup(false)
              void loadWords()
            }}
          />
        )}

        {showTranscribeLangModal && store.filePath && (
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            onClick={() => setShowTranscribeLangModal(false)}
          >
            <Card className="w-80 p-6" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Globe className="h-5 w-5" /> 选择识别语言
              </h3>
              <div className="mb-1">
                <label className="text-sm font-medium">音频语言</label>
                <p className="text-xs text-muted-foreground mb-3">
                  指定音频语言可提高识别准确率，auto 为自动检测
                </p>
              </div>
              <select
                className="w-full bg-background border rounded px-3 py-2 text-sm mb-4"
                value={transcribeLang}
                onChange={(e) => setTranscribeLang(e.target.value)}
              >
                <option value="auto">自动检测</option>
                <option value="en">English</option>
                <option value="zh">中文</option>
                <option value="ja">日本語</option>
                <option value="ko">한국어</option>
                <option value="fr">Français</option>
                <option value="de">Deutsch</option>
                <option value="es">Español</option>
                <option value="ru">Русский</option>
              </select>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setShowTranscribeLangModal(false)}>
                  取消
                </Button>
                <Button
                  onClick={() => {
                    setShowTranscribeLangModal(false)
                    startTranscription(store.filePath!, transcribeLang)
                  }}
                >
                  开始转录
                </Button>
              </div>
            </Card>
          </div>
        )}

        {/* AI 选句操作浮层 */}
        {selPop && (
          <div
            data-ai-pop
            className="fixed z-40 -translate-x-1/2 -translate-y-full"
            style={{ left: selPop.x, top: selPop.y - 8 }}
          >
            <Card className="p-2 shadow-lg">
              <p className="text-xs text-muted-foreground max-w-[320px] line-clamp-2 mb-2 px-1">
                {selPop.text}
              </p>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={handleAITranslate}>
                  <Languages className="h-3.5 w-3.5 mr-1" /> 翻译
                </Button>
                <Button size="sm" onClick={handleAIExplain}>
                  <BookOpen className="h-3.5 w-3.5 mr-1" /> 详解
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelPop(null)}>
                  <XIcon className="h-3.5 w-3.5" />
                </Button>
              </div>
              {(aiTranslate || aiExplain?.loading) && (
                <div className="mt-2 px-1 max-w-[320px]">
                  {aiTranslate && (
                    <>
                      {aiTranslate.loading && !aiTranslate.text && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Loader2 className="h-3 w-3 animate-spin" /> 翻译中...
                        </span>
                      )}
                      {aiTranslate.text && (
                        <p className="text-sm leading-snug whitespace-pre-wrap">
                          {aiTranslate.text}
                        </p>
                      )}
                      {aiTranslate.error && (
                        <p className="text-xs text-destructive">{aiTranslate.error}</p>
                      )}
                    </>
                  )}
                  {aiExplain?.loading && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" /> 生成详解...
                    </span>
                  )}
                  {aiExplain?.error && (
                    <p className="text-xs text-destructive">{aiExplain.error}</p>
                  )}
                </div>
              )}
            </Card>
          </div>
        )}

        {/* AI 详解抽屉 */}
        {aiExplain?.data && (
          <div className="fixed inset-0 bg-black/40 z-50" onClick={() => setAiExplain(null)}>
            <div
              className="absolute right-0 top-0 h-full w-[420px] max-w-[92vw] bg-background border-l shadow-xl overflow-y-auto p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <Sparkles className="h-5 w-5" /> AI 详解
                </h3>
                <Button variant="ghost" size="sm" onClick={() => setAiExplain(null)}>
                  <XIcon className="h-4 w-4" />
                </Button>
              </div>
              {aiExplain.text && (
                <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
                  {aiExplain.text}
                </p>
              )}
              <div className="space-y-4">
                <section>
                  <h4 className="text-xs font-medium text-muted-foreground mb-1">译文</h4>
                  <p className="text-base leading-relaxed">{aiExplain.data.translation}</p>
                </section>
                {aiExplain.data.grammar && (
                  <section>
                    <h4 className="text-xs font-medium text-muted-foreground mb-1">语法结构</h4>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">
                      {aiExplain.data.grammar}
                    </p>
                  </section>
                )}
                {Array.isArray(aiExplain.data.keywords) && aiExplain.data.keywords.length > 0 && (
                  <section>
                    <h4 className="text-xs font-medium text-muted-foreground mb-1.5">关键词</h4>
                    <div className="space-y-2">
                      {aiExplain.data.keywords.map((k: any, i: number) => (
                        <div key={i} className="rounded border p-2">
                          <p className="text-sm font-medium">
                            {k.word}
                            <span className="text-muted-foreground font-normal">
                              {' '}
                              — {k.meaning}
                            </span>
                          </p>
                          {k.note && (
                            <p className="text-xs text-muted-foreground mt-0.5">{k.note}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                )}
                {aiExplain.data.context && (
                  <section>
                    <h4 className="text-xs font-medium text-muted-foreground mb-1">语境</h4>
                    <p className="text-sm leading-relaxed">{aiExplain.data.context}</p>
                  </section>
                )}
                {aiExplain.data.pitfalls && (
                  <section>
                    <h4 className="text-xs font-medium text-muted-foreground mb-1">易错点</h4>
                    <p className="text-sm leading-relaxed">{aiExplain.data.pitfalls}</p>
                  </section>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 收藏整句弹窗 */}
        {favTarget && (
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            onClick={() => setFavTarget(null)}
          >
            <Card className="w-96 p-6" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Star className="h-5 w-5" /> 收藏整句
              </h3>
              <p className="text-sm mb-1 line-clamp-3">{favTarget.text}</p>
              <p className="text-xs text-muted-foreground mb-4">
                {formatTime(favTarget.startTime)} - {formatTime(favTarget.endTime)}
              </p>
              <label className="text-sm font-medium">关联单词（可选）</label>
              <Input
                placeholder="例如素材中正在查的词"
                value={favWord}
                onChange={(e) => setFavWord(e.target.value)}
                className="mt-1 mb-3"
              />
              <label className="text-sm font-medium">标签</label>
              <select
                className="w-full bg-background border rounded px-3 py-2 text-sm mt-1 mb-3"
                value={favTagId}
                onChange={(e) => setFavTagId(parseInt(e.target.value))}
              >
                <option value={0}>无标签</option>
                {favTags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <Input
                placeholder="或输入新标签名称"
                value={favNewTag}
                onChange={(e) => setFavNewTag(e.target.value)}
                className="mb-4"
              />
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setFavTarget(null)}>
                  取消
                </Button>
                <Button onClick={saveFavorite}>收藏</Button>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}
