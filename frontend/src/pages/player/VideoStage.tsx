import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { Loader2, Pin, PinOff } from 'lucide-react'
import { usePlayerStore } from '@/stores/playerStore'
import type { ShortcutActionId } from '@/stores/shortcutStore'
import { findCueIndexAt } from '@/lib/subtitles'
import { PlayerHud } from '@/components/PlayerHud'
import TransportControls from './TransportControls'
import Scrubber from './Scrubber'
import useStageControls from './useStageControls'
import { filterSubtitleText } from './constants'

interface VideoSubtitleOverlayProps {
  renderWords: (text: string, sentence: string, keyPrefix: string) => ReactNode
}

// 视频底部悬浮字幕：独立订阅播放进度，避免高频字段影响整个播放页
function VideoSubtitleOverlay({ renderWords }: VideoSubtitleOverlayProps) {
  const played = usePlayerStore((s) => s.played)
  const subtitles = usePlayerStore((s) => s.subtitles)
  const subtitleOffset = usePlayerStore((s) => s.subtitleOffset)
  const displayMode = usePlayerStore((s) => s.subtitleDisplayMode)
  const fontScale = usePlayerStore((s) => s.subtitleFontScale)
  const bandHeight = usePlayerStore((s) => s.subtitleBandHeight)
  const setBandHeight = usePlayerStore((s) => s.setSubtitleBandHeight)
  const idx = findCueIndexAt(subtitles, played - subtitleOffset)
  const sub = idx >= 0 ? subtitles[idx] : null
  const text = sub ? filterSubtitleText(sub.text, displayMode) : ''

  // 拖动过程中只更新本地高度，松手后再落盘，避免高频写 localStorage
  const [dragHeight, setDragHeight] = useState<number | null>(null)
  const dragStartRef = useRef<{ y: number; height: number } | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const pillRef = useRef<HTMLSpanElement>(null)
  // 句子实际高度：遮罩至少要比它高，否则文字会贴边、看起来没居中
  const [contentHeight, setContentHeight] = useState(0)

  useEffect(() => {
    const el = pillRef.current
    if (!el) return
    const update = () => setContentHeight(el.offsetHeight + 32)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
    // 句子变化时重新测量（无字幕句子时 pill 不挂载，遮罩仍保留）
  }, [sub?.id, text, fontScale])

  const startResize = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    // 以当前实际高度为基准，避免句子撑高后拖动出现死区
    dragStartRef.current = { y: e.clientY, height: overlayRef.current?.offsetHeight ?? bandHeight }
  }

  const moveResize = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const start = dragStartRef.current
    if (!start) return
    // 向上拖动增高遮罩，向下拖动收窄
    setDragHeight(Math.round(Math.min(520, Math.max(64, start.height + start.y - e.clientY))))
  }

  const endResize = () => {
    if (dragHeight !== null) setBandHeight(dragHeight)
    dragStartRef.current = null
    setDragHeight(null)
  }

  const overlayHeight = Math.max(dragHeight ?? bandHeight, sub && text ? contentHeight : 0)

  // 整个文件没有字幕时不显示底部遮罩；有了字幕后遮罩常驻，仅文字按句切换
  if (subtitles.length === 0) return null

  return (
    <div
      ref={overlayRef}
      className="pp-sub-overlay"
      style={{
        height: overlayHeight,
        // 内联兜底：确保字幕在遮罩内水平、垂直居中，不受外部样式覆盖影响
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="pp-sub-resizer"
        aria-label="拖动调整字幕遮罩高度"
        title="拖动调整字幕遮罩高度"
        onPointerDown={startResize}
        onPointerMove={moveResize}
        onPointerUp={endResize}
        onPointerCancel={endResize}
      />
      {sub && text && (
        <span
          ref={pillRef}
          className="pp-sub-pill"
          style={{ fontSize: `calc(clamp(20px, 2.4vw, 36px) * ${fontScale})` }}
        >
          {renderWords(text, sub.text, `video-${sub.id}`)}
        </span>
      )}
    </div>
  )
}

interface VideoStageProps {
  /** 音频 deck 或专注模式下隐藏舞台，但媒体元素仍需保留在 DOM 中 */
  hidden: boolean
  filePath: string | null
  title: string
  mediaRef: RefObject<HTMLVideoElement>
  mediaUrl: string
  isYouTube: boolean
  ytIframeRef: RefObject<HTMLIFrameElement>
  ytEmbedUrl: string
  converting: boolean
  playError: string | null
  /** 播放中时间冻结超过 8 秒 */
  stalled: boolean
  onRetryPlayback: () => void
  onTranscode: () => void
  onTogglePlay: () => void
  onAction: (action: ShortcutActionId) => void
  onHelp: () => void
  aiActive: boolean
  renderWords: VideoSubtitleOverlayProps['renderWords']
}

/** 视频舞台：媒体元素、悬浮字幕、播放错误与可自动淡出的内嵌控制条 */
export default function VideoStage({
  hidden,
  filePath,
  title,
  mediaRef,
  mediaUrl,
  isYouTube,
  ytIframeRef,
  ytEmbedUrl,
  converting,
  playError,
  stalled,
  onRetryPlayback,
  onTranscode,
  onTogglePlay,
  onAction,
  onHelp,
  aiActive,
  renderWords,
}: VideoStageProps) {
  const playing = usePlayerStore((s) => s.playing)
  const sourceKind = usePlayerStore((s) => s.sourceKind)
  // 缓冲中状态：原生视频卡顿时给出明确反馈，避免用户以为界面卡死
  const [buffering, setBuffering] = useState(false)
  const { pinned, controlsShown, showControls, holdControls, scheduleHide, togglePin } =
    useStageControls(playing)

  const canOpenExternal = !!filePath && /^https?:\/\//i.test(filePath)
  const canTranscode = sourceKind === 'html5' && !!filePath && !/^https?:\/\//i.test(filePath)

  useEffect(() => {
    const el = mediaRef.current
    if (!el || isYouTube || hidden) {
      setBuffering(false)
      return
    }
    const onWaiting = () => setBuffering(true)
    const onReady = () => setBuffering(false)
    el.addEventListener('waiting', onWaiting)
    el.addEventListener('playing', onReady)
    el.addEventListener('canplay', onReady)
    el.addEventListener('pause', onReady)
    return () => {
      el.removeEventListener('waiting', onWaiting)
      el.removeEventListener('playing', onReady)
      el.removeEventListener('canplay', onReady)
      el.removeEventListener('pause', onReady)
    }
  }, [filePath, hidden, isYouTube, mediaRef])

  return (
    <div
      className={hidden ? 'pp-media-hidden' : 'pp-stage'}
      onMouseMove={hidden ? undefined : showControls}
      onMouseLeave={hidden ? undefined : scheduleHide}
      onClick={hidden ? undefined : onTogglePlay}
    >
      {isYouTube ? (
        <>
          <iframe
            ref={ytIframeRef}
            src={ytEmbedUrl}
            title={title || 'YouTube'}
            className="pp-yt-frame"
            allow="autoplay; encrypted-media; picture-in-picture"
          />
          {/* 跨域 iframe 会吞掉鼠标事件，用透明层承接播放点击与控制条唤出 */}
          <div className="pp-yt-hit" aria-hidden="true" />
        </>
      ) : (
        <video ref={mediaRef} src={mediaUrl} className="pp-video-el" playsInline />
      )}
      {!hidden && <VideoSubtitleOverlay renderWords={renderWords} />}
      {!hidden && buffering && !stalled && !playError && !converting && (
        <div className="pp-stage-status" aria-live="polite">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>正在缓冲…</span>
        </div>
      )}
      {!hidden && stalled && !playError && !converting && (
        <div className="pp-stage-status is-warning" role="status">
          <span>播放好像卡住了</span>
          <button type="button" className="pp-play-error-btn" onClick={onRetryPlayback}>
            重新加载
          </button>
        </div>
      )}
      {!hidden && converting && (
        <div className="pp-stage-status" aria-live="polite">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>正在转换为可播格式…</span>
        </div>
      )}
      {!hidden && playError && (
        <div className="pp-play-error" onClick={(e) => e.stopPropagation()}>
          <div className="pp-play-error-card">
            <p className="pp-play-error-title">播放失败</p>
            <p className="pp-play-error-detail">{playError}</p>
            <div className="pp-play-error-actions">
              <button type="button" className="pp-play-error-btn" onClick={onRetryPlayback}>
                重新加载
              </button>
              {canTranscode && (
                <button type="button" className="pp-play-error-btn" onClick={onTranscode}>
                  转码后播放
                </button>
              )}
              {canOpenExternal && filePath && (
                <button
                  type="button"
                  className="pp-play-error-btn"
                  onClick={() => void window.api.openExternal(filePath)}
                >
                  在浏览器打开
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {!hidden && <PlayerHud />}
      {!hidden && filePath && (
        <div
          className={`pp-video-controls transition-opacity duration-200 ${controlsShown ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          onMouseEnter={holdControls}
          onMouseLeave={scheduleHide}
          onPointerDown={holdControls}
          onClick={(e) => e.stopPropagation()}
        >
          <Scrubber variant="stage" />
          <TransportControls
            variant="video"
            onAction={onAction}
            onHelp={onHelp}
            aiActive={aiActive}
          />
          <button
            type="button"
            className="pp-pin"
            title={pinned ? '取消固定控制条' : '固定控制条'}
            aria-label={pinned ? '取消固定控制条' : '固定控制条'}
            onClick={(e) => {
              e.stopPropagation()
              togglePin()
            }}
          >
            {pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
          </button>
        </div>
      )}
    </div>
  )
}
