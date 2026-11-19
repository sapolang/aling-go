import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
} from 'react'
import {
  Captions,
  Download,
  FileDown,
  Loader2,
  MoreHorizontal,
  RotateCcw,
  X as XIcon,
} from 'lucide-react'
import { usePlayerStore, type SubtitleDisplayMode } from '@/stores/playerStore'
import type { SubtitleCue, SubtitleListHandle } from '@/components/SubtitleList'
import SubtitleList from '@/components/SubtitleList'
import { showPlayerHud } from '@/components/PlayerHud'
import { filterSubtitleText } from './constants'

const MODE_OPTIONS: [SubtitleDisplayMode, string, string][] = [
  ['all', '全部', '显示原文与翻译'],
  ['en', '英', '仅显示英文'],
  ['zh', '中', '仅显示中文'],
  ['off', '关', '隐藏字幕'],
]

interface TranscriptPanelProps {
  listRef: RefObject<SubtitleListHandle>
  /** 与悬停查词共享：拖选期间不弹释义 */
  dragStateRef: MutableRefObject<{ active: boolean; anchor: number; current: number }>
  onSeek: (time: number) => void
  onSpeak: (text: string) => void
  onFavorite: (cue: SubtitleCue) => void
  onCancelHover: () => void
  onImportSrt: () => void
  onTranscribe: () => void
  onExport: () => void
  onRetranscribe: () => void
  transcribing: boolean
  transcribingLabel: string
  transcriptionProgress: number
  renderWords: (text: string, sentence: string, keyPrefix: string) => ReactNode
}

/** 右侧字幕面板：头部菜单、自动跟随、拖选成段循环与字幕列表 */
export default function TranscriptPanel({
  listRef,
  dragStateRef,
  onSeek,
  onSpeak,
  onFavorite,
  onCancelHover,
  onImportSrt,
  onTranscribe,
  onExport,
  onRetranscribe,
  transcribing,
  transcribingLabel,
  transcriptionProgress,
  renderWords,
}: TranscriptPanelProps) {
  const subtitles = usePlayerStore((s) => s.subtitles)
  const played = usePlayerStore((s) => s.played)
  const subtitleOffset = usePlayerStore((s) => s.subtitleOffset)
  const fontScale = usePlayerStore((s) => s.subtitleFontScale)
  const displayMode = usePlayerStore((s) => s.subtitleDisplayMode)
  const hoverPause = usePlayerStore((s) => s.hoverPause)
  const loopStart = usePlayerStore((s) => s.loopStart)
  const loopEnd = usePlayerStore((s) => s.loopEnd)
  const mediaPath = usePlayerStore((s) => s.filePath)
  const subtitlePath = usePlayerStore((s) => s.subtitlePath)
  // 字幕源标识：切文件或导入新字幕时才变，流式追加不会变
  const subtitleSourceKey = `${mediaPath ?? ''}|${subtitlePath ?? ''}`

  const [showSubMenu, setShowSubMenu] = useState(false)
  const [autoFollow, setAutoFollow] = useState(true)
  const [dragRange, setDragRange] = useState<{ start: number; end: number } | null>(null)

  // 按显示模式派生字幕：过滤中/英文行，过滤后无内容的条目在列表中隐藏
  const displaySubtitles = useMemo(
    () =>
      subtitles
        .map((s) => ({ ...s, displayText: filterSubtitleText(s.text, displayMode) }))
        .filter((s) => s.displayText.length > 0),
    [subtitles, displayMode],
  )

  // 当前循环区间覆盖的字幕行，用于在列表中持续高亮
  const loopRange = useMemo(() => {
    if (loopStart === null || loopEnd === null) return null
    let start = -1
    let end = -1
    displaySubtitles.forEach((s, i) => {
      if (s.endTime + subtitleOffset > loopStart && s.startTime + subtitleOffset < loopEnd) {
        if (start === -1) start = i
        end = i
      }
    })
    return start === -1 ? null : { start, end }
  }, [loopStart, loopEnd, subtitleOffset, displaySubtitles])

  // 拖选结束：选多行成段循环，单行保持原来的跳转行为
  const finalizeRef = useRef<() => void>(() => {})
  useEffect(() => {
    finalizeRef.current = () => {
      const drag = dragStateRef.current
      if (!drag.active) return
      dragStateRef.current = { active: false, anchor: -1, current: -1 }
      const start = Math.min(drag.anchor, drag.current)
      const end = Math.max(drag.anchor, drag.current)
      setDragRange(null)
      onCancelHover()
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
  })

  useEffect(() => {
    const onUp = () => finalizeRef.current()
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [])

  // 切换文件或字幕源时重新开启自动跟随；流式转录追加时不打断用户浏览
  useEffect(() => {
    setAutoFollow(true)
  }, [subtitleSourceKey])

  useEffect(() => {
    if (!showSubMenu) return
    const close = () => setShowSubMenu(false)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowSubMenu(false)
    }
    document.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [showSubMenu])

  const resumeFollow = () => {
    setAutoFollow(true)
    listRef.current?.scrollToCurrent()
  }

  // 与 renderWords 一起保持稳定引用，配合 SubtitleList 的行级 memo 减少重渲染
  const renderText = useCallback(
    (cue: SubtitleCue) => renderWords(cue.displayText, cue.text, `cue-${cue.id}`),
    [renderWords],
  )

  const handleCueDragStart = useCallback(
    (idx: number) => {
      dragStateRef.current = { active: true, anchor: idx, current: idx }
      setDragRange({ start: idx, end: idx })
      onCancelHover()
    },
    [dragStateRef, onCancelHover],
  )

  const handleCueDragHover = useCallback(
    (idx: number) => {
      if (!dragStateRef.current.active) return
      dragStateRef.current.current = idx
      const anchor = dragStateRef.current.anchor
      setDragRange({ start: Math.min(anchor, idx), end: Math.max(anchor, idx) })
    },
    [dragStateRef],
  )

  return (
    <aside className="pp-transcript">
      <div className="pp-transcript-head">
        <div className="pp-transcript-heading">
          <Captions />
          <span className="pp-transcript-title">字幕</span>
          {displaySubtitles.length > 0 && (
            <span className="pp-transcript-count">{displaySubtitles.length}</span>
          )}
          {transcribing && (
            <span className="pp-transcribing-chip" role="status">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span className="pp-transcribing-text">
                Whisper {transcribingLabel}
                {transcriptionProgress >= 0 ? ` ${transcriptionProgress}%` : ''}
              </span>
            </span>
          )}
        </div>
        <div className="pp-transcript-tools">
          <div className="pp-mode-seg" role="group" aria-label="字幕显示模式">
            {MODE_OPTIONS.map(([m, label, title]) => (
              <button
                key={m}
                className={displayMode === m ? 'is-active' : ''}
                title={title}
                aria-pressed={displayMode === m}
                onClick={() => usePlayerStore.getState().setSubtitleDisplayMode(m)}
              >
                {label}
              </button>
            ))}
          </div>
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
                    onExport()
                  }}
                >
                  <Download className="h-3.5 w-3.5" /> 导出 SRT
                </button>
                <button
                  className="pp-menu-item"
                  onClick={() => {
                    setShowSubMenu(false)
                    onImportSrt()
                  }}
                >
                  <FileDown className="h-3.5 w-3.5" /> 导入 SRT
                </button>
                <div className="pp-menu-section">
                  <button
                    className="pp-menu-item"
                    style={{ justifyContent: 'space-between' }}
                    title="悬停查词时暂停（H）"
                    onClick={() => usePlayerStore.getState().setHoverPause(!hoverPause)}
                  >
                    <span>悬停查词时暂停</span>
                    <span style={{ color: hoverPause ? 'var(--pp-accent)' : 'var(--pp-dim)' }}>
                      {hoverPause ? '开' : '关'}
                    </span>
                  </button>
                </div>
                <div className="pp-menu-section">
                  <div className="pp-menu-label">
                    <span>字幕偏移</span>
                    <span>{subtitleOffset.toFixed(1)}s</span>
                  </div>
                  <div className="pp-menu-row">
                    <button
                      title="字幕提前 0.1s（快捷键 ,）"
                      onClick={() => usePlayerStore.getState().adjustSubtitleOffset(-0.1)}
                    >
                      -0.1s
                    </button>
                    <button
                      onClick={() =>
                        usePlayerStore.getState().adjustSubtitleOffset(-subtitleOffset)
                      }
                    >
                      重置
                    </button>
                    <button
                      title="字幕延后 0.1s（快捷键 .）"
                      onClick={() => usePlayerStore.getState().adjustSubtitleOffset(0.1)}
                    >
                      +0.1s
                    </button>
                  </div>
                </div>
                {subtitles.length > 0 && (
                  <div className="pp-menu-section">
                    <button
                      className="pp-menu-item"
                      onClick={() => {
                        setShowSubMenu(false)
                        onRetranscribe()
                      }}
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> 重新转录
                    </button>
                    <button
                      className="pp-menu-item is-danger"
                      onClick={() => {
                        setShowSubMenu(false)
                        usePlayerStore.getState().setSubtitles([])
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
        ref={listRef}
        subtitles={subtitles}
        sourceKey={subtitleSourceKey}
        cues={displaySubtitles}
        played={played}
        offset={subtitleOffset}
        fontScale={fontScale}
        autoFollow={autoFollow}
        range={dragRange ?? loopRange}
        onAutoFollowChange={setAutoFollow}
        onSeek={onSeek}
        onSpeak={onSpeak}
        onFavorite={onFavorite}
        onDragStart={handleCueDragStart}
        onDragHover={handleCueDragHover}
        onImportSrt={onImportSrt}
        onTranscribe={onTranscribe}
        transcribing={transcribing}
        transcribingLabel={transcribingLabel}
        transcriptionProgress={transcriptionProgress}
        onShowAllSubtitles={() => usePlayerStore.getState().setSubtitleDisplayMode('all')}
        renderText={renderText}
      />
    </aside>
  )
}
