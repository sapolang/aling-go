import { useRef, useState, type CSSProperties } from 'react'
import { usePlayerStore } from '@/stores/playerStore'
import { useThemeStore } from '@/stores/themeStore'
import Waveform from '@/components/Waveform'
import { formatClockTime } from '@/lib/subtitles'

interface TimelineProps {
  showDeck: boolean
  isYouTube: boolean
}

/** 波形 + 进度条 dock：只订阅时间相关字段，播放时不影响页面其他区域 */
export default function Timeline({ showDeck, isYouTube }: TimelineProps) {
  const played = usePlayerStore((s) => s.played)
  const duration = usePlayerStore((s) => s.duration)
  const subtitleOffset = usePlayerStore((s) => s.subtitleOffset)
  const loopStart = usePlayerStore((s) => s.loopStart)
  const loopEnd = usePlayerStore((s) => s.loopEnd)
  const waveformData = usePlayerStore((s) => s.waveformData)
  const waveformLoading = usePlayerStore((s) => s.waveformLoading)
  const subtitles = usePlayerStore((s) => s.subtitles)
  const focusMode = usePlayerStore((s) => s.focusMode)
  const themeDark = useThemeStore((s) => s.dark)

  // 拖动期间只在本地记录目标位置，松手后才写入 currentTime，避免长时间音频反复回弹
  const [scrubTime, setScrubTime] = useState<number | null>(null)
  const scrubTimeRef = useRef<number | null>(null)

  const setScrub = (value: number | null) => {
    scrubTimeRef.current = value
    setScrubTime(value)
  }

  const commitScrub = () => {
    const value = scrubTimeRef.current
    if (value === null) return
    setScrub(null)
    usePlayerStore.getState().requestSeek(value)
  }

  const displayTime = scrubTime ?? played
  const progressPct = duration > 0 ? Math.min(100, (displayTime / duration) * 100) : 0
  const waveClass = showDeck ? (focusMode ? 'pp-wave--focus' : 'pp-wave--audio') : 'pp-wave--video'

  return (
    <div className="pp-timeline">
      <div className={`pp-wave ${waveClass}`}>
        <div className="pp-wave-grid" aria-hidden="true" />
        <Waveform
          data={waveformData}
          duration={duration}
          currentTime={played - subtitleOffset}
          subtitles={subtitles}
          loading={waveformLoading}
          dark={themeDark}
          loopStart={loopStart !== null ? loopStart - subtitleOffset : null}
          loopEnd={loopEnd !== null ? loopEnd - subtitleOffset : null}
          onSeek={(t) => usePlayerStore.getState().requestSeek(t)}
        />
        {waveformData.length === 0 && (
          <span className="pp-wave-note">
            {waveformLoading
              ? '生成波形…'
              : isYouTube
                ? '在线视频无波形 · 可拖动下方进度条'
                : '暂无波形 · 可拖动下方进度条'}
          </span>
        )}
      </div>
      <div className="pp-time-row">
        <span>{formatClockTime(displayTime)}</span>
        <input
          type="range"
          min={0}
          max={duration || 1}
          value={displayTime}
          onPointerDown={() => setScrub(played)}
          onChange={(e) => {
            const value = parseFloat(e.target.value)
            if (Number.isFinite(value)) setScrub(value)
          }}
          onPointerUp={commitScrub}
          onPointerCancel={commitScrub}
          onLostPointerCapture={commitScrub}
          onKeyUp={commitScrub}
          onBlur={commitScrub}
          className="pp-range"
          style={{ '--pp-progress': `${progressPct}%` } as CSSProperties}
          aria-label="播放进度"
        />
        <span>{formatClockTime(duration)}</span>
      </div>
    </div>
  )
}
