import { useState, useRef, useEffect, useMemo, type CSSProperties, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { usePlayerStore } from '@/stores/playerStore'
import { useThemeStore } from '@/stores/themeStore'
import { useWordStore } from '@/stores/wordStore'
import type { LibraryFile } from '@/stores/libraryStore'
import type { PlatformSubtitleCue, PlatformSubtitleResult, SubtitleItem } from '@/types/electron'
import type { SubtitleDisplayMode } from '@/stores/playerStore'
import {
  SHORTCUT_ACTIONS,
  SHORTCUT_GROUP_LABELS,
  SHORTCUT_GROUP_ORDER,
  findActionForEvent,
  formatBinding,
  useShortcutStore,
} from '@/stores/shortcutStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { showToast } from '@/components/feedback'
import { PlayerHud, showPlayerHud } from '@/components/PlayerHud'
import { basename } from '@/utils/path'
import { speak } from '@/lib/tts'
import { Window } from '@wailsio/runtime'
import Waveform from '@/components/Waveform'
import { useYouTubeEngine } from '@/hooks/useYouTubeEngine'
import WordLookupModal from '@/components/WordLookupModal'
import WordHoverCard from '@/components/WordHoverCard'
import SubtitleList, { type SubtitleListHandle } from '@/components/SubtitleList'
import { findCueIndexAt, formatClockTime as formatTime } from '@/lib/subtitles'
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
  VolumeX,
  MoreHorizontal,
  Download,
  RotateCcw,
  X as XIcon,
  FileDown,
  ArrowLeft,
  Star,
  Headphones,
  Sparkles,
  Languages,
  BookOpen,
  Keyboard,
  ChevronLeft,
  ChevronRight,
  Rewind,
  FastForward,
  AudioLines,
  Captions,
} from 'lucide-react'
import SrtParser from 'srt-parser-2'
import { timeToSeconds } from '@/lib/srt'
import './Player.css'

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]

// 播放历史的来源类型：由播放源与是否关联播客节目推导
function historyKindOf(sourceKind: string, episodeID: number): string {
  if (sourceKind === 'youtube') return 'youtube'
  if (sourceKind === 'bilibili') return 'bilibili'
  return episodeID > 0 ? 'podcast' : 'local'
}

// B站代理播放地址每次会话都会变，历史 key 优先用调用方传入的稳定标识
function historyKeyOf(state: { filePath: string | null; historyKey: string }): string {
  return state.historyKey || state.filePath || ''
}

// 纯音频扩展名：决定用音频 deck 还是视频舞台渲染
const AUDIO_EXTS = [
  'mp3',
  'wav',
  'm4a',
  'm4b',
  'ogg',
  'oga',
  'opus',
  'flac',
  'aac',
  'wma',
  'aiff',
  'aif',
  'caf',
  'ape',
  'wv',
  'mka',
  'amr',
]

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

// 播放页来源页面名称，用于返回按钮的可读提示
const ROUTE_LABELS: Record<string, string> = {
  '/': '文件库',
  '/podcast': '播客订阅',
  '/favorites': '收藏片段',
  '/words': '生词库',
  '/dict': '词库浏览',
  '/card': '今日复习',
  '/stats': '学习统计',
  '/articles': '文章打字',
  '/settings': '设置',
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

// 有字幕时靠边展示，无字幕时复用为中央主视觉
function DeckOrbit({ playing }: { playing: boolean }) {
  return (
    <div className="pp-deck-orbit" aria-hidden="true">
      <span className="pp-orbit-ring" />
      <span className="pp-orbit-ring" />
      <span className="pp-orbit-ring" />
      {playing && (
        <>
          <span className="pp-pulse" />
          <span className="pp-pulse pp-pulse--2" />
        </>
      )}
      <span className="pp-orbit-bars">
        <span />
        <span />
        <span />
        <span />
        <span />
      </span>
    </div>
  )
}

// 播放控制栏图标按钮：统一 hover / active / disabled 视觉
function PPIconButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className={`pp-icon-btn ${active ? 'is-active' : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export default function PlayerPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const isActive = location.pathname === '/player'
  // 返回目标：进入播放页时记录的来源页面，直接打开播放页时退回文件库
  const fromPath = (location.state as { from?: string } | null)?.from
  const backTarget = fromPath && fromPath !== '/player' ? fromPath : '/'
  const backLabel =
    ROUTE_LABELS[backTarget] ||
    ROUTE_LABELS[backTarget.split('/').slice(0, 2).join('/')] ||
    '上一页'
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement>(null)
  const subtitleListRef = useRef<SubtitleListHandle>(null)
  const store = usePlayerStore()
  const themeDark = useThemeStore((s) => s.dark)
  const shortcutBindings = useShortcutStore((s) => s.bindings)
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
  // 原生媒体实际进入 playing 的文件，用于让声纹与真实出声状态一致
  const [activeMediaPath, setActiveMediaPath] = useState<string | null>(null)
  // 格式兜底：内置播放器解不了的容器转成可播文件后，只替换媒体源，filePath 仍是原文件。
  // 带上来源文件，切走再切回时不用额外重置状态
  const [fallback, setFallback] = useState<{ file: string; path: string } | null>(null)
  const [convertingFile, setConvertingFile] = useState<string | null>(null)
  const fallbackPath = fallback && fallback.file === store.filePath ? fallback.path : null
  const converting = convertingFile !== null && convertingFile === store.filePath
  // 同一个文件只尝试转码一次，避免转码结果也播不了时反复重试
  const fallbackTriedRef = useRef<string | null>(null)
  // 转码期间丢失的播放位置，转码完成后从这里续播
  const fallbackResumeRef = useRef<{ file: string; time: number } | null>(null)

  // YouTube 源：iframe 通过 /yt-embed 中转页播放，时间轴由 postMessage 回写 store
  const youtubeId = store.sourceKind === 'youtube' ? (store.filePath || '').replace(/^yt:/, '') : ''
  const isYouTube = store.sourceKind === 'youtube' && !!youtubeId
  const { iframeRef: ytIframeRef, embedUrl: ytEmbedUrl } = useYouTubeEngine(
    isYouTube,
    youtubeId,
    mediaPort,
  )
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
  // 入口显式声明媒体形态时优先使用，避免 B站 代理地址被当成远程音频
  const isAudio =
    store.mediaKind !== null
      ? store.mediaKind === 'audio'
      : isRemoteAudio || AUDIO_EXTS.includes(ext || '')

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

  // --- 播放历史 ---
  const historyKey = historyKeyOf(store)

  // 打开新媒体时写一条历史：元信息由发起播放的页面通过 setFilePath 传入
  useEffect(() => {
    if (!historyKey) return
    const st = usePlayerStore.getState()
    window.api.historyUpsert({
      mediaKey: historyKey,
      kind: historyKindOf(st.sourceKind, st.mediaEpisodeID),
      title: st.mediaTitle || basename(st.filePath || ''),
      cover: st.historyCover,
      sourceUrl: st.historySourceUrl,
      episodeId: st.mediaEpisodeID,
      position: 0,
      duration: 0,
      playCount: 0,
      lastPlayedAt: '',
    })
  }, [historyKey])

  // 播放中每 5 秒落一次进度：YouTube/B站 没有原生 timeupdate，统一读 store
  useEffect(() => {
    if (!historyKey) return
    const timer = window.setInterval(() => {
      const st = usePlayerStore.getState()
      if (!st.playing) return
      window.api.historyUpdatePosition(historyKey, st.played, st.duration)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [historyKey])

  // 暂停或播完时立即落一次，避免最后几秒进度丢失
  const wasPlayingRef = useRef(false)
  useEffect(() => {
    const was = wasPlayingRef.current
    wasPlayingRef.current = store.playing
    if (!was || store.playing || !historyKey) return
    // 切换文件时 store 已重置，duration 为 0，不能把新文件的进度写成 0
    if (store.duration <= 0 || store.played <= 0) return
    window.api.historyUpdatePosition(historyKey, store.played, store.duration)
  }, [store.playing, store.played, store.duration, historyKey])

  onTimeUpdateRef.current = () => {
    const el = mediaRef.current
    if (!el) return
    // 时长兜底同步：loadedmetadata 未触发或时长后到时，保证波形等组件能拿到 duration
    if (!store.duration && el.duration) store.setDuration(el.duration)
    store.setPlayed(el.currentTime)
    store.setPlaying(!el.paused)
    // 字幕匹配使用偏移后的时间：offset>0 表示字幕整体延后
    const t = el.currentTime - store.subtitleOffset
    const idx = findCueIndexAt(store.subtitles, t)
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
    // 转码完成后接着原来的位置播，不再走「续播上次位置」的判定
    const resume = fallbackResumeRef.current
    if (resume && resume.file === store.filePath && fallbackPath) {
      fallbackResumeRef.current = null
      el.currentTime = resume.time
      store.setPlayed(resume.time)
      if (usePlayerStore.getState().playing) {
        el.play().catch(() => {})
      }
      return
    }
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
    // 打开文件后续播上次位置：历史优先，媒体库里的 LastPosition 兜底
    if (resumedForRef.current === fp) return
    resumedForRef.current = fp
    lastPosSaveRef.current = 0
    const resumeKey = historyKeyOf(usePlayerStore.getState())
    const applyResume = (pos: number) => {
      if (!pos || pos <= 0) return
      const dur = el.duration || 0
      const remaining = dur - pos
      if (dur > 0 && (remaining < 15 || remaining / dur < 0.05)) {
        window.api.recentUpdatePosition(fp, 0)
        window.api.historyUpdatePosition(resumeKey, 0, dur)
        return
      }
      el.currentTime = pos
      lastPosSaveRef.current = pos
      // 立即同步 played，不等 timeupdate，避免波形/进度条停留在开头
      store.setPlayed(pos)
    }
    window.api
      .historyGet(resumeKey)
      .then((h: { position?: number } | null) =>
        h && h.position && h.position > 0 ? h.position : window.api.recentGetPosition(fp),
      )
      .then(applyResume)
      .catch(() => applyResume(0))
  }

  // --- Media element event wiring ---
  useEffect(() => {
    const el = mediaRef.current
    if (!el) return
    const onTime = () => onTimeUpdateRef.current()
    const onMeta = () => onMetaRef.current()
    const onPlaying = () => {
      setActiveMediaPath(store.filePath)
      setPlayError(null)
      store.setPlaying(true)
    }
    const onPlaybackHalted = () => setActiveMediaPath(null)
    const onEnded = () => {
      setActiveMediaPath(null)
      store.setPlaying(false)
      const st = usePlayerStore.getState()
      const endedPath = st.filePath
      if (!st.autoNextEpisode || !endedPath) return
      findNextEpisode(endedPath).then((next) => {
        // 等待期间用户可能已手动切换文件
        if (next && usePlayerStore.getState().filePath === endedPath) openMediaFile(next)
      })
    }
    const onError = () => {
      setActiveMediaPath(null)
      const st = usePlayerStore.getState()
      const failedPath = st.filePath
      const el = mediaRef.current
      const isLocalFile =
        !!failedPath && st.sourceKind === 'html5' && !/^https?:\/\//i.test(failedPath)
      // code 4 = MEDIA_ERR_SRC_NOT_SUPPORTED，说明是容器/编码解不了，试一次转码兜底
      if (isLocalFile && el?.error?.code === 4 && fallbackTriedRef.current !== failedPath) {
        fallbackTriedRef.current = failedPath
        fallbackResumeRef.current = { file: failedPath, time: el?.currentTime ?? 0 }
        setPlayError(null)
        setConvertingFile(failedPath)
        window.api
          .transcodeForPlayback(failedPath)
          .then((out: string) => {
            if (usePlayerStore.getState().filePath !== failedPath) return
            setFallback({ file: failedPath, path: out })
            showPlayerHud('已转换为可播格式')
          })
          .catch((e: unknown) => {
            if (usePlayerStore.getState().filePath !== failedPath) return
            fallbackResumeRef.current = null
            setPlayError(e instanceof Error ? e.message : String(e))
          })
          .finally(() => setConvertingFile(null))
        return
      }
      setPlayError('媒体加载失败')
    }
    el.addEventListener('timeupdate', onTime)
    el.addEventListener('loadedmetadata', onMeta)
    el.addEventListener('playing', onPlaying)
    el.addEventListener('pause', onPlaybackHalted)
    el.addEventListener('waiting', onPlaybackHalted)
    el.addEventListener('ended', onEnded)
    el.addEventListener('error', onError)
    if (el.duration) onMetaRef.current()
    if (!el.paused && el.readyState >= 3) onPlaying()
    return () => {
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('loadedmetadata', onMeta)
      el.removeEventListener('playing', onPlaying)
      el.removeEventListener('pause', onPlaybackHalted)
      el.removeEventListener('waiting', onPlaybackHalted)
      el.removeEventListener('ended', onEnded)
      el.removeEventListener('error', onError)
    }
  }, [store.filePath])

  // --- Auto play on file open ---
  useEffect(() => {
    // 立即发起播放请求，不再等 canplay；实际出声由 playing 事件驱动声纹
    if (!store.filePath || !mediaRef.current) return
    store.setPlaying(true)
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
    prevSubIdxRef.current = -1
    lastTickTimeRef.current = 0
    hoverPauseRef.current = false
    setAutoFollow(true)
    setAiTarget(null)
  }, [store.filePath, store.subtitles])

  // 回到当前句并恢复自动跟随
  const resumeFollow = () => {
    setAutoFollow(true)
    subtitleListRef.current?.scrollToCurrent()
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
      favTarget
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
      if (!st.filePath) return
      // YouTube 源没有原生媒体元素，时间读取与跳转都走 store
      const readTime = () => (el ? el.currentTime : st.played)
      const applySeek = (time: number) => {
        if (el) el.currentTime = time
        else st.requestSeek(time)
        st.setPlayed(time)
      }

      // 焦点在按钮/链接上时，Space 交给原生 click，避免重复触发
      if ((target?.tagName === 'BUTTON' || target?.tagName === 'A') && action === 'playPause') {
        return
      }

      const subs = st.subtitles
      const off = st.subtitleOffset
      const t = readTime() - off
      const curIdx = findCueIndexAt(subs, t)
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
        applySeek(time)
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
          const time = Math.max(0, readTime() - delta)
          applySeek(time)
          break
        }
        case 'seekForward':
        case 'seekForwardFine': {
          clearSentenceLoop()
          const delta = action === 'seekForward' ? 5 : 1
          const time = Math.min(el?.duration || st.duration || 0, readTime() + delta)
          applySeek(time)
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
          // YouTube 源没有原生媒体元素，用 store 里回写的播放时间
          toggleLoopAB(el ? el.currentTime : usePlayerStore.getState().played)
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
        case 'focusMode':
          st.setFocusMode(!st.focusMode)
          showPlayerHud(st.focusMode ? '已退出专注模式' : '已进入专注模式')
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

  const startTranscription = async (filePath: string) => {
    // 在线视频走平台接口：已订阅节目按 episodeID 取，粘贴链接播放的按平台视频 ID 取
    const platformVideo = store.sourceKind === 'youtube' || store.sourceKind === 'bilibili'
    const isPodcast = !platformVideo && store.mediaEpisodeID > 0 && /^https?:\/\//i.test(filePath)
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
    setTranscribingLabel(isPodcast || platformVideo ? '下载音频' : '转录中')
    const cleanup = window.api.onWhisperProgress((d: { progress: number; status: string }) => {
      store.setTranscriptionProgress(d.progress)
      if (d.status === 'downloading') setTranscribingLabel('下载音频')
      if (d.status === 'transcribing') setTranscribingLabel('转录中')
    })
    try {
      let subs: SubtitleItem[]
      if (platformVideo) {
        // 平台接口会先抓官方字幕，抓不到再下载音轨做本地转录
        const result = (
          store.mediaEpisodeID > 0
            ? await window.api.platformGetSubtitles(store.mediaEpisodeID)
            : await window.api.platformGetSubtitlesBySource(
                store.sourceKind,
                historyKeyOf(store).replace(/^(yt:|bili:)/, ''),
              )
        ) as PlatformSubtitleResult
        if (!result.ok) throw new Error(result.error || '转录失败')
        subs = (result.cues || []).map((c: PlatformSubtitleCue, i: number) => ({
          id: i,
          startTime: c.start,
          endTime: c.end,
          text: c.text,
        }))
      } else if (isPodcast) {
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
    if (store.filePath) startTranscription(store.filePath)
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

  // 字幕列表拖选：只维护拖选状态，实际循环区间在松开时结算
  const handleCueDragStart = (idx: number) => {
    hoverPauseRef.current = false
    dragRef.current = { active: true, anchor: idx, current: idx }
    setDragRange({ start: idx, end: idx })
    cancelHover()
  }

  const handleCueDragHover = (idx: number) => {
    if (!dragRef.current.active) return
    dragRef.current.current = idx
    const anchor = dragRef.current.anchor
    setDragRange({ start: Math.min(anchor, idx), end: Math.max(anchor, idx) })
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
    ? store.sourceKind === 'youtube'
      ? ''
      : store.sourceKind === 'bilibili'
        ? store.filePath
        : isRemoteAudio
          ? store.filePath.startsWith('https://') || !store.mediaEpisodeID || !mediaPort
            ? store.filePath
            : `http://127.0.0.1:${mediaPort}/podcast-stream?id=${store.mediaEpisodeID}`
          : mediaPort
            ? `http://127.0.0.1:${mediaPort}/media/${encodeURIComponent(fallbackPath || store.filePath)}`
            : ''
    : ''

  // 当前句：统一从播放时间派生，视频字幕、音频 deck 和翻译都复用
  const activeSub = useMemo(() => {
    const t = store.played - store.subtitleOffset
    const idx = findCueIndexAt(store.subtitles, t)
    return idx >= 0 ? store.subtitles[idx] : null
  }, [store.played, store.subtitleOffset, store.subtitles])

  const progressPct = store.duration > 0 ? Math.min(100, (store.played / store.duration) * 100) : 0

  const togglePlay = () => {
    hoverPauseRef.current = false
    store.setPlaying(!store.playing)
    showPlayerControls()
  }

  const nudge = (delta: number) => {
    const el = mediaRef.current
    const base = el ? el.currentTime : store.played
    const time = Math.max(0, Math.min(el?.duration || store.duration || 0, base + delta))
    if (el) el.currentTime = time
    else store.requestSeek(time)
    store.setPlayed(time)
    store.setPlaying(true)
  }

  const cycleRate = () => {
    const next =
      PLAYBACK_RATES[(PLAYBACK_RATES.indexOf(store.playbackRate) + 1) % PLAYBACK_RATES.length]
    store.setPlaybackRate(next)
    showPlayerHud(`播放速度 ${next}x`)
  }

  const seekSentence = (dir: -1 | 1) => {
    const el = mediaRef.current
    const subs = store.subtitles
    if (subs.length === 0) return
    const off = store.subtitleOffset
    const t = (el ? el.currentTime : store.played) - off
    const cur = findCueIndexAt(subs, t)
    let target = -1
    if (dir === 1) {
      target = cur >= 0 ? cur + 1 : subs.findIndex((s) => s.startTime + off > t + 0.3)
    } else if (cur > 0) {
      target = cur - 1
    } else if (cur === 0) {
      target = 0
    } else {
      for (let i = subs.length - 1; i >= 0; i--) {
        if (subs[i].startTime + off <= t + 0.3) {
          target = i
          break
        }
      }
    }
    if (target < 0 || target >= subs.length) return
    const time = subs[target].startTime + off
    if (el) el.currentTime = time
    else store.requestSeek(time)
    store.setPlayed(time)
    store.setPlaying(true)
  }

  // 字幕分词：视频浮层、音频 deck、字幕列表共用同一套悬停查词交互
  const renderWords = (text: string, sentence: string, keyPrefix: string) =>
    text.split(/(\s+)/).map((part, i) => {
      const clean = part.replace(/[^a-zA-Z0-9\-']/g, '')
      if (clean.length > 1) {
        return (
          <span
            key={`${keyPrefix}-${i}`}
            className={`pp-word ${isSavedWord(part) ? 'pp-word--saved' : ''}`}
            onMouseEnter={(e) => scheduleHover(part, sentence, e.currentTarget)}
            onMouseLeave={scheduleHideHover}
            onClick={(e) => {
              e.stopPropagation()
              handleWordClick(part, sentence)
            }}
          >
            {part}
          </span>
        )
      }
      return <span key={`${keyPrefix}-${i}`}>{part}</span>
    })

  // 播放控制按钮组：视频时内嵌到画面底部，音频时放在 deck 下方
  const renderTransportControls = (variant: 'video' | 'dock' = 'dock') => {
    const isVideo = variant === 'video'
    return (
      <div className={`pp-transport ${isVideo ? 'pp-transport--video' : ''}`}>
        <PPIconButton
          label="上一句（↑）"
          disabled={store.subtitles.length === 0}
          onClick={() => seekSentence(-1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </PPIconButton>
        <PPIconButton label="后退 5 秒（←）" onClick={() => nudge(-5)}>
          <Rewind className="h-4 w-4" />
        </PPIconButton>
        <button
          type="button"
          className={`pp-play ${isVideo ? 'pp-play--sm' : ''}`}
          title="播放 / 暂停（Space）"
          onClick={togglePlay}
        >
          {store.playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
        </button>
        <PPIconButton label="前进 5 秒（→）" onClick={() => nudge(5)}>
          <FastForward className="h-4 w-4" />
        </PPIconButton>
        <PPIconButton
          label="下一句（↓）"
          disabled={store.subtitles.length === 0}
          onClick={() => seekSentence(1)}
        >
          <ChevronRight className="h-4 w-4" />
        </PPIconButton>
        <button type="button" className="pp-rate" title="播放速度（P）" onClick={cycleRate}>
          {store.playbackRate}x
        </button>
        <PPIconButton
          label="A/B 循环设点（L）"
          active={store.loopStart !== null}
          onClick={() => {
            toggleLoopAB(store.played)
            showPlayerControls()
          }}
        >
          <Repeat className="h-4 w-4" />
        </PPIconButton>
        {!isVideo && (
          <>
            <PPIconButton
              label={store.autoPause ? '播完本句自动暂停：开（Q）' : '播完本句自动暂停：关（Q）'}
              active={store.autoPause}
              onClick={() => {
                store.setAutoPause(!store.autoPause)
                showPlayerHud(store.autoPause ? '已关闭自动暂停' : '已开启自动暂停')
              }}
            >
              <CirclePause className="h-4 w-4" />
            </PPIconButton>
            <PPIconButton
              label={store.autoNextEpisode ? '自动下一集：开（N）' : '自动下一集：关（N）'}
              active={store.autoNextEpisode}
              onClick={() => {
                store.setAutoNextEpisode(!store.autoNextEpisode)
                showPlayerHud(store.autoNextEpisode ? '已关闭自动下一集' : '已开启自动下一集')
              }}
            >
              <SkipForward className="h-4 w-4" />
            </PPIconButton>
            <PPIconButton
              label="专注模式（V）"
              active={store.focusMode}
              onClick={() => {
                store.setFocusMode(!store.focusMode)
                showPlayerHud(store.focusMode ? '已退出专注模式' : '已进入专注模式')
              }}
            >
              <Headphones className="h-4 w-4" />
            </PPIconButton>
          </>
        )}
        <PPIconButton
          label="AI 翻译 / 详解当前句（T）"
          active={!!aiTarget}
          disabled={store.currentSubtitleIndex < 0}
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
        </PPIconButton>
        <PPIconButton
          label={store.muted ? '取消静音（M）' : '静音（M）'}
          onClick={() => {
            store.toggleMuted()
            showPlayerHud(store.muted ? '已取消静音' : '已静音')
          }}
        >
          {store.muted ? <VolumeX className="h-4 w-4" /> : <Speaker className="h-4 w-4" />}
        </PPIconButton>
        {!isVideo && (
          <PPIconButton label="快捷键帮助（?）" onClick={() => setShowShortcutHelp(true)}>
            <Keyboard className="h-4 w-4" />
          </PPIconButton>
        )}
        {store.loopStart !== null && (
          <span className="pp-loop-readout">
            A {formatTime(store.loopStart)}
            {store.loopEnd !== null ? ` · B ${formatTime(store.loopEnd)}` : ''}
            <button
              type="button"
              className="pp-loop-clear"
              title="清除循环区间"
              onClick={() => store.setLoop(null, null)}
            >
              <XIcon className="h-3 w-3" />
            </button>
          </span>
        )}
      </div>
    )
  }

  const videoControlsShown = controlsPinned || !store.playing || controlsVisible

  // --- Player view ---
  const renderPlayer = () => {
    const showDeck = isAudio || store.focusMode
    const title = store.mediaTitle || (store.filePath ? basename(store.filePath) : '')
    const deckPlaying =
      store.playing && (isYouTube || (!!store.filePath && activeMediaPath === store.filePath))
    const deckLoading = store.playing && !deckPlaying && !playError
    const deckIdleText = deckPlaying
      ? '纯音频播放 · 暂无字幕'
      : store.playing
        ? '正在缓冲 · 暂无字幕'
        : '已暂停 · 暂无字幕'
    const videoSubText = activeSub
      ? filterSubtitleText(activeSub.text, store.subtitleDisplayMode)
      : ''

    return (
      <div className="pp-main">
        <section className="pp-left">
          <div
            className={showDeck ? 'pp-media-hidden' : 'pp-stage'}
            onMouseMove={showDeck ? undefined : showPlayerControls}
            onMouseLeave={showDeck ? undefined : scheduleHideControls}
            onClick={showDeck ? undefined : togglePlay}
          >
            {isYouTube ? (
              <>
                <iframe
                  ref={ytIframeRef}
                  src={ytEmbedUrl}
                  title={store.mediaTitle || 'YouTube'}
                  className="pp-yt-frame"
                  allow="autoplay; encrypted-media; picture-in-picture"
                />
                {/* 跨域 iframe 会吞掉鼠标事件，用透明层承接播放点击与控制条唤出 */}
                <div className="pp-yt-hit" aria-hidden="true" />
              </>
            ) : (
              <video ref={mediaRef as any} src={mediaUrl} className="pp-video-el" playsInline />
            )}
            {!showDeck && videoSubText && (
              <div
                className={`pp-sub-overlay ${videoControlsShown ? '' : 'is-controls-hidden'}`}
                onClick={(e) => e.stopPropagation()}
              >
                <span
                  className="pp-sub-pill"
                  style={{ fontSize: `${1.875 * store.subtitleFontScale}rem` }}
                >
                  {renderWords(videoSubText, activeSub?.text || '', `video-${activeSub?.id ?? 0}`)}
                </span>
              </div>
            )}
            {!showDeck && converting && <div className="pp-play-error">正在转换为可播格式…</div>}
            {!showDeck && playError && <div className="pp-play-error">播放失败：{playError}</div>}
            {!showDeck && <PlayerHud />}
            {!showDeck && store.filePath && (
              <div
                className={`pp-video-controls transition-opacity duration-200 ${videoControlsShown ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                onClick={(e) => e.stopPropagation()}
              >
                {renderTransportControls('video')}
                <button
                  type="button"
                  className="pp-pin"
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

          {showDeck && (
            <div
              className={`pp-deck ${deckPlaying ? 'is-playing' : ''} ${deckLoading ? 'is-loading' : ''}`}
              onClick={togglePlay}
            >
              {store.subtitles.length > 0 && <DeckOrbit playing={deckPlaying} />}
              <div className="pp-deck-body">
                <div className="pp-deck-top">
                  <span className="pp-eyebrow">{isAudio ? 'Audio session' : 'Focus session'}</span>
                  <span className="pp-badge">
                    {isAudio ? (ext ? ext.toUpperCase() : 'AUDIO') : 'FOCUS'}
                  </span>
                </div>
                <h2 className="pp-deck-title">{title}</h2>
                {converting && <div className="pp-deck-notice">正在转换为可播格式…</div>}
                {playError && (
                  <div className="pp-deck-notice pp-deck-notice--error">播放失败：{playError}</div>
                )}
                <div
                  className={`pp-deck-sentence ${
                    !activeSub && store.subtitles.length === 0 ? 'pp-deck-sentence--empty' : ''
                  }`}
                >
                  {activeSub ? (
                    renderWords(
                      filterSubtitleText(activeSub.text, store.subtitleDisplayMode),
                      activeSub.text,
                      `deck-${activeSub.id}`,
                    )
                  ) : store.subtitles.length === 0 ? (
                    <div className="pp-deck-empty">
                      <div className="pp-deck-empty-visual">
                        <DeckOrbit playing={deckPlaying} />
                      </div>
                      <span className="pp-deck-idle">{deckIdleText}</span>
                    </div>
                  ) : null}
                </div>
                <div className="pp-deck-foot">
                  <button
                    type="button"
                    className="pp-play pp-play--lg"
                    title="播放 / 暂停（Space）"
                    onClick={(e) => {
                      e.stopPropagation()
                      togglePlay()
                    }}
                  >
                    {store.playing ? <Pause className="h-7 w-7" /> : <Play className="h-7 w-7" />}
                  </button>
                  <span
                    onClick={(e) => e.stopPropagation()}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}
                  >
                    <PPIconButton
                      label="上一句（↑）"
                      disabled={store.subtitles.length === 0}
                      onClick={() => seekSentence(-1)}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </PPIconButton>
                    <PPIconButton
                      label="下一句（↓）"
                      disabled={store.subtitles.length === 0}
                      onClick={() => seekSentence(1)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </PPIconButton>
                  </span>
                  <span className="pp-deck-hint">Space 播放 / 暂停 · ← → 快退快进</span>
                </div>
              </div>
              <PlayerHud />
            </div>
          )}

          {store.filePath && (
            <div className="pp-timeline">
              <div
                className={`pp-wave ${
                  showDeck
                    ? store.focusMode
                      ? 'pp-wave--focus'
                      : 'pp-wave--audio'
                    : 'pp-wave--video'
                }`}
              >
                <div className="pp-wave-grid" aria-hidden="true" />
                <Waveform
                  data={store.waveformData}
                  duration={store.duration}
                  currentTime={store.played - store.subtitleOffset}
                  subtitles={store.subtitles}
                  loading={store.waveformLoading}
                  dark={themeDark}
                  loopStart={
                    store.loopStart !== null ? store.loopStart - store.subtitleOffset : null
                  }
                  loopEnd={store.loopEnd !== null ? store.loopEnd - store.subtitleOffset : null}
                  onSeek={(t) => store.requestSeek(t)}
                />
                {store.waveformData.length === 0 && (
                  <span className="pp-wave-note">
                    {store.waveformLoading
                      ? '生成波形…'
                      : isYouTube
                        ? '在线视频无波形 · 可拖动下方进度条'
                        : '暂无波形 · 可拖动下方进度条'}
                  </span>
                )}
              </div>
              <div className="pp-time-row">
                <span>{formatTime(store.played)}</span>
                <input
                  type="range"
                  min={0}
                  max={store.duration || 1}
                  value={store.played}
                  onChange={(e) => store.requestSeek(parseFloat(e.target.value))}
                  className="pp-range"
                  style={{ '--pp-progress': `${progressPct}%` } as CSSProperties}
                  aria-label="播放进度"
                />
                <span>{formatTime(store.duration)}</span>
              </div>
            </div>
          )}

          {store.filePath && showDeck && (
            <div className="pp-dock">{renderTransportControls('dock')}</div>
          )}

          {store.transcribing && store.transcriptionProgress >= 0 && (
            <div className="pp-transcribing">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>
                Whisper {transcribingLabel} {store.transcriptionProgress}%
              </span>
              <div className="pp-transcribing-track">
                <div
                  className="pp-transcribing-fill"
                  style={{ width: `${store.transcriptionProgress}%` }}
                />
              </div>
            </div>
          )}
        </section>

        <aside className="pp-transcript">
          <div className="pp-transcript-head">
            <div className="pp-transcript-heading">
              <Captions />
              <span className="pp-transcript-title">字幕</span>
              {displaySubtitles.length > 0 && (
                <span className="pp-transcript-count">{displaySubtitles.length}</span>
              )}
            </div>
            <div className="pp-transcript-tools">
              {!autoFollow && (
                <button className="pp-text-btn" onClick={resumeFollow}>
                  回到当前句
                </button>
              )}
              <div className="relative">
                <button
                  className="pp-icon-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowSubMenu(!showSubMenu)
                  }}
                  title="字幕操作"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                {showSubMenu && (
                  <div className="pp-menu" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="pp-menu-item"
                      onClick={() => {
                        setShowSubMenu(false)
                        exportSubtitles()
                      }}
                    >
                      <Download className="h-3.5 w-3.5" /> 导出 SRT
                    </button>
                    <button
                      className="pp-menu-item"
                      onClick={() => {
                        setShowSubMenu(false)
                        handleLoadSrt()
                      }}
                    >
                      <FileDown className="h-3.5 w-3.5" /> 导入 SRT
                    </button>
                    <div className="pp-menu-section">
                      <div className="pp-menu-label" title="快捷键 E 循环切换">
                        <span>显示模式</span>
                      </div>
                      <div className="pp-menu-seg">
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
                            className={store.subtitleDisplayMode === m ? 'is-active' : ''}
                            onClick={() => store.setSubtitleDisplayMode(m)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="pp-menu-section">
                      <button
                        className="pp-menu-item"
                        style={{ justifyContent: 'space-between' }}
                        title="悬停查词时暂停（H）"
                        onClick={() => store.setHoverPause(!store.hoverPause)}
                      >
                        <span>悬停查词时暂停</span>
                        <span
                          style={{
                            color: store.hoverPause ? 'var(--pp-accent)' : 'var(--pp-dim)',
                          }}
                        >
                          {store.hoverPause ? '开' : '关'}
                        </span>
                      </button>
                    </div>
                    <div className="pp-menu-section">
                      <div className="pp-menu-label">
                        <span>字幕偏移</span>
                        <span>{store.subtitleOffset.toFixed(1)}s</span>
                      </div>
                      <div className="pp-menu-row">
                        <button
                          title="字幕提前 0.1s（快捷键 ,）"
                          onClick={() => store.adjustSubtitleOffset(-0.1)}
                        >
                          -0.1s
                        </button>
                        <button onClick={() => store.adjustSubtitleOffset(-store.subtitleOffset)}>
                          重置
                        </button>
                        <button
                          title="字幕延后 0.1s（快捷键 .）"
                          onClick={() => store.adjustSubtitleOffset(0.1)}
                        >
                          +0.1s
                        </button>
                      </div>
                    </div>
                    {store.subtitles.length > 0 && (
                      <div className="pp-menu-section">
                        <button
                          className="pp-menu-item"
                          onClick={() => {
                            setShowSubMenu(false)
                            retranscribe()
                          }}
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> 重新转录
                        </button>
                        <button
                          className="pp-menu-item is-danger"
                          onClick={() => {
                            setShowSubMenu(false)
                            closeSubtitles()
                          }}
                        >
                          <XIcon className="h-3.5 w-3.5" /> 关闭字幕
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
          <SubtitleList
            ref={subtitleListRef}
            subtitles={store.subtitles}
            cues={displaySubtitles}
            played={store.played}
            offset={store.subtitleOffset}
            fontScale={store.subtitleFontScale}
            autoFollow={autoFollow}
            range={dragRange ?? loopRange}
            onAutoFollowChange={setAutoFollow}
            onSeek={(time) => store.requestSeek(time)}
            onSpeak={speak}
            onFavorite={(cue) => openFavorite(cue, hover?.sentence === cue.text ? hover.word : '')}
            onDragStart={handleCueDragStart}
            onDragHover={handleCueDragHover}
            onImportSrt={handleLoadSrt}
            onTranscribe={() => store.filePath && startTranscription(store.filePath)}
            renderText={(cue) => renderWords(cue.displayText, cue.text, `cue-${cue.id}`)}
          />
        </aside>
      </div>
    )
  }

  return (
    <div className={isActive ? 'pp-root' : 'hidden'}>
      <div className="pp-shell">
        <header className="pp-topbar">
          <div className="pp-topbar-left">
            <button
              type="button"
              className="pp-back"
              onClick={() => navigate(backTarget)}
              title={`返回${backLabel}`}
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="pp-heading">
              <span className="pp-eyebrow">
                {store.filePath ? `Now playing · ${isAudio ? 'Audio' : 'Video'}` : 'Player'}
              </span>
              <h1 className="pp-title">
                {store.filePath ? store.mediaTitle || basename(store.filePath) : '选择一段素材开始'}
              </h1>
              {store.filePath && (
                <div className="pp-meta">
                  <span>{isAudio ? 'Audio' : 'Video'}</span>
                  {store.duration > 0 && (
                    <>
                      <span className="pp-meta-dot">·</span>
                      <span>{formatTime(store.duration)}</span>
                    </>
                  )}
                  {displaySubtitles.length > 0 && (
                    <>
                      <span className="pp-meta-dot">·</span>
                      <span>{displaySubtitles.length} sentences</span>
                    </>
                  )}
                  {store.subtitleOffset !== 0 && (
                    <>
                      <span className="pp-meta-dot">·</span>
                      <span>offset {store.subtitleOffset.toFixed(1)}s</span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="pp-top-actions">
            {store.filePath && (
              <button
                type="button"
                className="pp-ghost-btn"
                onClick={handleLoadSrt}
                title="加载 SRT 字幕"
              >
                <Subtitles />
                <span>字幕</span>
              </button>
            )}
            <button
              type="button"
              className="pp-ghost-btn"
              onClick={() => setShowShortcutHelp(true)}
              title="快捷键帮助"
            >
              <Keyboard />
              <span>快捷键</span>
            </button>
          </div>
        </header>

        {store.filePath ? (
          renderPlayer()
        ) : (
          <div className="pp-empty">
            <div className="pp-empty-card">
              <div className="pp-empty-icon">
                <AudioLines className="h-7 w-7" />
              </div>
              <h2 className="pp-empty-title">播放器空闲</h2>
              <p className="pp-empty-text">
                打开本地视频或音频，或从文件库选择一条素材，开始精听。
              </p>
              <div className="pp-empty-actions">
                <button type="button" className="pp-primary-btn" onClick={handleOpenFile}>
                  选择文件
                </button>
                <button type="button" className="pp-ghost-btn" onClick={() => navigate(backTarget)}>
                  返回{backLabel}
                </button>
              </div>
            </div>
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

        {/* AI 当前句翻译/详解面板（由控制栏 Sparkles 按钮触发） */}
        {aiTarget && (
          <div className="fixed bottom-24 left-1/2 z-40 -translate-x-1/2">
            <div className="pp-ai-card">
              <p className="pp-ai-sentence line-clamp-2">{aiTarget.text}</p>
              <div className="pp-ai-actions">
                <button type="button" className="pp-ai-btn" onClick={handleAITranslate}>
                  <Languages className="h-3.5 w-3.5" /> 翻译
                </button>
                <button type="button" className="pp-ai-btn is-primary" onClick={handleAIExplain}>
                  <BookOpen className="h-3.5 w-3.5" /> 详解
                </button>
                <button
                  type="button"
                  className="pp-ai-btn"
                  style={{ marginLeft: 'auto' }}
                  onClick={() => setAiTarget(null)}
                >
                  <XIcon className="h-3.5 w-3.5" />
                </button>
              </div>
              {(aiTranslate || aiExplain?.loading) && (
                <div className="mt-2">
                  {aiTranslate && (
                    <>
                      {aiTranslate.loading && !aiTranslate.text && (
                        <span className="flex items-center gap-1 text-xs text-[var(--pp-muted)]">
                          <Loader2 className="h-3 w-3 animate-spin" /> 翻译中...
                        </span>
                      )}
                      {aiTranslate.text && <p className="pp-ai-result">{aiTranslate.text}</p>}
                      {aiTranslate.error && (
                        <p className="mt-1 text-xs text-red-400">{aiTranslate.error}</p>
                      )}
                    </>
                  )}
                  {aiExplain?.loading && (
                    <span className="flex items-center gap-1 text-xs text-[var(--pp-muted)]">
                      <Loader2 className="h-3 w-3 animate-spin" /> 生成详解...
                    </span>
                  )}
                  {aiExplain?.error && (
                    <p className="mt-1 text-xs text-red-400">{aiExplain.error}</p>
                  )}
                </div>
              )}
            </div>
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
