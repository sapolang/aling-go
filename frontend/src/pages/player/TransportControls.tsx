import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Window } from '@wailsio/runtime'
import {
  AudioLines,
  ChevronLeft,
  ChevronRight,
  CirclePause,
  FastForward,
  Gauge,
  Headphones,
  Keyboard,
  Maximize,
  Minimize,
  MoreHorizontal,
  Pause,
  Play,
  Repeat,
  Rewind,
  RotateCcw,
  SkipForward,
  Sparkles,
  Star,
  Volume2 as Speaker,
  VolumeX,
  X as XIcon,
} from 'lucide-react'
import { usePlayerStore } from '@/stores/playerStore'
import type { ShortcutActionId } from '@/stores/shortcutStore'
import { formatClockTime } from '@/lib/subtitles'

interface PPIconButtonProps {
  label: string
  active?: boolean
  disabled?: boolean
  expanded?: boolean
  onClick: () => void
  children: ReactNode
}

// 播放控制栏图标按钮：统一 hover / active / disabled 视觉
function PPIconButton({ label, active, disabled, expanded, onClick, children }: PPIconButtonProps) {
  return (
    <button
      type="button"
      className={`pp-icon-btn ${active ? 'is-active' : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      aria-expanded={expanded}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

interface PPToolItemProps {
  label: string
  icon: ReactNode
  active?: boolean
  disabled?: boolean
  onClick: () => void
}

// 「更多」浮层里的功能项：图标 + 文案，开关态用高亮表达
function PPToolItem({ label, icon, active, disabled, onClick }: PPToolItemProps) {
  return (
    <button
      type="button"
      className={`pp-tool ${active ? 'is-active' : ''}`}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

interface TransportControlsProps {
  variant?: 'video' | 'dock'
  /** 与快捷键共用同一动作表 */
  onAction: (action: ShortcutActionId) => void
  onHelp: () => void
  aiActive: boolean
}

/**
 * 播放控制栏：视频时内嵌到画面底部，音频时放在 deck 下方。
 * 只常显「上一句 / 播放 / 下一句」，其余动作收进「更多」浮层，避免一排同权重图标。
 */
export default function TransportControls({
  variant = 'dock',
  onAction,
  onHelp,
  aiActive,
}: TransportControlsProps) {
  const isVideo = variant === 'video'
  const playing = usePlayerStore((s) => s.playing)
  const playbackRate = usePlayerStore((s) => s.playbackRate)
  const muted = usePlayerStore((s) => s.muted)
  const volume = usePlayerStore((s) => s.volume)
  const loopStart = usePlayerStore((s) => s.loopStart)
  const loopEnd = usePlayerStore((s) => s.loopEnd)
  const autoPause = usePlayerStore((s) => s.autoPause)
  const autoNextEpisode = usePlayerStore((s) => s.autoNextEpisode)
  const focusMode = usePlayerStore((s) => s.focusMode)
  const hasSubtitles = usePlayerStore((s) => s.subtitles.length > 0)
  const currentSubtitleIndex = usePlayerStore((s) => s.currentSubtitleIndex)

  const [showMore, setShowMore] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)

  // 全屏状态同时可能被快捷键、系统绿灯按钮改变，监听窗口尺寸变化后重新同步
  useEffect(() => {
    const sync = () => {
      Window.IsFullscreen()
        .then(setFullscreen)
        .catch(() => {})
    }
    sync()
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [])

  useEffect(() => {
    if (!showMore) return
    const onPointerDown = (e: MouseEvent) => {
      if (moreRef.current?.contains(e.target as Node)) return
      setShowMore(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowMore(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [showMore])

  const run = (action: ShortcutActionId) => () => onAction(action)

  return (
    <div className={`pp-transport ${isVideo ? 'pp-transport--video' : ''}`}>
      <PPIconButton
        label="上一句（↑）"
        disabled={!hasSubtitles}
        onClick={() => onAction('prevSentence')}
      >
        <ChevronLeft className="h-4 w-4" />
      </PPIconButton>
      <button
        type="button"
        className={`pp-play ${isVideo ? 'pp-play--sm' : ''}`}
        title="播放 / 暂停（Space）"
        aria-label="播放 / 暂停"
        onClick={() => onAction('playPause')}
      >
        {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
      </button>
      <PPIconButton
        label="下一句（↓）"
        disabled={!hasSubtitles}
        onClick={() => onAction('nextSentence')}
      >
        <ChevronRight className="h-4 w-4" />
      </PPIconButton>

      <div className="pp-more-wrap" ref={moreRef}>
        <PPIconButton
          label="更多控制"
          active={showMore}
          expanded={showMore}
          onClick={() => setShowMore((v) => !v)}
        >
          <MoreHorizontal className="h-4 w-4" />
        </PPIconButton>
        {showMore && (
          <div className="pp-more-panel" role="group" aria-label="更多播放控制">
            <div className="pp-more-volume">
              <button
                type="button"
                className="pp-icon-btn"
                title={muted ? '取消静音' : '静音'}
                aria-label={muted ? '取消静音' : '静音'}
                aria-pressed={muted}
                onClick={run('mute')}
              >
                {muted || volume === 0 ? (
                  <VolumeX className="h-4 w-4" />
                ) : (
                  <Speaker className="h-4 w-4" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round((muted ? 0 : volume) * 100)}
                onChange={(e) => usePlayerStore.getState().setVolume(Number(e.target.value) / 100)}
                className="pp-volume-range"
                style={
                  {
                    '--pp-progress': `${(muted ? 0 : volume) * 100}%`,
                  } as CSSProperties
                }
                aria-label="音量"
              />
              <span className="pp-volume-value">{Math.round((muted ? 0 : volume) * 100)}</span>
            </div>
            <div className="pp-more-grid">
              <PPToolItem
                label="后退 5 秒"
                icon={<Rewind className="h-3.5 w-3.5" />}
                onClick={run('seekBack')}
              />
              <PPToolItem
                label="前进 5 秒"
                icon={<FastForward className="h-3.5 w-3.5" />}
                onClick={run('seekForward')}
              />
              <PPToolItem
                label={`倍速 ${playbackRate}x`}
                icon={<Gauge className="h-3.5 w-3.5" />}
                onClick={run('rateCycle')}
              />
              <PPToolItem
                label="A/B 循环"
                icon={<Repeat className="h-3.5 w-3.5" />}
                active={loopStart !== null}
                onClick={run('toggleLoopAB')}
              />
              {!isVideo && (
                <>
                  <PPToolItem
                    label="自动暂停"
                    icon={<CirclePause className="h-3.5 w-3.5" />}
                    active={autoPause}
                    onClick={run('autoPause')}
                  />
                  <PPToolItem
                    label="自动下一集"
                    icon={<SkipForward className="h-3.5 w-3.5" />}
                    active={autoNextEpisode}
                    onClick={run('autoNextEpisode')}
                  />
                  <PPToolItem
                    label="专注模式"
                    icon={<Headphones className="h-3.5 w-3.5" />}
                    active={focusMode}
                    onClick={run('focusMode')}
                  />
                </>
              )}
              <PPToolItem
                label="重播当前句"
                icon={<RotateCcw className="h-3.5 w-3.5" />}
                disabled={!hasSubtitles}
                onClick={run('replaySentence')}
              />
              <PPToolItem
                label="朗读当前句"
                icon={<AudioLines className="h-3.5 w-3.5" />}
                disabled={!hasSubtitles}
                onClick={run('speakSentence')}
              />
              <PPToolItem
                label="收藏当前句"
                icon={<Star className="h-3.5 w-3.5" />}
                disabled={!hasSubtitles}
                onClick={run('favoriteSentence')}
              />
              <PPToolItem
                label="AI 详解"
                icon={<Sparkles className="h-3.5 w-3.5" />}
                active={aiActive}
                disabled={currentSubtitleIndex < 0}
                onClick={run('aiSentence')}
              />
              {!isVideo && (
                <PPToolItem
                  label="快捷键"
                  icon={<Keyboard className="h-3.5 w-3.5" />}
                  onClick={onHelp}
                />
              )}
            </div>
          </div>
        )}
      </div>

      <PPIconButton
        label={fullscreen ? '退出全屏（F）' : '全屏（F）'}
        active={fullscreen}
        onClick={() => onAction('toggleFullscreen')}
      >
        {fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
      </PPIconButton>

      {loopStart !== null && (
        <span className="pp-loop-readout">
          A {formatClockTime(loopStart)}
          {loopEnd !== null ? ` · B ${formatClockTime(loopEnd)}` : ''}
          <button
            type="button"
            className="pp-loop-clear"
            title="清除循环区间"
            onClick={() => usePlayerStore.getState().setLoop(null, null)}
          >
            <XIcon className="h-3 w-3" />
          </button>
        </span>
      )}
    </div>
  )
}
