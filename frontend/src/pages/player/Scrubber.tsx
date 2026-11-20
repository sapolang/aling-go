import { useRef, useState, type CSSProperties } from 'react'
import { usePlayerStore } from '@/stores/playerStore'
import { formatClockTime } from '@/lib/subtitles'

interface ScrubberProps {
  /** stage：视频画面内嵌的紧凑进度条；dock：波形下方的时间行 */
  variant?: 'dock' | 'stage'
}

/**
 * 进度条与时间码：拖动期间只记录目标位置，松手后才写入 currentTime，
 * 避免长音频拖拽时反复回弹。视频与控制条、音频与波形底栏共用同一实现。
 */
export default function Scrubber({ variant = 'dock' }: ScrubberProps) {
  const played = usePlayerStore((s) => s.played)
  const duration = usePlayerStore((s) => s.duration)

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

  return (
    <div className={`pp-time-row ${variant === 'stage' ? 'pp-time-row--stage' : ''}`}>
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
  )
}
