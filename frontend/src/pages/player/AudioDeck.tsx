import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react'
import { usePlayerStore } from '@/stores/playerStore'
import type { ShortcutActionId } from '@/stores/shortcutStore'
import { findCueIndexAt } from '@/lib/subtitles'
import { PlayerHud } from '@/components/PlayerHud'
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

interface AudioDeckProps {
  isAudio: boolean
  ext: string
  title: string
  converting: boolean
  playError: string | null
  /** 原生媒体实际出声，用于驱动声纹与缓冲提示 */
  deckPlaying: boolean
  onTogglePlay: () => void
  onAction: (action: ShortcutActionId) => void
  renderWords: (text: string, sentence: string, keyPrefix: string) => ReactNode
}

/** 音频 / 专注模式的 deck：大号当前句 + 圆形播放键 + 上下句切换 */
export default function AudioDeck({
  isAudio,
  ext,
  title,
  converting,
  playError,
  deckPlaying,
  onTogglePlay,
  onAction,
  renderWords,
}: AudioDeckProps) {
  const playing = usePlayerStore((s) => s.playing)
  const subtitles = usePlayerStore((s) => s.subtitles)
  const played = usePlayerStore((s) => s.played)
  const subtitleOffset = usePlayerStore((s) => s.subtitleOffset)
  const displayMode = usePlayerStore((s) => s.subtitleDisplayMode)

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
      className={`pp-deck ${deckPlaying ? 'is-playing' : ''} ${deckLoading ? 'is-loading' : ''}`}
      onClick={onTogglePlay}
    >
      {subtitles.length > 0 && <DeckOrbit playing={deckPlaying} />}
      <div className="pp-deck-body">
        <div className="pp-deck-top">
          <span className="pp-eyebrow">{isAudio ? 'Audio session' : 'Focus session'}</span>
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
        <div className="pp-deck-foot">
          <button
            type="button"
            className="pp-play pp-play--lg"
            title="播放 / 暂停（Space）"
            onClick={(e) => {
              e.stopPropagation()
              onTogglePlay()
            }}
          >
            {playing ? <Pause className="h-7 w-7" /> : <Play className="h-7 w-7" />}
          </button>
          <span
            onClick={(e) => e.stopPropagation()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}
          >
            <button
              type="button"
              className="pp-icon-btn"
              title="上一句（↑）"
              aria-label="上一句（↑）"
              disabled={subtitles.length === 0}
              onClick={() => onAction('prevSentence')}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="pp-icon-btn"
              title="下一句（↓）"
              aria-label="下一句（↓）"
              disabled={subtitles.length === 0}
              onClick={() => onAction('nextSentence')}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </span>
          <span className="pp-deck-hint">Space 播放 / 暂停 · ← → 快退快进</span>
        </div>
      </div>
      <PlayerHud />
    </div>
  )
}
