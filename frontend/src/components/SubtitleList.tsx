import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type ReactNode,
} from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
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

interface CueRowProps {
  cue: SubtitleCue
  index: number
  played: number
  offset: number
  range: { start: number; end: number } | null
  fontScale: number
  onSeek: (time: number) => void
  onSpeak: (text: string) => void
  onFavorite: (cue: SubtitleCue) => void
  onDragStart: (index: number) => void
  onDragHover: (index: number) => void
  renderText: (cue: SubtitleCue) => ReactNode
}

function CueRow({
  cue,
  index,
  played,
  offset,
  range,
  fontScale,
  onSeek,
  onSpeak,
  onFavorite,
  onDragStart,
  onDragHover,
  renderText,
}: CueRowProps) {
  const cursor = played - offset
  const isActive = cursor >= cue.startTime - 0.08 && cursor < cue.endTime
  const isPast = cursor > cue.endTime
  const inRange = range !== null && index >= range.start && index <= range.end

  return (
    <div className="pp-cue-shell">
      <div
        onMouseEnter={() => onDragHover(index)}
        className={`pp-cue ${inRange ? 'is-range' : ''} ${isActive ? 'is-active' : ''} ${isPast ? 'is-past' : ''}`}
        style={{ fontSize: `${1.125 * fontScale}rem` }}
        onClick={() => onSeek(cue.startTime + offset)}
      >
        <span
          className="pp-cue-time"
          title="按住上下拖动，可选多句循环"
          onMouseDown={(e) => {
            e.stopPropagation()
            e.preventDefault()
            onDragStart(index)
          }}
        >
          {formatClockTime(cue.startTime)}
        </span>
        {renderText(cue)}
        {isActive && (
          <span className="pp-cue-actions">
            <button
              className="pp-cue-action"
              title="朗读本句"
              onClick={(e) => {
                e.stopPropagation()
                onSpeak(cue.displayText)
              }}
            >
              <Speaker className="h-3 w-3" />
            </button>
            <button
              className="pp-cue-action"
              title="收藏当前句（F）"
              onClick={(e) => {
                e.stopPropagation()
                onFavorite(cue)
              }}
            >
              <Star className="h-3 w-3" />
            </button>
          </span>
        )}
      </div>
    </div>
  )
}

// 列表首尾留白，与原有字幕面板内边距保持一致
const ListHeader = () => <div style={{ height: 6 }} />
const ListFooter = () => <div style={{ height: 14 }} />

// 播放页右侧字幕列表：只渲染视口附近的字幕行，业务动作由父级回调注入
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
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const lastIdxRef = useRef(-2)
  const cursor = played - offset

  const scrollToIndex = useCallback((index: number) => {
    virtuosoRef.current?.scrollToIndex({ index, align: 'center', behavior: 'smooth' })
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

  // 当前字幕切换时自动滚动到视口中间（用户手动浏览时由父级暂停跟随）
  useEffect(() => {
    if (!autoFollow || cues.length === 0) return
    const idx = findCueIndexAt(cues, cursor, { inclusiveEnd: false })
    if (idx <= 0 || idx === lastIdxRef.current) return
    lastIdxRef.current = idx
    scrollToIndex(idx)
  }, [cursor, cues, autoFollow, scrollToIndex])

  // 切换文件或字幕时回到列表顶部
  useEffect(() => {
    lastIdxRef.current = -2
    virtuosoRef.current?.scrollTo({ top: 0 })
  }, [subtitles])

  return (
    <>
      {cues.length > 1 && (
        <div className="pp-transcript-hint">按住时间戳上下拖动，可选多句循环</div>
      )}
      <div
        className="pp-transcript-viewport"
        onWheel={(e) => {
          if (!autoFollow) return
          const scroller = (e.target as HTMLElement).closest('[data-virtuoso-scroller="true"]')
          if (scroller && scroller.scrollHeight > scroller.clientHeight) {
            onAutoFollowChange(false)
          }
        }}
        onTouchMove={() => {
          if (autoFollow) onAutoFollowChange(false)
        }}
      >
        {subtitles.length === 0 ? (
          <div className="pp-transcript-body">
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
          </div>
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            className="pp-transcript-scroller"
            data={cues}
            components={{ Header: ListHeader, Footer: ListFooter }}
            overscan={400}
            itemContent={(index, cue) => (
              <CueRow
                key={cue.id}
                cue={cue}
                index={index}
                played={played}
                offset={offset}
                range={range}
                fontScale={fontScale}
                onSeek={onSeek}
                onSpeak={onSpeak}
                onFavorite={onFavorite}
                onDragStart={onDragStart}
                onDragHover={onDragHover}
                renderText={renderText}
              />
            )}
          />
        )}
      </div>
    </>
  )
})

export default SubtitleList
