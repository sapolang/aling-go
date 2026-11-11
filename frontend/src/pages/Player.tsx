import { useState, useRef, useEffect, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { usePlayerStore } from '@/stores/playerStore'
import { useWordStore } from '@/stores/wordStore'
import type { LibraryFile } from '@/stores/libraryStore'
import type { SubtitleItem } from '@/types/electron'
import type { SubtitleDisplayMode } from '@/stores/playerStore'
import { useThemeStore } from '@/stores/themeStore'
import {
  SHORTCUT_ACTIONS,
  SHORTCUT_GROUP_LABELS,
  SHORTCUT_GROUP_ORDER,
  findActionForEvent,
  formatBinding,
  useShortcutStore,
} from '@/stores/shortcutStore'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { showToast } from '@/components/feedback'
import { PlayerHud, showPlayerHud } from '@/components/PlayerHud'
import { basename } from '@/utils/path'
import { speak } from '@/lib/tts'
import { Window } from '@wailsio/runtime'
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
  Keyboard,
} from 'lucide-react'
import SrtParser from 'srt-parser-2'
import { timeToSeconds } from '@/lib/srt'

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]

// 长按时允许连续触发的动作；切换类动作忽略系统按键重复，避免反复开关
const REPEATABLE_SHORTCUTS = new Set<string>([
  'seekBack',
  'seekForward',
  'seekBackFine',
  'seekForwardFine',
  'volumeUp',
  'volumeDown',
  'offsetMinus',
  'offsetPlus',
  'offsetMinusCoarse',
  'offsetPlusCoarse',
  'fontSizeUp',
  'fontSizeDown',
])

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
  const shortcutBindings = useShortcutStore((s) => s.bindings)
  const dark = useThemeStore((s) => s.dark)
  const [selectedWord, setSelectedWord] = useState('')
  const [currentSentence, setCurrentSentence] = useState('')
  const [hover, setHover] = useState<{ word: string; sentence: string; anchor: DOMRect } | null>(
    null,
  )
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoverHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showLookup, setShowLookup] = useState(false)
  const [showShortcutHelp, setShowShortcutHelp] = useState(false)
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

  // --- AI 当前句翻译 / 详解 ---
  // aiTarget 由播放控制栏的 AI 按钮显式触发，内容为当前字幕句
  const [aiTarget, setAiTarget] = useState<{ text: string; context: string } | null>(null)
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
      setAiTarget(null)
      showToast('请先在「设置 → AI 翻译」中填写 API Key', 'warning')
      navigate('/settings')
      return false
    }
    return true
  }

  const handleAITranslate = async () => {
    if (!aiTarget || !(await ensureAIConfig())) return
    const id = `t${++aiReqRef.current}`
    aiActiveReq.current = id
    setAiExplain(null)
    setAiTranslate({ reqId: id, text: '', loading: true })
    const r = await window.api.aiTranslateStream(aiTarget.text, aiTarget.context, id)
    if (r.error) {
      setAiTranslate((s) => (s ? { ...s, loading: false, error: r.error } : s))
      return
    }
    if (r.cached) setAiTranslate({ reqId: id, text: r.text, loading: false })
  }

  const handleAIExplain = async () => {
    if (!aiTarget || !(await ensureAIConfig())) return
    const target = aiTarget
    setAiTranslate(null)
    setAiExplain({ loading: true, text: target.text })
    const r = await window.api.aiExplain(target.text, target.context)
    if (!r.ok) {
      setAiExplain({ loading: false, error: r.error, text: target.text })
      return
    }
    setAiExplain({ loading: false, data: r.data, text: target.text })
    // 详解抽屉已展示完整内容，收起操作面板避免两者同时悬浮
    setAiTarget(null)
  }

  const isRemoteAudio = /^https?:\/\//i.test(store.filePath || '')
  const ext = store.filePath?.toLowerCase().match(/\.(\w+)$/)?.[1]
  const isAudio = isRemoteAudio || ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac'].includes(ext || '')

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
      showPlayerHud(`已循环第 ${start + 1}–${end + 1} 句`)
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
    // 时长兜底同步：loadedmetadata 未触发或时长后到时，保证波形等组件能拿到 duration
    if (!store.duration && el.duration) store.setDuration(el.duration)
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
      store.setPlayed(pc.startTime)
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
      // 立即同步 played，不等 timeupdate，避免波形/进度条停留在开头
      store.setPlayed(pos)
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
    if (store.playing) el.play().catch((e) => console.warn('play() 被拒绝:', e))
    else el.pause()
    el.playbackRate = store.playbackRate
  }, [store.playing, store.playbackRate])

  // --- 音量与静音偏好 ---
  useEffect(() => {
    const el = mediaRef.current
    if (!el) return
    el.volume = store.volume
    el.muted = store.muted
  }, [store.volume, store.muted, store.filePath])

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
    setAiTarget(null)
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
  // UI 状态用 ref 同步，避免每次播放/弹窗状态变化都重建监听器
  const aiTargetRef = useRef(aiTarget)
  const blockingModalRef = useRef(false)
  const closeTopLayerRef = useRef<() => boolean>(() => false)
  useEffect(() => {
    aiTargetRef.current = aiTarget
    blockingModalRef.current = !!(
      showShortcutHelp ||
      showLookup ||
      aiTarget ||
      aiTranslate ||
      aiExplain ||
      favTarget ||
      showTranscribeLangModal
    )
    closeTopLayerRef.current = () => {
      if (showShortcutHelp) {
        setShowShortcutHelp(false)
        return true
      }
      if (showLookup) {
        setShowLookup(false)
        return true
      }
      if (aiExplain) {
        setAiExplain(null)
        return true
      }
      if (aiTranslate) {
        setAiTranslate(null)
        return true
      }
      if (favTarget) {
        setFavTarget(null)
        return true
      }
      if (showTranscribeLangModal) {
        setShowTranscribeLangModal(false)
        return true
      }
      if (showSubMenu) {
        setShowSubMenu(false)
        return true
      }
      if (aiTarget) {
        setAiTarget(null)
        return true
      }
      return false
    }
  })

  useEffect(() => {
    if (!isActive) return

    const handleKey = (e: KeyboardEvent) => {
      // 屏蔽 Cmd/Ctrl 组合与输入法候选期间的按键
      if (e.metaKey || e.ctrlKey || e.isComposing) return
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }

      const action = findActionForEvent(useShortcutStore.getState().bindings, e)
      if (!action) return

      // 系统按键重复只允许用于连续型动作
      if (e.repeat && !REPEATABLE_SHORTCUTS.has(action)) {
        e.preventDefault()
        return
      }

      // Esc 始终按层级关闭浮层，不受弹窗拦截影响
      if (action === 'exit') {
        e.preventDefault()
        closeTopLayerRef.current()
        return
      }
      if (blockingModalRef.current) return

      e.preventDefault()

      if (action === 'help') {
        setShowShortcutHelp(true)
        return
      }

      const el = mediaRef.current
      const st = usePlayerStore.getState()
      if (!el || !st.filePath) return

      // 焦点在按钮/链接上时，Space 交给原生 click，避免重复触发
      if ((target?.tagName === 'BUTTON' || target?.tagName === 'A') && action === 'playPause') {
        return
      }

      const subs = st.subtitles
      const off = st.subtitleOffset
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
        const time = subs[i].startTime + off
        el.currentTime = time
        st.setPlayed(time)
        st.setPlaying(true)
      }
      const currentSubIndex = () => {
        const idx = curIdx >= 0 ? curIdx : lastBefore(t)
        return idx >= 0 && idx < subs.length ? idx : -1
      }
      // 单句循环对应的区间在切句后自动清除，避免用户被拉回原句
      const clearSentenceLoop = () => {
        const idx = currentSubIndex()
        const cur = subs[idx]
        if (cur && st.loopStart === cur.startTime + off && st.loopEnd === cur.endTime + off) {
          st.setLoop(null, null)
        }
      }

      switch (action) {
        case 'playPause':
          hoverPauseRef.current = false
          st.setPlaying(!st.playing)
          break
        case 'seekBack':
        case 'seekBackFine': {
          clearSentenceLoop()
          const delta = action === 'seekBack' ? 5 : 1
          const time = Math.max(0, el.currentTime - delta)
          el.currentTime = time
          st.setPlayed(time)
          break
        }
        case 'seekForward':
        case 'seekForwardFine': {
          clearSentenceLoop()
          const delta = action === 'seekForward' ? 5 : 1
          const time = Math.min(el.duration || 0, el.currentTime + delta)
          el.currentTime = time
          st.setPlayed(time)
          break
        }
        case 'rateCycle': {
          const next =
            PLAYBACK_RATES[(PLAYBACK_RATES.indexOf(st.playbackRate) + 1) % PLAYBACK_RATES.length]
          st.setPlaybackRate(next)
          showPlayerHud(`播放速度 ${next}x`)
          break
        }
        case 'volumeUp':
        case 'volumeDown': {
          st.adjustVolume(action === 'volumeUp' ? 0.1 : -0.1)
          const next = usePlayerStore.getState()
          showPlayerHud(next.muted ? '已静音' : `音量 ${Math.round(next.volume * 100)}%`)
          break
        }
        case 'mute':
          st.toggleMuted()
          showPlayerHud(st.muted ? '已取消静音' : '已静音')
          break
        case 'prevSentence': {
          const idx = currentSubIndex()
          if (idx <= 0) break
          clearSentenceLoop()
          seekToSub(idx - 1)
          break
        }
        case 'replaySentence': {
          const idx = currentSubIndex()
          if (idx < 0) break
          seekToSub(idx)
          break
        }
        case 'nextSentence': {
          const next = curIdx >= 0 ? curIdx + 1 : subs.findIndex((s) => s.startTime + off > t + 0.3)
          if (next < 0 || next >= subs.length) break
          clearSentenceLoop()
          seekToSub(next)
          break
        }
        case 'toggleSentenceLoop': {
          const idx = currentSubIndex()
          if (idx < 0) break
          const sub = subs[idx]
          const start = sub.startTime + off
          const end = sub.endTime + off
          if (st.loopStart === start && st.loopEnd === end) {
            st.setLoop(null, null)
            showPlayerHud('已关闭单句循环')
          } else {
            st.setLoop(start, end)
            showPlayerHud('单句循环：开')
          }
          break
        }
        case 'clearLoop':
          st.setLoop(null, null)
          showPlayerHud('已清除循环区间')
          break
        case 'toggleLoopAB':
          toggleLoopAB(el.currentTime)
          break
        case 'autoPause':
          st.setAutoPause(!st.autoPause)
          showPlayerHud(st.autoPause ? '已关闭自动暂停' : '已开启自动暂停')
          break
        case 'subtitleMode': {
          const modes: SubtitleDisplayMode[] = ['all', 'en', 'zh', 'off']
          const next = modes[(modes.indexOf(st.subtitleDisplayMode) + 1) % modes.length]
          st.setSubtitleDisplayMode(next)
          showPlayerHud(`字幕显示：${SUBTITLE_MODE_LABELS[next]}`)
          break
        }
        case 'translationToggle': {
          const next = st.subtitleDisplayMode === 'all' ? 'en' : 'all'
          st.setSubtitleDisplayMode(next)
          showPlayerHud(next === 'en' ? '已隐藏翻译' : '已显示翻译')
          break
        }
        case 'offsetMinus':
        case 'offsetPlus':
        case 'offsetMinusCoarse':
        case 'offsetPlusCoarse': {
          const delta =
            action === 'offsetMinus'
              ? -0.1
              : action === 'offsetPlus'
                ? 0.1
                : action === 'offsetMinusCoarse'
                  ? -1
                  : 1
          st.adjustSubtitleOffset(delta)
          showPlayerHud(`字幕偏移 ${usePlayerStore.getState().subtitleOffset.toFixed(1)}s`)
          break
        }
        case 'fontSizeUp':
        case 'fontSizeDown': {
          st.adjustSubtitleFontScale(action === 'fontSizeUp' ? 0.1 : -0.1)
          const scale = usePlayerStore.getState().subtitleFontScale
          showPlayerHud(`字幕字号 ${Math.round(scale * 100)}%`)
          break
        }
        case 'favoriteSentence': {
          const idx = currentSubIndex()
          if (idx < 0) {
            showPlayerHud('当前没有可收藏的字幕句', 'warning')
            break
          }
          const sub = subs[idx]
          setFavTarget({ startTime: sub.startTime, endTime: sub.endTime, text: sub.text })
          setFavWord('')
          setFavTagId(0)
          setFavNewTag('')
          window.api.favoriteTagsList().then(setFavTags)
          break
        }
        case 'aiSentence': {
          if (aiTargetRef.current) {
            setAiTarget(null)
            setAiTranslate(null)
            setAiExplain(null)
            break
          }
          const idx = currentSubIndex()
          if (idx < 0) {
            showPlayerHud('当前没有可操作的字幕句', 'warning')
            break
          }
          const sub = subs[idx]
          const en = filterSubtitleText(sub.text, 'en') || sub.text
          setAiTarget({ text: en, context: sub.text })
          setAiTranslate(null)
          setAiExplain(null)
          break
        }
        case 'speakSentence': {
          const idx = currentSubIndex()
          if (idx < 0) {
            showPlayerHud('当前没有可朗读的字幕句')
            break
          }
          const sub = subs[idx]
          speak(filterSubtitleText(sub.text, 'en') || sub.text)
          showPlayerHud('正在朗读当前句')
          break
        }
        case 'toggleFullscreen':
          void Window.IsFullscreen()
            .then(async (is) => {
              await Window.ToggleFullscreen()
              showPlayerHud(is ? '已退出全屏' : '已进入全屏')
            })
            .catch(() => showToast('全屏切换失败', 'warning'))
          break
        case 'podcastMode':
          st.setPodcastMode(!st.podcastMode)
          showPlayerHud(st.podcastMode ? '已退出播客模式' : '已进入播客模式')
          break
        case 'autoNextEpisode':
          st.setAutoNextEpisode(!st.autoNextEpisode)
          showPlayerHud(st.autoNextEpisode ? '已关闭自动下一集' : '已开启自动下一集')
          break
        case 'hoverPause':
          st.setHoverPause(!st.hoverPause)
          showPlayerHud(st.hoverPause ? '已关闭悬停暂停' : '已开启悬停暂停')
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isActive])

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
    const isPodcast = /^https?:\/\//i.test(filePath) && store.mediaEpisodeID > 0
    const force = store.subtitles.length > 0
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
    setTranscribingLabel(isPodcast ? '下载音频' : '转录中')
    const cleanup = window.api.onWhisperProgress((d: { progress: number; status: string }) => {
      store.setTranscriptionProgress(d.progress)
      if (d.status === 'downloading') setTranscribingLabel('下载音频')
      if (d.status === 'transcribing') setTranscribingLabel('转录中')
    })
    try {
      if (lang) {
        window.api.setWhisperLang(lang)
      }
      let subs: SubtitleItem[]
      if (isPodcast) {
        const result = await window.api.platformTranscribePodcast(store.mediaEpisodeID, force)
        if (!result.ok) throw new Error(result.error || '转录失败')
        subs = result.subtitles || []
      } else {
        subs = await window.api.whisperTranscribe(filePath)
        window.api.cacheSubtitles(filePath, subs)
      }
      if (subs.length === 0) {
        showToast('转录完成，但未识别到语音。请在设置页检查模型和语言设置是否正确', 'warning')
      }
      store.setSubtitles(subs)
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

  // A/B 循环设点三态切换：未设点 → 设 A 点 → 设 B 点开始循环 → 清除
  const toggleLoopAB = (now: number) => {
    const st = usePlayerStore.getState()
    if (st.loopStart === null) {
      st.setLoop(now, null)
      showPlayerHud(`已设 A 点 ${formatTime(now)}`)
    } else if (st.loopEnd === null) {
      if (now <= st.loopStart + 0.05) {
        showPlayerHud('B 点需在 A 点之后', 'warning')
        return
      }
      st.setLoop(st.loopStart, now)
      showPlayerHud(`A-B 循环 ${formatTime(st.loopStart)} - ${formatTime(now)}`)
    } else {
      st.setLoop(null, null)
      showPlayerHud('已清除循环')
    }
  }

  useEffect(() => {
    window.api.getMediaPort().then(setMediaPort)
  }, [])
  const mediaUrl = store.filePath
    ? isRemoteAudio
      ? store.filePath.startsWith('https://') || !store.mediaEpisodeID || !mediaPort
        ? store.filePath
        : `http://127.0.0.1:${mediaPort}/podcast-stream?id=${store.mediaEpisodeID}`
      : mediaPort
        ? `http://127.0.0.1:${mediaPort}/media/${encodeURIComponent(store.filePath)}`
        : ''
    : ''

  // 播放控制按钮组：视频时内嵌到画面底部，音频时放在播放器下方
  const renderTransportControls = () => (
    <div className="flex items-center justify-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        title="播放 / 暂停（Space）"
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
        className={
          store.loopStart === null ? '' : store.loopEnd === null ? 'text-amber-500' : 'text-primary'
        }
        title="A/B 循环设点（L）：设 A 点 → 设 B 点循环 → 清除"
        onClick={() => {
          toggleLoopAB(store.played)
          showPlayerControls()
        }}
      >
        <Repeat className="h-4 w-4" />
        {store.loopStart !== null && (
          <span className="ml-0.5 text-[10px] font-semibold leading-none">
            {store.loopEnd === null ? 'A-' : 'A-B'}
          </span>
        )}
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
              title="设置 B 点"
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
        title="播客模式（V）"
      >
        <Headphones className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className={store.autoNextEpisode ? 'text-primary' : ''}
        title={store.autoNextEpisode ? '自动下一集：开（N）' : '自动下一集：关（N）'}
        onClick={() => store.setAutoNextEpisode(!store.autoNextEpisode)}
      >
        <SkipForward className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className={store.autoPause ? 'text-primary' : ''}
        title={store.autoPause ? '播完本句自动暂停：开（Q）' : '播完本句自动暂停：关（Q）'}
        onClick={() => store.setAutoPause(!store.autoPause)}
      >
        <CirclePause className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={store.currentSubtitleIndex < 0}
        className={aiTarget ? 'text-primary' : ''}
        title="AI 翻译/详解当前句（T）"
        onClick={() => {
          if (aiTarget) {
            setAiTarget(null)
            return
          }
          const cur = store.subtitles[store.currentSubtitleIndex]
          if (!cur) return
          // 详解/翻译对象为当前句英文部分，上下文保留完整句
          const en = filterSubtitleText(cur.text, 'en') || cur.text
          setAiTarget({ text: en, context: cur.text })
          setAiTranslate(null)
          setAiExplain(null)
        }}
      >
        <Sparkles className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        title="快捷键帮助（?）"
        onClick={() => setShowShortcutHelp(true)}
      >
        <Keyboard className="h-4 w-4" />
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
                    <span
                      className="bg-black/70 text-white px-4 py-2 rounded text-center max-w-[90%] leading-relaxed whitespace-pre-line"
                      style={{ fontSize: `${1.875 * store.subtitleFontScale}rem` }}
                    >
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

          <PlayerHud />

          {!isAudio && store.filePath && !store.podcastMode && (
            <div
              className={`absolute inset-x-0 bottom-0 px-2 pb-2 pt-10 bg-gradient-to-t from-black/85 via-black/40 to-transparent transition-opacity duration-200 ${videoControlsShown ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-center gap-2 [&_button]:text-white [&_button:hover]:bg-white/10 [&_button:hover]:text-white [&_select]:bg-black/40 [&_select]:text-white [&_select]:border-white/30">
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
              {store.mediaTitle || basename(store.filePath)}
            </div>
            {(() => {
              const pa = store.played - store.subtitleOffset
              const sub = store.subtitles.find((s) => pa >= s.startTime - 0.08 && pa <= s.endTime)
              return sub ? (
                <div
                  className="text-2xl font-medium text-center max-w-[85%] leading-relaxed whitespace-pre-line"
                  style={{ fontSize: `${1.5 * store.subtitleFontScale}rem` }}
                >
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
              loopStart={store.loopStart !== null ? store.loopStart - store.subtitleOffset : null}
              loopEnd={store.loopEnd !== null ? store.loopEnd - store.subtitleOffset : null}
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
        className="w-full lg:w-2/5 lg:min-w-96 lg:max-w-[600px] border rounded-lg bg-card flex flex-col"
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
                    <div className="text-xs text-muted-foreground mb-1" title="快捷键 E 循环切换">
                      显示模式
                    </div>
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
                      title="悬停查词时暂停（H）"
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
                  style={{ fontSize: `${1.125 * store.subtitleFontScale}rem` }}
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
                      title="收藏当前句（F）"
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
              {store.mediaTitle || basename(store.filePath)}
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

        <Dialog
          open={showTranscribeLangModal && !!store.filePath}
          onOpenChange={(open) => !open && setShowTranscribeLangModal(false)}
        >
          <DialogContent className="max-w-xs">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5" /> 选择识别语言
              </DialogTitle>
            </DialogHeader>
            <div>
              <label className="text-sm font-medium">音频语言</label>
              <p className="text-xs text-muted-foreground mt-1 mb-3">
                指定音频语言可提高识别准确率，auto 为自动检测
              </p>
            </div>
            <select
              className="w-full bg-background border rounded px-3 py-2 text-sm"
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
            <DialogFooter>
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
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* AI 当前句翻译/详解面板（由控制栏 Sparkles 按钮触发） */}
        {aiTarget && (
          <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-40">
            <Card className="p-2 shadow-lg">
              <p className="text-xs text-muted-foreground max-w-[320px] line-clamp-2 mb-2 px-1">
                {aiTarget.text}
              </p>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={handleAITranslate}>
                  <Languages className="h-3.5 w-3.5 mr-1" /> 翻译
                </Button>
                <Button size="sm" onClick={handleAIExplain}>
                  <BookOpen className="h-3.5 w-3.5 mr-1" /> 详解
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAiTarget(null)}>
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
          <Dialog open onOpenChange={(open) => !open && setAiExplain(null)}>
            <DialogContent className="left-auto right-0 top-0 block h-full w-[420px] max-w-[92vw] translate-x-0 translate-y-0 gap-0 overflow-y-auto rounded-none border-0 border-l p-5 shadow-xl sm:rounded-none data-[state=open]:animate-none data-[state=closed]:animate-none">
              <DialogHeader className="mb-3">
                <DialogTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5" /> AI 详解
                </DialogTitle>
              </DialogHeader>
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
            </DialogContent>
          </Dialog>
        )}

        {/* 快捷键帮助面板 */}
        {showShortcutHelp && (
          <Dialog open onOpenChange={(open) => !open && setShowShortcutHelp(false)}>
            <DialogContent className="max-w-2xl max-h-[80vh] gap-0 overflow-y-auto">
              <DialogHeader className="mb-4">
                <DialogTitle className="flex items-center gap-2">
                  <Keyboard className="h-5 w-5" /> 播放器快捷键
                </DialogTitle>
              </DialogHeader>
              <div className="grid gap-5 sm:grid-cols-2">
                {SHORTCUT_GROUP_ORDER.map((group) => {
                  const actions = SHORTCUT_ACTIONS.filter((action) => action.group === group)
                  if (actions.length === 0) return null
                  return (
                    <div key={group}>
                      <h4 className="text-xs font-medium text-muted-foreground mb-2">
                        {SHORTCUT_GROUP_LABELS[group]}
                      </h4>
                      <div className="space-y-1.5">
                        {actions.map((action) => {
                          const binding = shortcutBindings[action.id]
                          return (
                            <div
                              key={action.id}
                              className="flex items-center justify-between gap-3 text-sm"
                            >
                              <span className="text-muted-foreground">{action.label}</span>
                              <kbd className="inline-flex min-w-[2.5rem] shrink-0 items-center justify-center rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">
                                {binding ? formatBinding(binding) : '未设置'}
                              </kbd>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
              <p className="mt-5 text-xs text-muted-foreground">
                快捷键仅在播放页生效；输入框聚焦时自动停用，Esc 按层级关闭浮层。
              </p>
            </DialogContent>
          </Dialog>
        )}

        {/* 收藏整句弹窗 */}
        {favTarget && (
          <Dialog open onOpenChange={(open) => !open && setFavTarget(null)}>
            <DialogContent className="max-w-sm gap-0">
              <DialogHeader className="mb-4">
                <DialogTitle className="flex items-center gap-2">
                  <Star className="h-5 w-5" /> 收藏整句
                </DialogTitle>
              </DialogHeader>
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
            </DialogContent>
          </Dialog>
        )}
      </div>
    </div>
  )
}
