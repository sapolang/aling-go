import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type ReactNode,
} from 'react'
import { Captions, Loader2, Star, Subtitles, Volume2 as Speaker } from 'lucide-react'
import type { SubtitleItem } from '@/types/electron'
import { findCueIndexAt, formatClockTime } from '@/lib/subtitles'

export type SubtitleCue = SubtitleItem & { displayText: string }

export interface SubtitleListHandle {
  /** 滚动到当前播放位置对应的字幕行 */
  scrollToCurrent: () => void
}

interface SubtitleListProps {
  /** 原始字幕，用于空状态判定与切文件时重置滚动 */
  subtitles: SubtitleItem[]
  /** 按显示模式过滤后的字幕，与 subtitles 同序 */
  cues: SubtitleCue[]
  played: number
  offset: number
  fontScale: number
  autoFollow: boolean
  /** 当前高亮区间：拖选区间优先于 A-B 循环区间 */
  range: { start: number; end: number } | null
  onAutoFollowChange: (follow: boolean) => void
  onSeek: (time: number) => void
  onSpeak: (text: string) => void
  onFavorite: (cue: SubtitleCue) => void
  onDragStart: (index: number) => void
  onDragHover: (index: number) => void
  onImportSrt: () => void
  onTranscribe: () => void
  renderText: (cue: SubtitleCue) => ReactNode
}

// 播放页右侧字幕列表：仅负责渲染、自动跟随与拖选交互，业务动作由父级回调注入
const SubtitleList = forwardRef<SubtitleListHandle, SubtitleListProps>(function SubtitleList(
  {
    subtitles,
    cues,
    played,
    offset,
    fontScale,
    autoFollow,
    range,
    onAutoFollowChange,
    onSeek,
    onSpeak,
    onFavorite,
    onDragStart,
    onDragHover,
    onImportSrt,
    onTranscribe,
    renderText,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const lastIdxRef = useRef(-2)
  const cursor = played - offset

  // 只滚动字幕容器本身，避免在窄窗口下带动整页滚动
  const scrollToIndex = useCallback((idx: number) => {
    const container = containerRef.current
    const child = container?.children[idx] as HTMLElement | undefined
    if (!container || !child) return
    const cRect = container.getBoundingClientRect()
    const eRect = child.getBoundingClientRect()
    const top =
      container.scrollTop +
      (eRect.top - cRect.top) -
      (container.clientHeight - child.clientHeight) / 2
    container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      scrollToCurrent: () => {
        lastIdxRef.current = -2
        const idx = findCueIndexAt(cues, cursor, { inclusiveEnd: false })
        if (idx >= 0) scrollToIndex(idx)
      },
    }),
    [cues, cursor, scrollToIndex],
  )

  // 当前字幕切换时自动滚动到容器中间（用户手动浏览时由父级暂停跟随）
  useEffect(() => {
    if (!autoFollow || cues.length === 0) return
    const idx = findCueIndexAt(cues, cursor, { inclusiveEnd: false })
    if (idx <= 0 || idx === lastIdxRef.current) return
    lastIdxRef.current = idx
    scrollToIndex(idx)
  }, [cursor, cues, autoFollow, scrollToIndex])

  // 切换文件或字幕时回到列表顶部
  useEffect(() => {
    if (containerRef.current) containerRef.current.scrollTop = 0
    lastIdxRef.current = -2
  }, [subtitles])

  return (
    <>
      {cues.length > 1 && (
        <div className="pp-transcript-hint">按住时间戳上下拖动，可选多句循环</div>
      )}
      <div
        ref={containerRef}
        className="pp-transcript-body"
        onWheel={(e) => {
          if (autoFollow && e.currentTarget.scrollHeight > e.currentTarget.clientHeight) {
            onAutoFollowChange(false)
          }
        }}
        onTouchMove={() => {
          if (autoFollow) onAutoFollowChange(false)
        }}
      >
        {subtitles.length === 0 ? (
          <div className="pp-transcript-empty">
            <Captions className="h-8 w-8" />
            <p>还没有字幕。可以导入 SRT，或让 Whisper 转录当前素材。</p>
            <div className="pp-transcript-empty-actions">
              <button className="pp-mini-btn" onClick={onImportSrt}>
                <Subtitles /> 导入字幕
              </button>
              <button className="pp-mini-btn is-accent" onClick={onTranscribe}>
                <Loader2 /> 转录字幕
              </button>
            </div>
          </div>
        ) : (
          cues.map((sub, idx) => {
            const isActive = cursor >= sub.startTime - 0.08 && cursor < sub.endTime
            const isPast = cursor > sub.endTime
            const inRange = range !== null && idx >= range.start && idx <= range.end
            return (
              <div
                key={sub.id}
                onMouseEnter={() => onDragHover(idx)}
                className={`pp-cue ${inRange ? 'is-range' : ''} ${isActive ? 'is-active' : ''} ${isPast ? 'is-past' : ''}`}
                style={{ fontSize: `${1.125 * fontScale}rem` }}
                onClick={() => onSeek(sub.startTime + offset)}
              >
                <span
                  className="pp-cue-time"
                  title="按住上下拖动，可选多句循环"
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    e.preventDefault()
                    onDragStart(idx)
                  }}
                >
                  {formatClockTime(sub.startTime)}
                </span>
                {renderText(sub)}
                {isActive && (
                  <span className="pp-cue-actions">
                    <button
                      className="pp-cue-action"
                      title="朗读本句"
                      onClick={(e) => {
                        e.stopPropagation()
                        onSpeak(sub.displayText)
                      }}
                    >
                      <Speaker className="h-3 w-3" />
                    </button>
                    <button
                      className="pp-cue-action"
                      title="收藏当前句（F）"
                      onClick={(e) => {
                        e.stopPropagation()
                        onFavorite(sub)
                      }}
                    >
                      <Star className="h-3 w-3" />
                    </button>
                  </span>
                )}
              </div>
            )
          })
        )}
      </div>
    </>
  )
})

export default SubtitleList
