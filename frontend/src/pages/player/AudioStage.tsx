import type { ReactNode } from 'react'
import { Loader2, Pin, PinOff } from 'lucide-react'
import { usePlayerStore } from '@/stores/playerStore'
import type { ShortcutActionId } from '@/stores/shortcutStore'
import { findCueIndexAt } from '@/lib/subtitles'
import { PlayerHud } from '@/components/PlayerHud'
import Waveform from '@/components/Waveform'
import TransportControls from './TransportControls'
import Scrubber from './Scrubber'
import useStageControls from './useStageControls'
import { filterSubtitleText } from './constants'

// 有字幕时靠边展示，无字幕时复用为中央主视觉
function DeckOrbit({ playing }: { playing: boolean }) {
  return (
    <div className="pp-deck-orbit" aria-hidden="true">
      <span className="pp-orbit-ring" />
      <span className="pp-orbit-ring" />
      <span className="pp-orbit-ring" />
      {playing && (
        <>
          <span className="pp-pulse" />
          <span className="pp-pulse pp-pulse--2" />
        </>
      )}
      <span className="pp-orbit-bars">
        <span />
        <span />
        <span />
        <span />
        <span />
      </span>
    </div>
  )
}

interface AudioStageProps {
  isAudio: boolean
  ext: string
  title: string
  filePath: string | null
  converting: boolean
  playError: string | null
  /** 原生媒体实际出声，用于驱动声纹与缓冲提示 */
  deckPlaying: boolean
  onTogglePlay: () => void
  onAction: (action: ShortcutActionId) => void
  onHelp: () => void
  aiActive: boolean
  renderWords: (text: string, sentence: string, keyPrefix: string) => ReactNode
}

/**
 * 音频 / 专注模式舞台：与视频共用同一套深色舞台壳，
 * 中部是当前句，底部是波形 + 进度 + 控制条。
 */
export default function AudioStage({
  isAudio,
  ext,
  title,
  filePath,
  converting,
  playError,
  deckPlaying,
  onTogglePlay,
  onAction,
  onHelp,
  aiActive,
  renderWords,
}: AudioStageProps) {
  const playing = usePlayerStore((s) => s.playing)
  const subtitles = usePlayerStore((s) => s.subtitles)
  const played = usePlayerStore((s) => s.played)
  const duration = usePlayerStore((s) => s.duration)
  const subtitleOffset = usePlayerStore((s) => s.subtitleOffset)
  const displayMode = usePlayerStore((s) => s.subtitleDisplayMode)
  const loopStart = usePlayerStore((s) => s.loopStart)
  const loopEnd = usePlayerStore((s) => s.loopEnd)
  const waveformData = usePlayerStore((s) => s.waveformData)
  const waveformLoading = usePlayerStore((s) => s.waveformLoading)
  const { pinned, controlsShown, showControls, holdControls, scheduleHide, togglePin } =
    useStageControls(playing)

  const idx = findCueIndexAt(subtitles, played - subtitleOffset)
  const activeSub = idx >= 0 ? subtitles[idx] : null
  const deckLoading = playing && !deckPlaying && !playError
  const deckIdleText = deckPlaying
    ? '纯音频播放 · 暂无字幕'
    : playing
      ? '正在缓冲 · 暂无字幕'
      : '已暂停 · 暂无字幕'

  return (
    <div
      className={`pp-stage pp-stage--audio ${deckPlaying ? 'is-playing' : ''}`}
      onMouseMove={showControls}
      onMouseLeave={scheduleHide}
      onClick={onTogglePlay}
    >
      {subtitles.length > 0 && <DeckOrbit playing={deckPlaying} />}
      <div className="pp-deck-body pp-audio-body">
        <div className="pp-deck-top">
          <span className="pp-eyebrow">{isAudio ? '音频精听' : '专注模式'}</span>
          <span className="pp-badge">
            {isAudio ? (ext ? ext.toUpperCase() : 'AUDIO') : 'FOCUS'}
          </span>
        </div>
        <h2 className="pp-deck-title">{title}</h2>
        {converting && <div className="pp-deck-notice">正在转换为可播格式…</div>}
        {playError && (
          <div className="pp-deck-notice pp-deck-notice--error">播放失败：{playError}</div>
        )}
        <div
          className={`pp-deck-sentence ${
            !activeSub && subtitles.length === 0 ? 'pp-deck-sentence--empty' : ''
          }`}
        >
          {activeSub ? (
            renderWords(
              filterSubtitleText(activeSub.text, displayMode),
              activeSub.text,
              `deck-${activeSub.id}`,
            )
          ) : subtitles.length === 0 ? (
            <div className="pp-deck-empty">
              <div className="pp-deck-empty-visual">
                <DeckOrbit playing={deckPlaying} />
              </div>
              <span className="pp-deck-idle">{deckIdleText}</span>
            </div>
          ) : null}
        </div>
      </div>
      {deckLoading && !converting && !playError && (
        <div className="pp-stage-status" aria-live="polite">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>正在缓冲…</span>
        </div>
      )}
      <PlayerHud />
      {filePath && (
        <div
          className={`pp-video-controls transition-opacity duration-200 ${controlsShown ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
          onMouseEnter={holdControls}
          onMouseLeave={scheduleHide}
          onPointerDown={holdControls}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="pp-wave pp-wave--audio">
            <div className="pp-wave-grid" aria-hidden="true" />
            <Waveform
              data={waveformData}
              duration={duration}
              currentTime={played - subtitleOffset}
              subtitles={subtitles}
              loading={waveformLoading}
              dark
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
