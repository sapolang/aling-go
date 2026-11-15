import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { usePlayerStore } from '@/stores/playerStore'
import { speak } from '@/lib/tts'

interface HoverState {
  word: string
  sentence: string
  anchor: DOMRect
}

interface UseWordHoverOptions {
  /** 原生媒体元素；YouTube 等无原生元素的来源为空 */
  mediaRef: RefObject<HTMLVideoElement>
  /** 生词本中的词在字幕里高亮 */
  isSavedWord: (word: string) => boolean
  /** 字幕列表拖选期间不弹释义，避免拖动时闪烁 */
  dragState: RefObject<{ active: boolean }>
}

export interface WordHoverHandle {
  hover: HoverState | null
  selectedWord: string
  currentSentence: string
  showLookup: boolean
  renderWords: (text: string, sentence: string, keyPrefix: string) => ReactNode
  handleWordClick: (word: string, sentence: string) => void
  cancelHover: () => void
  scheduleHideHover: () => void
  keepHover: () => void
  closeLookup: () => void
  /** 用户主动播放/暂停时清除悬停暂停标记 */
  resetHoverPause: () => void
}

/** 悬停查词：150ms 弹出、250ms 收起，悬停暂停按偏好自动恢复播放 */
export function useWordHover({
  mediaRef,
  isSavedWord,
  dragState,
}: UseWordHoverOptions): WordHoverHandle {
  const [selectedWord, setSelectedWord] = useState('')
  const [currentSentence, setCurrentSentence] = useState('')
  const [hover, setHover] = useState<HoverState | null>(null)
  const [showLookup, setShowLookup] = useState(false)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoverHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 悬停查词时暂停播放；鼠标离开后恢复
  const hoverPauseRef = useRef(false)
  const currentSubtitleIndex = usePlayerStore((s) => s.currentSubtitleIndex)

  const pauseForHover = useCallback(() => {
    const st = usePlayerStore.getState()
    const el = mediaRef.current
    if (!st.hoverPause || hoverPauseRef.current || !el || el.paused) return
    el.pause()
    st.setPlaying(false)
    hoverPauseRef.current = true
  }, [mediaRef])

  const resumeAfterHover = useCallback(() => {
    if (!hoverPauseRef.current) return
    hoverPauseRef.current = false
    const st = usePlayerStore.getState()
    const el = mediaRef.current
    if (!el || !st.filePath) return
    el.play().catch(() => {})
    st.setPlaying(true)
  }, [mediaRef])

  const cancelHover = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    if (hoverHideTimer.current) clearTimeout(hoverHideTimer.current)
    hoverTimer.current = null
    hoverHideTimer.current = null
    setHover(null)
  }, [])

  const scheduleHover = useCallback(
    (word: string, sentence: string, el: HTMLElement) => {
      if (dragState.current?.active) return
      const clean = word.replace(/[^a-zA-Z0-9\-']/g, '')
      if (clean.length < 2) return
      if (hoverTimer.current) clearTimeout(hoverTimer.current)
      if (hoverHideTimer.current) clearTimeout(hoverHideTimer.current)
      const anchor = el.getBoundingClientRect()
      // 悬停 150ms 后弹出释义，避免扫过字幕时闪烁
      hoverTimer.current = setTimeout(() => {
        pauseForHover()
        setHover({ word: clean, sentence, anchor })
      }, 150)
    },
    [dragState, pauseForHover],
  )

  // 移出单词后延迟收起，留出时间把鼠标移进浮层
  const scheduleHideHover = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    if (hoverHideTimer.current) clearTimeout(hoverHideTimer.current)
    hoverHideTimer.current = setTimeout(() => {
      setHover(null)
      resumeAfterHover()
    }, 250)
  }, [resumeAfterHover])

  const keepHover = useCallback(() => {
    if (hoverHideTimer.current) clearTimeout(hoverHideTimer.current)
  }, [])

  const handleWordClick = useCallback(
    (word: string, sentence: string) => {
      const clean = word.replace(/[^a-zA-Z0-9\-']/g, '')
      if (!clean) return
      // 点词即查时暂停播放，方便看释义
      hoverPauseRef.current = false
      cancelHover()
      mediaRef.current?.pause()
      usePlayerStore.getState().setPlaying(false)
      speak(clean)
      setSelectedWord(clean)
      setCurrentSentence(sentence)
      setShowLookup(true)
    },
    [cancelHover, mediaRef],
  )

  // 播放推进导致当前句切换时，悬停提示的位置已失效
  useEffect(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    if (hoverHideTimer.current) clearTimeout(hoverHideTimer.current)
    hoverTimer.current = null
    hoverHideTimer.current = null
    setHover(null)
  }, [currentSubtitleIndex])

  // 字幕分词：视频浮层、音频 deck、字幕列表共用同一套悬停查词交互
  const renderWords = useCallback(
    (text: string, sentence: string, keyPrefix: string) =>
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
      }),
    [handleWordClick, isSavedWord, scheduleHideHover, scheduleHover],
  )

  return {
    hover,
    selectedWord,
    currentSentence,
    showLookup,
    renderWords,
    handleWordClick,
    cancelHover,
    scheduleHideHover,
    keepHover,
    closeLookup: () => setShowLookup(false),
    resetHoverPause: () => {
      hoverPauseRef.current = false
    },
  }
}
