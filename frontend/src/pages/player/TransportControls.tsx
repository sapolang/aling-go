import type { ReactNode } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  CirclePause,
  FastForward,
  Headphones,
  Keyboard,
  Pause,
  Play,
  Repeat,
  Rewind,
  SkipForward,
  Sparkles,
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
  onClick: () => void
  children: ReactNode
}

// 播放控制栏图标按钮：统一 hover / active / disabled 视觉
function PPIconButton({ label, active, disabled, onClick, children }: PPIconButtonProps) {
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

interface TransportControlsProps {
  variant?: 'video' | 'dock'
  /** 与快捷键共用同一动作表 */
  onAction: (action: ShortcutActionId) => void
  onHelp: () => void
  aiActive: boolean
}

/**
 * 播放控制栏：视频时内嵌到画面底部，音频时放在 deck 下方。
 * 所有按钮都转交给动作表执行，不重复实现 HUD 文案与开关判断。
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
  const loopStart = usePlayerStore((s) => s.loopStart)
  const loopEnd = usePlayerStore((s) => s.loopEnd)
  const autoPause = usePlayerStore((s) => s.autoPause)
  const autoNextEpisode = usePlayerStore((s) => s.autoNextEpisode)
  const focusMode = usePlayerStore((s) => s.focusMode)
  const hasSubtitles = usePlayerStore((s) => s.subtitles.length > 0)
  const currentSubtitleIndex = usePlayerStore((s) => s.currentSubtitleIndex)

  return (
    <div className={`pp-transport ${isVideo ? 'pp-transport--video' : ''}`}>
      <PPIconButton
        label="上一句（↑）"
        disabled={!hasSubtitles}
        onClick={() => onAction('prevSentence')}
      >
        <ChevronLeft className="h-4 w-4" />
      </PPIconButton>
      <PPIconButton label="后退 5 秒（←）" onClick={() => onAction('seekBack')}>
        <Rewind className="h-4 w-4" />
      </PPIconButton>
      <button
        type="button"
        className={`pp-play ${isVideo ? 'pp-play--sm' : ''}`}
        title="播放 / 暂停（Space）"
        onClick={() => onAction('playPause')}
      >
        {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
      </button>
      <PPIconButton label="前进 5 秒（→）" onClick={() => onAction('seekForward')}>
        <FastForward className="h-4 w-4" />
      </PPIconButton>
      <PPIconButton
        label="下一句（↓）"
        disabled={!hasSubtitles}
        onClick={() => onAction('nextSentence')}
      >
        <ChevronRight className="h-4 w-4" />
      </PPIconButton>
      <button
        type="button"
        className="pp-rate"
        title="播放速度（P）"
        onClick={() => onAction('rateCycle')}
      >
        {playbackRate}x
      </button>
      <PPIconButton
        label="A/B 循环设点（L）"
        active={loopStart !== null}
        onClick={() => onAction('toggleLoopAB')}
      >
        <Repeat className="h-4 w-4" />
      </PPIconButton>
      {!isVideo && (
        <>
          <PPIconButton
            label={autoPause ? '播完本句自动暂停：开（Q）' : '播完本句自动暂停：关（Q）'}
            active={autoPause}
            onClick={() => onAction('autoPause')}
          >
            <CirclePause className="h-4 w-4" />
          </PPIconButton>
          <PPIconButton
            label={autoNextEpisode ? '自动下一集：开（N）' : '自动下一集：关（N）'}
            active={autoNextEpisode}
            onClick={() => onAction('autoNextEpisode')}
          >
            <SkipForward className="h-4 w-4" />
          </PPIconButton>
          <PPIconButton
            label="专注模式（V）"
            active={focusMode}
            onClick={() => onAction('focusMode')}
          >
            <Headphones className="h-4 w-4" />
          </PPIconButton>
        </>
      )}
      <PPIconButton
        label="AI 翻译 / 详解当前句（T）"
        active={aiActive}
        disabled={currentSubtitleIndex < 0}
        onClick={() => onAction('aiSentence')}
      >
        <Sparkles className="h-4 w-4" />
      </PPIconButton>
      <PPIconButton label={muted ? '取消静音（M）' : '静音（M）'} onClick={() => onAction('mute')}>
        {muted ? <VolumeX className="h-4 w-4" /> : <Speaker className="h-4 w-4" />}
      </PPIconButton>
      {!isVideo && (
        <PPIconButton label="快捷键帮助（?）" onClick={onHelp}>
          <Keyboard className="h-4 w-4" />
        </PPIconButton>
      )}
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
