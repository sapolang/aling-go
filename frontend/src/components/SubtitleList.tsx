import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type ReactNode,
} from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { Captions, Loader2, Star, Subtitles } from 'lucide-react'
import type { SubtitleItem } from '@/types/api'
import { findCueIndexAt, formatClockTime } from '@/lib/subtitles'
import { useSpeakingText } from '@/hooks/useSpeaking'
import SpeakerIcon from '@/components/SpeakerIcon'

export type SubtitleCue = SubtitleItem & { displayText: string }

export interface SubtitleListHandle {
  /** 滚动到当前播放位置对应的字幕行 */
  scrollToCurrent: () => void
}

interface SubtitleListProps {
  /** 原始字幕，用于空状态判定 */
  subtitles: SubtitleItem[]
  /**
   * 字幕源标识（文件路径 + 导入的字幕路径）。
   * 只有切换文件或换字幕时才会变化；增量转录每追加一句都会换新数组，不能据此重置滚动。
   */
  sourceKey: string
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
  /** 转录进行中：右栏不再显示空白空状态，而是展示实时进度 */
  transcribing: boolean
  transcribingLabel: string
  transcriptionProgress: number
  /** 显示模式过滤后没有可显示内容时，恢复为「全部」 */
  onShowAllSubtitles: () => void
  renderText: (cue: SubtitleCue) => ReactNode
}

interface CueRowProps {
  cue: SubtitleCue
  index: number
  /** 是否当前播放句：由父级统一算好后传入，避免播放进度导致每行重渲染 */
  isActive: boolean
  isPast: boolean
  /** 该句是否正在朗读，用于喇叭播放动效 */
  isSpeaking: boolean
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

const CueRow = memo(function CueRow({
  cue,
  index,
  isActive,
  isPast,
  isSpeaking,
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
  const inRange = range !== null && index >= range.start && index <= range.end

  return (
    <div className="pp-cue-shell">
      <div
        onMouseEnter={() => onDragHover(index)}
        className={`pp-cue ${inRange ? 'is-range' : ''} ${isActive ? 'is-active' : ''} ${isPast ? 'is-past' : ''}`}
        style={{ fontSize: `${1.125 * fontScale}rem` }}
        onClick={() => onSeek(cue.startTime + offset)}
        role="button"
        tabIndex={0}
        aria-current={isActive ? 'true' : undefined}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return
          e.preventDefault()
          e.stopPropagation()
          onSeek(cue.startTime + offset)
        }}
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
              <SpeakerIcon speaking={isSpeaking} className="h-3 w-3" />
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
})

// 列表首尾留白，与原有字幕面板内边距保持一致
const ListHeader = () => <div style={{ height: 6 }} />
const ListFooter = () => <div style={{ height: 14 }} />

// 播放页右侧字幕列表：只渲染视口附近的字幕行，业务动作由父级回调注入
const SubtitleList = forwardRef<SubtitleListHandle, SubtitleListProps>(function SubtitleList(
  {
    subtitles,
    sourceKey,
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
    transcribing,
    transcribingLabel,
    transcriptionProgress,
    onShowAllSubtitles,
    renderText,
  },
  ref,
) {
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const lastIdxRef = useRef(-2)
  const cursor = played - offset
  // 当前句只计算一次，避免每行各自比较播放时间
  const activeIndex = findCueIndexAt(cues, cursor, { inclusiveEnd: false })
  // 正在朗读的字幕文本，用于给喇叭加播放动效
  const speakingText = useSpeakingText()

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

  // 切换文件或字幕源时回到列表顶部。
  // 增量转录时 subtitles 每一句都会换新数组，不能跟着重置，否则播放中列表会被反复拽回顶部。
  useEffect(() => {
    lastIdxRef.current = -2
    virtuosoRef.current?.scrollTo({ top: 0 })
  }, [sourceKey])

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
        {cues.length === 0 ? (
          <div className="pp-transcript-body">
            <div className="pp-transcript-empty">
              {transcribing ? (
                <Loader2 className="h-7 w-7 animate-spin" />
              ) : (
                <Captions className="h-8 w-8" />
              )}
              {transcribing ? (
                <>
                  <p>
                    Whisper {transcribingLabel}
                    {transcriptionProgress >= 0 ? ` · ${transcriptionProgress}%` : ''}
                  </p>
                  {transcriptionProgress >= 0 && (
                    <div className="pp-transcript-empty-track">
                      <div
                        className="pp-transcript-empty-fill"
                        style={{ width: `${transcriptionProgress}%` }}
                      />
                    </div>
                  )}
                  <p className="pp-transcript-empty-note">
                    逐句结果会实时追加到列表，可以先继续播放。
                  </p>
                </>
              ) : subtitles.length === 0 ? (
                <>
                  <p>还没有字幕。可以导入 SRT，或让 Whisper 转录当前素材。</p>
                  <div className="pp-transcript-empty-actions">
                    <button className="pp-mini-btn" onClick={onImportSrt}>
                      <Subtitles /> 导入字幕
                    </button>
                    <button className="pp-mini-btn is-accent" onClick={onTranscribe}>
                      <Loader2 /> 转录字幕
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p>当前显示模式下没有可显示的字幕。</p>
                  <div className="pp-transcript-empty-actions">
                    <button className="pp-mini-btn is-accent" onClick={onShowAllSubtitles}>
                      <Subtitles /> 显示全部字幕
                    </button>
                  </div>
                </>
              )}
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
                isActive={index === activeIndex}
                isPast={cursor > cue.endTime}
                isSpeaking={cue.displayText.trim() === speakingText}
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
