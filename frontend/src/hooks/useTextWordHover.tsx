import { useCallback, useRef, useState, type ReactNode } from 'react'

interface HoverState {
  word: string
  sentence: string
  anchor: DOMRect
}

export interface TextWordHoverHandle {
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
}

interface UseTextWordHoverOptions {
  /** 生词本中的词在正文里高亮 */
  isSavedWord: (word: string) => boolean
  /** 点击单词准备查词时调用，精听页可在这里暂停朗读 */
  onWordOpen?: () => void
}

/**
 * 与播放页字幕相同的悬停查词交互，但不依赖播放器 store / media 元素。
 * 提取成独立 hook 后，PDF 精听页可以复用 WordHoverCard 与 WordLookupModal。
 */
export function useTextWordHover({
  isSavedWord,
  onWordOpen,
}: UseTextWordHoverOptions): TextWordHoverHandle {
  const [selectedWord, setSelectedWord] = useState('')
  const [currentSentence, setCurrentSentence] = useState('')
  const [hover, setHover] = useState<HoverState | null>(null)
  const [showLookup, setShowLookup] = useState(false)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimers = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hoverTimer.current = null
    hideTimer.current = null
  }, [])

  const cancelHover = useCallback(() => {
    clearTimers()
    setHover(null)
  }, [clearTimers])

  const scheduleHover = useCallback(
    (word: string, sentence: string, el: HTMLElement) => {
      const clean = word.replace(/[^a-zA-Z0-9\-']/g, '')
      if (clean.length < 2) return
      clearTimers()
      const anchor = el.getBoundingClientRect()
      hoverTimer.current = setTimeout(() => {
        setHover({ word: clean, sentence, anchor })
      }, 150)
    },
    [clearTimers],
  )

  const scheduleHideHover = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => {
      setHover(null)
    }, 250)
  }, [])

  const keepHover = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
  }, [])

  const handleWordClick = useCallback(
    (word: string, sentence: string) => {
      const clean = word.replace(/[^a-zA-Z0-9\-']/g, '')
      if (!clean) return
      onWordOpen?.()
      cancelHover()
      setSelectedWord(clean)
      setCurrentSentence(sentence)
      setShowLookup(true)
    },
    [cancelHover, onWordOpen],
  )

  const renderWords = useCallback(
    (text: string, sentence: string, keyPrefix: string) =>
      text.split(/(\s+)/).map((part, i) => {
        const clean = part.replace(/[^a-zA-Z0-9\-']/g, '')
        if (clean.length > 1) {
          return (
            <span
              key={`${keyPrefix}-${i}`}
              className={`pdf-word ${isSavedWord(part) ? 'is-saved' : ''}`}
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
    [handleWordClick, isSavedWord, scheduleHover, scheduleHideHover],
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
  }
}
