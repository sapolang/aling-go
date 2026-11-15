import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { usePlayerStore } from '@/stores/playerStore'
import { useWordStore } from '@/stores/wordStore'
import type { ShortcutActionId } from '@/stores/shortcutStore'
import type { SubtitleCue, SubtitleListHandle } from '@/components/SubtitleList'
import { showToast } from '@/components/feedback'
import WordHoverCard from '@/components/WordHoverCard'
import WordLookupModal from '@/components/WordLookupModal'
import { basename } from '@/utils/path'
import { speak } from '@/lib/tts'
import { extOf } from '@/lib/mediaFormats'
import { loadSrtFile, openLocalMedia } from '@/lib/openMedia'
import { formatClockTime } from '@/lib/subtitles'
import { useYouTubeEngine } from '@/hooks/useYouTubeEngine'
import { ArrowLeft, AudioLines, Keyboard, Loader2, Subtitles } from 'lucide-react'
import TransportControls from './player/TransportControls'
import VideoStage from './player/VideoStage'
import AudioDeck from './player/AudioDeck'
import Timeline from './player/Timeline'
import TranscriptPanel from './player/TranscriptPanel'
import AISentencePanel from './player/AISentencePanel'
import ShortcutHelpDialog from './player/ShortcutHelpDialog'
import FavoriteDialog from './player/FavoriteDialog'
import { useMediaElement } from './player/useMediaElement'
import { useWordHover } from './player/useWordHover'
import { usePlaybackHistory } from './player/usePlaybackHistory'
import { usePlaybackShortcuts } from './player/usePlaybackShortcuts'
import { useAIPanel } from './player/useAIPanel'
import { useFavoriteDialog } from './player/useFavoriteDialog'
import { exportSubtitles, findNextEpisode, startTranscription } from './player/mediaOps'
import { ROUTE_LABELS, filterSubtitleText, resolveIsAudio } from './player/constants'
import { runPlayerAction, type PlayerActionContext, type PlayerActionUI } from './player/actions'
import './Player.css'

export default function PlayerPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const isActive = location.pathname === '/player'
  // 返回目标：进入播放页时记录的来源页面，直接打开播放页时退回文件库
  const fromPath = (location.state as { from?: string } | null)?.from
  const backTarget = fromPath && fromPath !== '/player' ? fromPath : '/'
  const backLabel =
    ROUTE_LABELS[backTarget] ||
    ROUTE_LABELS[backTarget.split('/').slice(0, 2).join('/')] ||
    '上一页'

  // 播放源元信息：变化频率低，统一用字段 selector 订阅，避免播放进度触发整页重渲染
  const filePath = usePlayerStore((s) => s.filePath)
  const sourceKind = usePlayerStore((s) => s.sourceKind)
  const mediaKind = usePlayerStore((s) => s.mediaKind)
  const mediaTitle = usePlayerStore((s) => s.mediaTitle)
  const mediaEpisodeID = usePlayerStore((s) => s.mediaEpisodeID)
  const historyKeyState = usePlayerStore((s) => s.historyKey)
  const playSession = usePlayerStore((s) => s.playSession)
  const playing = usePlayerStore((s) => s.playing)
  const duration = usePlayerStore((s) => s.duration)
  const subtitleOffset = usePlayerStore((s) => s.subtitleOffset)
  const focusMode = usePlayerStore((s) => s.focusMode)
  const subtitles = usePlayerStore((s) => s.subtitles)
  const subtitleDisplayMode = usePlayerStore((s) => s.subtitleDisplayMode)
  const transcribing = usePlayerStore((s) => s.transcribing)
  const transcriptionProgress = usePlayerStore((s) => s.transcriptionProgress)

  const [showShortcutHelp, setShowShortcutHelp] = useState(false)
  const [transcribingLabel, setTranscribingLabel] = useState('')
  const [mediaPort, setMediaPort] = useState(0)
  const subtitleListRef = useRef<SubtitleListHandle>(null)
  const dragStateRef = useRef({ active: false, anchor: -1, current: -1 })

  const isAudio = resolveIsAudio(filePath, mediaKind)
  const ext = extOf(filePath || '')
  const title = mediaTitle || (filePath ? basename(filePath) : '')
  const historyKey = historyKeyState || filePath || ''

  // YouTube 源：iframe 通过 /yt-embed 中转页播放，时间轴由 postMessage 回写 store
  const youtubeId = sourceKind === 'youtube' ? (filePath || '').replace(/^yt:/, '') : ''
  const isYouTube = sourceKind === 'youtube' && !!youtubeId
  const { iframeRef: ytIframeRef, embedUrl: ytEmbedUrl } = useYouTubeEngine(
    isYouTube,
    youtubeId,
    mediaPort,
  )

  const handleEnded = () => {
    const st = usePlayerStore.getState()
    const endedPath = st.filePath
    if (!st.autoNextEpisode || !endedPath) return
    void findNextEpisode(endedPath).then((next) => {
      // 等待期间用户可能已手动切换文件
      if (next && usePlayerStore.getState().filePath === endedPath) void openLocalMedia(next)
    })
  }

  const { mediaRef, playError, converting, fallbackPath, activeMediaPath, clearPlayError } =
    useMediaElement({ filePath, onEnded: handleEnded })

  // 生词库词表：已收藏的词在字幕中高亮显示
  const savedWordList = useWordStore((s) => s.words)
  const loadWords = useWordStore((s) => s.loadWords)
  const savedWords = useMemo(
    () => new Set(savedWordList.map((w) => w.word.toLowerCase())),
    [savedWordList],
  )
  useEffect(() => {
    void loadWords()
  }, [loadWords])

  // 生词高亮判定：词形大小写与所有格统一归一化后再比较
  const isSavedWord = useCallback(
    (part: string) => {
      let clean = part.toLowerCase().replace(/[^a-z0-9\-']/g, '')
      if (clean.endsWith("'s")) clean = clean.slice(0, -2)
      return clean.length > 1 && savedWords.has(clean)
    },
    [savedWords],
  )

  const hover = useWordHover({
    mediaRef,
    isSavedWord,
    dragState: dragStateRef,
  })
  const ai = useAIPanel()
  const favorite = useFavoriteDialog()
  usePlaybackHistory(historyKey, playSession, playing)

  // 悬停词通过 ref 读取，保持回调引用稳定，配合字幕行的 memo
  const hoverRef = useRef(hover.hover)
  useEffect(() => {
    hoverRef.current = hover.hover
  })
  const requestSeek = useCallback((time: number) => {
    usePlayerStore.getState().requestSeek(time)
  }, [])
  const openFavoriteCue = useCallback(
    (cue: SubtitleCue) => {
      const h = hoverRef.current
      favorite.open(cue, h?.sentence === cue.text ? h.word : '')
    },
    [favorite.open],
  )

  useEffect(() => {
    window.api.getMediaPort().then(setMediaPort)
  }, [])

  // 显示用字幕条数：按当前显示模式过滤后统计，与字幕面板保持一致
  const displayCount = useMemo(
    () =>
      subtitles.reduce(
        (n, s) => n + (filterSubtitleText(s.text, subtitleDisplayMode).length > 0 ? 1 : 0),
        0,
      ),
    [subtitles, subtitleDisplayMode],
  )

  const mediaUrl = !filePath
    ? ''
    : sourceKind === 'youtube'
      ? ''
      : sourceKind === 'bilibili'
        ? filePath
        : /^https?:\/\//i.test(filePath)
          ? filePath.startsWith('https://') || !mediaEpisodeID || !mediaPort
            ? filePath
            : `http://127.0.0.1:${mediaPort}/podcast-stream?id=${mediaEpisodeID}`
          : mediaPort
            ? `http://127.0.0.1:${mediaPort}/media/${encodeURIComponent(fallbackPath || filePath)}`
            : ''

  // 动作表依赖的上下文与 UI 回调通过 ref 同步，保持 runAction 引用稳定
  const actionCtxRef = useRef<PlayerActionContext>({
    getTime: () => 0,
    getDuration: () => 0,
    seekTo: () => {},
    resetHoverPause: () => {},
    hasAITarget: () => false,
  })
  const actionUIRef = useRef<PlayerActionUI>({
    openFavorite: () => {},
    openShortcutHelp: () => {},
    toggleAIPanel: () => {},
  })
  useEffect(() => {
    actionCtxRef.current = {
      getTime: () => {
        const el = mediaRef.current
        return el ? el.currentTime : usePlayerStore.getState().played
      },
      getDuration: () => {
        const el = mediaRef.current
        return el?.duration || usePlayerStore.getState().duration || 0
      },
      seekTo: (time) => {
        const st = usePlayerStore.getState()
        const el = mediaRef.current
        if (el) el.currentTime = time
        else st.requestSeek(time)
        st.setPlayed(time)
      },
      resetHoverPause: hover.resetHoverPause,
      hasAITarget: () => !!ai.aiTarget,
    }
    actionUIRef.current = {
      openFavorite: (sub) => favorite.open(sub),
      openShortcutHelp: () => setShowShortcutHelp(true),
      toggleAIPanel: (sub) => ai.toggleForSubtitle(sub),
    }
  })

  const runAction = useMemo(
    () => (action: ShortcutActionId) => {
      runPlayerAction(action, actionCtxRef.current, actionUIRef.current)
    },
    [],
  )

  usePlaybackShortcuts({
    active: isActive,
    isBlocked: () =>
      !!(
        showShortcutHelp ||
        hover.showLookup ||
        ai.aiTarget ||
        ai.aiTranslate ||
        ai.aiExplain ||
        favorite.target
      ),
    closeTopLayer: () => {
      if (showShortcutHelp) {
        setShowShortcutHelp(false)
        return true
      }
      if (hover.showLookup) {
        hover.closeLookup()
        return true
      }
      if (ai.aiExplain) {
        ai.dismissExplain()
        return true
      }
      if (ai.aiTranslate) {
        ai.dismissTranslate()
        return true
      }
      if (favorite.target) {
        favorite.close()
        return true
      }
      if (ai.aiTarget) {
        ai.closeTarget()
        return true
      }
      return false
    },
    run: runAction,
    openHelp: () => setShowShortcutHelp(true),
  })

  const openMediaFile = async (path: string) => {
    clearPlayError()
    await openLocalMedia(path)
  }

  const handleOpenFile = async () => {
    const picked = await window.api.openFile()
    if (picked) void openMediaFile(picked)
  }

  const handleLoadSrt = async () => {
    const path = await window.api.openSubtitle()
    if (path) await loadSrtFile(path)
  }

  const transcribe = () => {
    if (!filePath) return
    if (transcribing) {
      showToast('正在转录中，请稍候', 'info')
      return
    }
    void startTranscription(filePath, { setLabel: setTranscribingLabel })
  }

  const togglePlay = () => runAction('playPause')

  const showDeck = isAudio || focusMode
  const deckPlaying = playing && (isYouTube || (!!filePath && activeMediaPath === filePath))

  return (
    <div className={isActive ? 'pp-root' : 'hidden'}>
      <div className="pp-shell">
        <header className="pp-topbar">
          <div className="pp-topbar-left">
            <button
              type="button"
              className="pp-back"
              onClick={() => navigate(backTarget)}
              title={`返回${backLabel}`}
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="pp-heading">
              <span className="pp-eyebrow">
                {filePath ? `Now playing · ${isAudio ? 'Audio' : 'Video'}` : 'Player'}
              </span>
              <h1 className="pp-title">{filePath ? title : '选择一段素材开始'}</h1>
              {filePath && (
                <div className="pp-meta">
                  <span>{isAudio ? 'Audio' : 'Video'}</span>
                  {duration > 0 && (
                    <>
                      <span className="pp-meta-dot">·</span>
                      <span>{formatClockTime(duration)}</span>
                    </>
                  )}
                  {displayCount > 0 && (
                    <>
                      <span className="pp-meta-dot">·</span>
                      <span>{displayCount} sentences</span>
                    </>
                  )}
                  {subtitleOffset !== 0 && (
                    <>
                      <span className="pp-meta-dot">·</span>
                      <span>offset {subtitleOffset.toFixed(1)}s</span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="pp-top-actions">
            {filePath && (
              <button
                type="button"
                className="pp-ghost-btn"
                onClick={handleLoadSrt}
                title="加载 SRT 字幕"
              >
                <Subtitles />
                <span>字幕</span>
              </button>
            )}
            <button
              type="button"
              className="pp-ghost-btn"
              onClick={() => setShowShortcutHelp(true)}
              title="快捷键帮助"
            >
              <Keyboard />
              <span>快捷键</span>
            </button>
          </div>
        </header>

        {filePath ? (
          <div className="pp-main">
            <section className="pp-left">
              <VideoStage
                hidden={showDeck}
                filePath={filePath}
                title={title}
                mediaRef={mediaRef}
                mediaUrl={mediaUrl}
                isYouTube={isYouTube}
                ytIframeRef={ytIframeRef}
                ytEmbedUrl={ytEmbedUrl}
                converting={converting}
                playError={playError}
                onTogglePlay={togglePlay}
                onAction={runAction}
                onHelp={() => setShowShortcutHelp(true)}
                aiActive={!!ai.aiTarget}
                renderWords={hover.renderWords}
              />

              {showDeck && (
                <AudioDeck
                  isAudio={isAudio}
                  ext={ext}
                  title={title}
                  converting={converting}
                  playError={playError}
                  deckPlaying={deckPlaying}
                  onTogglePlay={togglePlay}
                  onAction={runAction}
                  renderWords={hover.renderWords}
                />
              )}

              <Timeline showDeck={showDeck} isYouTube={isYouTube} />

              {showDeck && (
                <div className="pp-dock">
                  <TransportControls
                    variant="dock"
                    onAction={runAction}
                    onHelp={() => setShowShortcutHelp(true)}
                    aiActive={!!ai.aiTarget}
                  />
                </div>
              )}

              {transcribing && transcriptionProgress >= 0 && (
                <div className="pp-transcribing">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>
                    Whisper {transcribingLabel} {transcriptionProgress}%
                  </span>
                  <div className="pp-transcribing-track">
                    <div
                      className="pp-transcribing-fill"
                      style={{ width: `${transcriptionProgress}%` }}
                    />
                  </div>
                </div>
              )}
            </section>

            <TranscriptPanel
              listRef={subtitleListRef}
              dragStateRef={dragStateRef}
              onSeek={requestSeek}
              onSpeak={speak}
              onFavorite={openFavoriteCue}
              onCancelHover={() => {
                hover.resetHoverPause()
                hover.cancelHover()
              }}
              onImportSrt={() => void handleLoadSrt()}
              onTranscribe={transcribe}
              onExport={() => void exportSubtitles()}
              onRetranscribe={transcribe}
              renderWords={hover.renderWords}
            />
          </div>
        ) : (
          <div className="pp-empty">
            <div className="pp-empty-card">
              <div className="pp-empty-icon">
                <AudioLines className="h-7 w-7" />
              </div>
              <h2 className="pp-empty-title">播放器空闲</h2>
              <p className="pp-empty-text">
                打开本地视频或音频，或从文件库选择一条素材，开始精听。
              </p>
              <div className="pp-empty-actions">
                <button type="button" className="pp-primary-btn" onClick={handleOpenFile}>
                  选择文件
                </button>
                <button type="button" className="pp-ghost-btn" onClick={() => navigate(backTarget)}>
                  返回{backLabel}
                </button>
              </div>
            </div>
          </div>
        )}

        {hover.hover && (
          <WordHoverCard
            word={hover.hover.word}
            sentence={hover.hover.sentence}
            anchor={hover.hover.anchor}
            onMouseEnter={hover.keepHover}
            onMouseLeave={hover.scheduleHideHover}
            onAdded={loadWords}
          />
        )}

        {hover.showLookup && hover.selectedWord && (
          <WordLookupModal
            word={hover.selectedWord}
            sentence={hover.currentSentence}
            onClose={() => {
              hover.closeLookup()
              void loadWords()
            }}
          />
        )}

        <AISentencePanel
          aiTarget={ai.aiTarget}
          aiTranslate={ai.aiTranslate}
          aiExplain={ai.aiExplain}
          onTranslate={() => void ai.translate()}
          onExplain={() => void ai.explain()}
          onCloseTarget={ai.closeTarget}
          onDismissExplain={ai.dismissExplain}
        />

        <ShortcutHelpDialog open={showShortcutHelp} onClose={() => setShowShortcutHelp(false)} />

        <FavoriteDialog dialog={favorite} filePath={filePath} />
      </div>
    </div>
  )
}
