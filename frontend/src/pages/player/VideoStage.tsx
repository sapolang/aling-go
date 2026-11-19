import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Loader2, Pin, PinOff } from 'lucide-react'
import { usePlayerStore } from '@/stores/playerStore'
import type { ShortcutActionId } from '@/stores/shortcutStore'
import { findCueIndexAt } from '@/lib/subtitles'
import { PlayerHud } from '@/components/PlayerHud'
import TransportControls from './TransportControls'
import Scrubber from './Scrubber'
import { filterSubtitleText } from './constants'

interface VideoSubtitleOverlayProps {
  controlsShown: boolean
  renderWords: (text: string, sentence: string, keyPrefix: string) => ReactNode
}

// 视频底部悬浮字幕：独立订阅播放进度，避免高频字段影响整个播放页
function VideoSubtitleOverlay({ controlsShown, renderWords }: VideoSubtitleOverlayProps) {
  const played = usePlayerStore((s) => s.played)
  const subtitles = usePlayerStore((s) => s.subtitles)
  const subtitleOffset = usePlayerStore((s) => s.subtitleOffset)
  const displayMode = usePlayerStore((s) => s.subtitleDisplayMode)
  const fontScale = usePlayerStore((s) => s.subtitleFontScale)

  const idx = findCueIndexAt(subtitles, played - subtitleOffset)
  const sub = idx >= 0 ? subtitles[idx] : null
  const text = sub ? filterSubtitleText(sub.text, displayMode) : ''
  if (!sub || !text) return null

  return (
    <div
      className={`pp-sub-overlay ${controlsShown ? '' : 'is-controls-hidden'}`}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="pp-sub-pill" style={{ fontSize: `${1.875 * fontScale}rem` }}>
        {renderWords(text, sub.text, `video-${sub.id}`)}
      </span>
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
  const [pinned, setPinned] = useState(false)
  const [visible, setVisible] = useState(true)
  // 缓冲中状态：原生视频卡顿时给出明确反馈，避免用户以为界面卡死
  const [buffering, setBuffering] = useState(false)
  const pinnedRef = useRef(false)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  const clearTimer = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }

  const showControls = () => {
    setVisible(true)
    clearTimer()
    if (!pinnedRef.current) {
      hideTimerRef.current = setTimeout(() => setVisible(false), 2000)
    }
  }

  // 指针停在控制条上时保持显示，避免 2 秒后按钮在指针下淡出
  const holdControls = () => {
    setVisible(true)
    clearTimer()
  }

  const scheduleHide = () => {
    clearTimer()
    if (!pinnedRef.current && playing) {
      hideTimerRef.current = setTimeout(() => setVisible(false), 2000)
    }
  }

  const togglePin = () => {
    const next = !pinnedRef.current
    pinnedRef.current = next
    setPinned(next)
    if (next) {
      clearTimer()
      setVisible(true)
    } else {
      showControls()
    }
  }

  useEffect(() => clearTimer, [])

  const controlsShown = pinned || !playing || visible

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
      {!hidden && <VideoSubtitleOverlay controlsShown={controlsShown} renderWords={renderWords} />}
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
