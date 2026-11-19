import { usePlayerStore } from '@/stores/playerStore'
import { useThemeStore } from '@/stores/themeStore'
import Waveform from '@/components/Waveform'
import Scrubber from './Scrubber'

/**
 * 音频 / 专注模式的波形 dock：视频模式不再渲染它，
 * 进度和波形都收进画面内控制层，避免画面下方重复一条进度条。
 */
export default function Timeline() {
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

  const waveClass = focusMode ? 'pp-wave--focus' : 'pp-wave--audio'

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
            {waveformLoading ? '生成波形…' : '暂无波形 · 可拖动下方进度条'}
          </span>
        )}
      </div>
      <Scrubber />
    </div>
  )
}
