import { usePlayerStore } from '@/stores/playerStore'
import { useThemeStore } from '@/stores/themeStore'
import Waveform from '@/components/Waveform'
import Scrubber from './Scrubber'

interface TimelineProps {
  showDeck: boolean
  isYouTube: boolean
}

/**
 * 波形 dock：只订阅时间相关字段，播放时不影响页面其他区域。
 * 视频模式下进度条已经内嵌在画面控制层里，这里只保留波形，避免同一屏出现两条进度条。
 */
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
                ? '在线视频无波形 · 可拖动画面内进度条'
                : '暂无波形 · 可拖动画面内进度条'}
          </span>
        )}
      </div>
      {showDeck && <Scrubber />}
    </div>
  )
}
