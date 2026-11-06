import { useState, useRef, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { usePlayerStore } from '@/stores/playerStore'
import { useThemeStore } from '@/stores/themeStore'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { speak } from '@/lib/tts'
import Waveform from '@/components/Waveform'
import WordLookupModal from '@/components/WordLookupModal'
import {
  Play,
  Pause,
  Repeat,
  Subtitles,
  Loader2,
  Volume2 as Speaker,
  MoreHorizontal,
  Download,
  RotateCcw,
  X as XIcon,
  FileDown,
  ArrowLeft,
  Globe,
  Star,
} from 'lucide-react'
import SrtParser from 'srt-parser-2'
import { timeToSeconds } from '@/lib/srt'

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]

export default function PlayerPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const isActive = location.pathname === '/player'
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const store = usePlayerStore()
  const dark = useThemeStore((s) => s.dark)
  const [selectedWord, setSelectedWord] = useState('')
  const [currentSentence, setCurrentSentence] = useState('')
  const [showLookup, setShowLookup] = useState(false)
  const [playError, setPlayError] = useState<string | null>(null)
  const [showSubMenu, setShowSubMenu] = useState(false)
  const [transcribingLabel, setTranscribingLabel] = useState('')
  const [mediaPort, setMediaPort] = useState(0)
  const [showTranscribeLangModal, setShowTranscribeLangModal] = useState(false)
  const [transcribeLang, setTranscribeLang] = useState('auto')
  const [favTarget, setFavTarget] = useState<{
    startTime: number
    endTime: number
    text: string
  } | null>(null)
  const [favTags, setFavTags] = useState<{ id: number; name: string }[]>([])
  const [favTagId, setFavTagId] = useState(0)
  const [favNewTag, setFavNewTag] = useState('')

  const ext = store.filePath?.toLowerCase().match(/\.(\w+)$/)?.[1]
  const isAudio = ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac'].includes(ext || '')

  useEffect(() => {
    window.api.getWhisperLang().then(setTranscribeLang)
  }, [])

  // --- Refs for event handlers (avoid stale closures) ---
  const onTimeUpdateRef = useRef<() => void>(() => {})
  const onMetaRef = useRef<() => void>(() => {})
  const lastPosSaveRef = useRef(0)
  const resumedForRef = useRef('')

  onTimeUpdateRef.current = () => {
    const el = mediaRef.current
    if (!el) return
    store.setPlayed(el.currentTime)
    store.setPlaying(!el.paused)
    // 字幕匹配使用偏移后的时间：offset>0 表示字幕整体延后
    const t = el.currentTime - store.subtitleOffset
    const idx = store.subtitles.findIndex((s) => t >= s.startTime - 0.08 && t <= s.endTime)
    if (idx !== -1) store.setCurrentSubtitleIndex(idx)
    if (store.loopEnd && el.currentTime >= store.loopEnd) {
      el.currentTime = store.loopStart || 0
    }
    // 每 5s 节流保存播放位置
    if (store.filePath && Math.abs(el.currentTime - lastPosSaveRef.current) >= 5) {
      lastPosSaveRef.current = el.currentTime
      window.api.recentUpdatePosition(store.filePath, el.currentTime)
    }
  }

  onMetaRef.current = () => {
    const el = mediaRef.current
    if (!el) return
    store.setDuration(el.duration)
    const fp = store.filePath
    if (!fp) return
    // 收藏片段跳转：定位到片段起点并循环，优先于续播位置
    const pc = usePlayerStore.getState().playClip
    if (pc && pc.filePath === fp) {
      resumedForRef.current = fp
      lastPosSaveRef.current = pc.startTime
      el.currentTime = pc.startTime
      store.setLoop(pc.startTime, pc.endTime)
      store.setPlaying(true)
      store.setPlayClip(null)
      return
    }
    // 打开文件后续播上次位置；剩余 <15s 或 <5% 视为已看完，归零
    if (resumedForRef.current === fp) return
    resumedForRef.current = fp
    lastPosSaveRef.current = 0
    window.api.recentGetPosition(fp).then((pos: number) => {
      if (!pos || pos <= 0) return
      const dur = el.duration || 0
      const remaining = dur - pos
      if (dur > 0 && (remaining < 15 || remaining / dur < 0.05)) {
        window.api.recentUpdatePosition(fp, 0)
        return
      }
      el.currentTime = pos
      lastPosSaveRef.current = pos
    })
  }

  // --- Media element event wiring ---
  useEffect(() => {
    const el = mediaRef.current
    if (!el) return
    const onTime = () => onTimeUpdateRef.current()
    const onMeta = () => onMetaRef.current()
    el.addEventListener('timeupdate', onTime)
    el.addEventListener('loadedmetadata', onMeta)
    el.addEventListener('ended', () => store.setPlaying(false))
    el.addEventListener('error', () => setPlayError('媒体加载失败'))
    if (el.duration) onMetaRef.current()
    return () => {
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('loadedmetadata', onMeta)
    }
  }, [store.filePath])

  // --- Auto play on file open ---
  useEffect(() => {
    if (!store.filePath) return
    const el = mediaRef.current
    if (el && el.readyState >= 1) {
      store.setPlaying(true)
      return
    }
    const onLoaded = () => store.setPlaying(true)
    el?.addEventListener('canplay', onLoaded, { once: true })
    return () => el?.removeEventListener('canplay', onLoaded)
  }, [store.filePath])

  // --- Sync play/pause/rate ---
  useEffect(() => {
    const el = mediaRef.current
    if (!el) return
    if (store.playing) el.play().catch(() => {})
    else el.pause()
    el.playbackRate = store.playbackRate
  }, [store.playing, store.playbackRate])

  // --- Consume seek command ---
  useEffect(() => {
    const el = mediaRef.current
    if (el && store.seekTo !== null && store.seekTo >= 0) {
      el.currentTime = store.seekTo
      store.requestSeek(-1)
    }
  }, [store.seekTo])

  // --- Reset scroll to top when file changes ---
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [store.filePath, store.subtitles])

  // --- 当前字幕切换时自动滚动到容器中间 ---
  const lastSubIdx = useRef(-2)
  useEffect(() => {
    const el = scrollRef.current
    if (!el || store.subtitles.length === 0) return
    const t = store.played - store.subtitleOffset
    const idx = store.subtitles.findIndex((s) => t >= s.startTime - 0.08 && t < s.endTime)
    if (idx <= 0 || idx === lastSubIdx.current) return
    lastSubIdx.current = idx
    const child = el.children[idx] as HTMLElement
    if (child) child.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [store.played, store.subtitleOffset])

  // --- Close sub menu on outside click ---
  useEffect(() => {
    if (!showSubMenu) return
    const close = () => setShowSubMenu(false)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [showSubMenu])

  // --- Keyboard shortcuts ---
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!isActive) return
      const el = mediaRef.current
      if (!el) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.code === 'Space') {
        e.preventDefault()
        store.playing ? el.pause() : el.play()
        store.setPlaying(!store.playing)
      }
      if (e.code === 'ArrowLeft') el.currentTime = Math.max(0, el.currentTime - 5)
      if (e.code === 'ArrowRight') el.currentTime = Math.min(el.duration || 0, el.currentTime + 5)
      // --- 逐句复读与字幕微调（用 getState 避免闭包捕获旧状态） ---
      const st = usePlayerStore.getState()
      const subs = st.subtitles
      const off = st.subtitleOffset
      if (e.code === 'Comma') st.adjustSubtitleOffset(-0.1)
      if (e.code === 'Period') st.adjustSubtitleOffset(0.1)
      if (subs.length === 0) return
      const t = el.currentTime - off
      const curIdx = subs.findIndex((s) => t >= s.startTime - 0.08 && t <= s.endTime)
      const lastBefore = (time: number) => {
        let idx = -1
        for (let i = 0; i < subs.length; i++) {
          if (subs[i].startTime + off <= time + 0.3) idx = i
          else break
        }
        return idx
      }
      const seekToSub = (i: number) => {
        if (i < 0 || i >= subs.length) return
        el.currentTime = subs[i].startTime + off
        el.play().catch(() => {})
        st.setPlaying(true)
      }
      if (e.code === 'BracketLeft') {
        e.preventDefault()
        if (e.shiftKey) {
          // Shift+[ 上一句
          if (curIdx > 0) seekToSub(curIdx - 1)
          else if (curIdx === -1) seekToSub(Math.max(0, lastBefore(t) - 1))
        } else {
          // [ 重播当前句（不在句内时重播最近的一句）
          seekToSub(curIdx >= 0 ? curIdx : lastBefore(t))
        }
      }
      if (e.code === 'BracketRight') {
        e.preventDefault()
        // ] 下一句
        if (curIdx >= 0) seekToSub(curIdx + 1)
        else {
          const next = subs.findIndex((s) => s.startTime + off > t + 0.3)
          if (next !== -1) seekToSub(next)
        }
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isActive, store.playing])

  const handleOpenFile = async () => {
    const filePath = await window.api.openFile()
    if (filePath) {
      store.setFilePath(filePath)
      setPlayError(null)
      window.api.recentAdd(filePath)
      store.setWaveformLoading(true)
      window.api
        .getWaveformData(filePath)
        .then((data: number[]) => {
          if (data && data.length > 0) store.setWaveformData(data)
          else store.setWaveformLoading(false)
        })
        .catch(() => store.setWaveformLoading(false))
      try {
        const cached = await window.api.getCachedSubtitles(filePath)
        if (cached && cached.length > 0) {
          store.setSubtitles(cached)
          return
        }
        const srtPath = filePath.replace(/\.[^.]+$/, '.srt')
        try {
          await window.api.readTextFile(srtPath)
          loadSrtFile(srtPath)
        } catch (e) {
          console.error('Failed to load SRT:', e)
        }
      } catch (e) {
        console.error('Failed to load cached subtitles:', e)
      }
    }
  }

  const handleLoadSrt = async () => {
    const path = await window.api.openSubtitle()
    if (path) loadSrtFile(path)
  }

  const loadSrtFile = async (path: string) => {
    try {
      const content = await window.api.readTextFile(path)
      const parsed = new SrtParser().fromSrt(content)
      const subs = parsed.map((s: any) => ({
        id: parseInt(s.id),
        startTime: timeToSeconds(s.startTime),
        endTime: timeToSeconds(s.endTime),
        text: s.text,
      }))
      store.setSubtitles(subs)
      store.setSubtitlePath(path)
      if (store.filePath) window.api.cacheSubtitles(store.filePath, subs)
    } catch (err) {
      console.error(err)
    }
  }

  const startTranscription = async (filePath: string, lang?: string) => {
    const status = await window.api.whisperStatus()
    if (!status.loaded) {
      store.setTranscribing(true)
      store.setTranscriptionProgress(0)
      setTranscribingLabel('下载模型')
      const dlCleanup = window.api.onDownloadProgress((pct: number) =>
        store.setTranscriptionProgress(pct),
      )
      try {
        await window.api.downloadWhisperModel('https://hf-mirror.com', 'tiny')
        await window.api.setWhisperModel('tiny')
      } catch (err: any) {
        dlCleanup()
        store.setTranscribing(false)
        setTranscribingLabel('')
        alert('模型下载失败: ' + (err?.message || String(err)))
        return
      }
      dlCleanup()
    }
    store.setTranscribing(true)
    store.setTranscriptionProgress(0)
    setTranscribingLabel('转录中')
    const cleanup = window.api.onWhisperProgress((d: { progress: number }) =>
      store.setTranscriptionProgress(d.progress),
    )
    try {
      if (lang) {
        window.api.setWhisperLang(lang)
      }
      const subs = await window.api.whisperTranscribe(filePath)
      if (subs.length === 0) {
        alert('转录完成，但未识别到语音。请在设置页检查模型和语言设置是否正确')
      }
      store.setSubtitles(subs)
      window.api.cacheSubtitles(filePath, subs)
    } catch (err: any) {
      const msg = err?.message || String(err)
      store.setTranscriptionProgress(-1)
      if (msg.includes('fetch')) alert('模型下载失败，设 HF_MIRROR=https://hf-mirror.com 后重试')
      else alert(`转录失败: ${msg}`)
    } finally {
      cleanup()
      store.setTranscribing(false)
      setTranscribingLabel('')
    }
  }

  const exportSubtitles = async () => {
    if (store.subtitles.length === 0) return
    const toSrtTime = (s: number) => {
      const h = Math.floor(s / 3600)
      const m = Math.floor((s % 3600) / 60)
      const sec = s % 60
      const ms = Math.round((sec % 1) * 1000)
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${Math.floor(sec).toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`
    }
    const srt = store.subtitles
      .map((s, i) => `${i + 1}\n${toSrtTime(s.startTime)} --> ${toSrtTime(s.endTime)}\n${s.text}\n`)
      .join('\n')
    const filePath = await window.api.saveFile('subtitle.srt')
    if (filePath) {
      await window.api.writeTextFile(filePath, srt)
    }
  }

  const retranscribe = () => {
    if (store.filePath) setShowTranscribeLangModal(true)
  }
  const closeSubtitles = () => {
    store.setSubtitles([])
  }

  const handleWordClick = (word: string, sentence: string) => {
    const clean = word.replace(/[^a-zA-Z0-9\-']/g, '')
    if (!clean) return
    // 点词即查时暂停播放，方便看释义
    mediaRef.current?.pause()
    store.setPlaying(false)
    setSelectedWord(clean)
    setCurrentSentence(sentence)
    setShowLookup(true)
  }

  const openFavorite = (sub: { startTime: number; endTime: number; text: string }) => {
    setFavTarget({ startTime: sub.startTime, endTime: sub.endTime, text: sub.text })
    setFavTagId(0)
    setFavNewTag('')
    window.api.favoriteTagsList().then(setFavTags)
  }

  const saveFavorite = async () => {
    if (!favTarget || !store.filePath) return
    let tagId = favTagId
    const name = favNewTag.trim()
    if (name) {
      const id = await window.api.favoriteTagAdd(name)
      if (id > 0) tagId = id
    }
    await window.api.favoriteAdd({
      filePath: store.filePath,
      startTime: favTarget.startTime,
      endTime: favTarget.endTime,
      text: favTarget.text,
      tagId,
    })
    setFavTarget(null)
  }

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    return `${m}:${Math.floor(s % 60)
      .toString()
      .padStart(2, '0')}`
  }

  useEffect(() => {
    window.api.getMediaPort().then(setMediaPort)
  }, [])
  const mediaUrl =
    store.filePath && mediaPort
      ? `http://127.0.0.1:${mediaPort}/media/${encodeURIComponent(store.filePath)}`
      : ''

  // --- Player view ---
  const renderPlayer = () => (
    <div className="flex-1 flex flex-col lg:flex-row gap-4 min-h-0">
      <div className="flex-1 flex flex-col gap-2">
        <div
          className={`bg-black rounded-lg overflow-hidden relative flex items-center justify-center ${isAudio ? 'h-20' : 'aspect-video'}`}
          onClick={() => store.setPlaying(!store.playing)}
        >
          {isAudio ? (
            <audio
              ref={mediaRef as any}
              src={mediaUrl}
              controls
              style={{ width: '90%', height: 50 }}
            />
          ) : (
            <video
              ref={mediaRef as any}
              src={mediaUrl}
              className="w-full h-full absolute inset-0 object-contain"
              playsInline
            />
          )}
          {playError && (
            <div className="absolute inset-0 flex items-center justify-center text-destructive bg-black/80">
              播放失败: {playError}
            </div>
          )}
          {!isAudio &&
            (() => {
              const pa = store.played - store.subtitleOffset
              const sub = store.subtitles.find((s) => pa >= s.startTime - 0.08 && pa <= s.endTime)
              return sub ? (
                <div
                  className="absolute bottom-0 left-0 right-0 p-4 pb-6 flex justify-center"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="bg-black/70 text-white px-4 py-2 rounded text-3xl text-center max-w-[90%] leading-relaxed">
                    {sub.text}
                  </span>
                </div>
              ) : null
            })()}
        </div>

        {store.filePath && (
          <div className={isAudio ? 'h-[100px] shrink-0' : 'h-[48px] shrink-0'}>
            <Waveform
              data={store.waveformData}
              duration={store.duration}
              currentTime={store.played - store.subtitleOffset}
              subtitles={store.subtitles}
              loading={store.waveformLoading}
              dark={dark}
              onSeek={(t) => store.requestSeek(t)}
            />
          </div>
        )}

        {store.filePath && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-12 text-right">
              {formatTime(store.played)}
            </span>
            <input
              type="range"
              min={0}
              max={store.duration || 1}
              value={store.played}
              onChange={(e) => store.requestSeek(parseFloat(e.target.value))}
              className="flex-1 h-1 accent-primary"
            />
            <span className="text-xs text-muted-foreground w-12">{formatTime(store.duration)}</span>
          </div>
        )}

        {store.filePath && (
          <div className="flex items-center justify-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => store.setPlaying(!store.playing)}>
              {store.playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
            </Button>
            <select
              value={store.playbackRate}
              onChange={(e) => store.setPlaybackRate(parseFloat(e.target.value))}
              className="bg-background border rounded px-2 py-1 text-sm"
            >
              {PLAYBACK_RATES.map((r) => (
                <option key={r} value={r}>
                  {r}x
                </option>
              ))}
            </select>
            <Button
              variant="ghost"
              size="sm"
              className={store.loopStart !== null ? 'text-primary' : ''}
              onClick={() =>
                store.loopStart !== null
                  ? store.setLoop(null, null)
                  : store.setLoop(store.played, null)
              }
            >
              <Repeat className="h-4 w-4" />
            </Button>
            {store.loopStart !== null && (
              <div className="flex items-center gap-1 text-xs">
                <span>A: {formatTime(store.loopStart)}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => store.setLoop(store.loopStart, store.played)}
                >
                  B: {formatTime(store.played)}
                </Button>
              </div>
            )}
          </div>
        )}

        {store.transcribing && store.transcriptionProgress >= 0 && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>
              Whisper {transcribingLabel} {store.transcriptionProgress}%
            </span>
            <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden max-w-xs">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${store.transcriptionProgress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <div
        className="w-full lg:w-96 border rounded-lg bg-card flex flex-col"
        style={{ maxHeight: 'calc(100vh - 180px)' }}
      >
        <div className="flex items-center justify-between px-3 pt-3 pb-2 shrink-0">
          <h3 className="text-sm font-semibold">字幕</h3>
          <div className="relative">
            <button
              className="p-1 hover:bg-muted rounded"
              onClick={(e) => {
                e.stopPropagation()
                setShowSubMenu(!showSubMenu)
              }}
              title="字幕操作"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {showSubMenu && (
              <div
                className="absolute right-0 top-full mt-1 bg-popover border rounded shadow-lg py-1 z-50 min-w-[140px]"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent text-left"
                  onClick={() => {
                    setShowSubMenu(false)
                    exportSubtitles()
                  }}
                >
                  <Download className="h-3.5 w-3.5" /> 导出 SRT
                </button>
                <button
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent text-left"
                  onClick={() => {
                    setShowSubMenu(false)
                    handleLoadSrt()
                  }}
                >
                  <FileDown className="h-3.5 w-3.5" /> 导入 SRT
                </button>
                <div className="px-3 pt-2 pb-1 border-t border-border mt-1">
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                    <span>字幕偏移</span>
                    <span>{store.subtitleOffset.toFixed(1)}s</span>
                  </div>
                  <div className="flex gap-1">
                    <button
                      className="flex-1 px-1 py-1 text-xs hover:bg-accent rounded"
                      title="字幕提前 0.1s（快捷键 ,）"
                      onClick={() => store.adjustSubtitleOffset(-0.1)}
                    >
                      -0.1s
                    </button>
                    <button
                      className="flex-1 px-1 py-1 text-xs hover:bg-accent rounded"
                      onClick={() => store.adjustSubtitleOffset(-store.subtitleOffset)}
                    >
                      重置
                    </button>
                    <button
                      className="flex-1 px-1 py-1 text-xs hover:bg-accent rounded"
                      title="字幕延后 0.1s（快捷键 .）"
                      onClick={() => store.adjustSubtitleOffset(0.1)}
                    >
                      +0.1s
                    </button>
                  </div>
                </div>
                {store.subtitles.length > 0 && (
                  <>
                    <button
                      className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent text-left"
                      onClick={() => {
                        setShowSubMenu(false)
                        retranscribe()
                      }}
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> 重新转录
                    </button>
                    <button
                      className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent text-left text-destructive"
                      onClick={() => {
                        setShowSubMenu(false)
                        closeSubtitles()
                      }}
                    >
                      <XIcon className="h-3.5 w-3.5" /> 关闭字幕
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 pb-3">
          {store.subtitles.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 p-4">
              <p className="text-xs text-muted-foreground">暂无字幕</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={handleLoadSrt}>
                  <Subtitles className="h-4 w-4 mr-1" /> 导入字幕
                </Button>
                <Button
                  size="sm"
                  onClick={() => store.filePath && setShowTranscribeLangModal(true)}
                >
                  <Loader2 className="h-4 w-4 mr-1" /> 转录字幕
                </Button>
              </div>
            </div>
          ) : (
            store.subtitles.map((sub, idx) => {
              const pa = store.played - store.subtitleOffset
              const isActive = pa >= sub.startTime - 0.08 && pa < sub.endTime
              const isPast = pa > sub.endTime
              return (
                <div
                  key={sub.id}
                  className={`p-2 rounded text-lg cursor-pointer transition-colors mb-1 ${isActive ? 'bg-primary/10 border-l-2 border-primary font-medium' : isPast ? 'text-muted-foreground/60' : 'hover:bg-muted/50'}`}
                  onClick={() => store.requestSeek(sub.startTime + store.subtitleOffset)}
                >
                  <span className="text-xs text-muted-foreground mr-2">
                    {formatTime(sub.startTime)}
                  </span>
                  {sub.text.split(/(\s+)/).map((part, i) => {
                    const clean = part.replace(/[^a-zA-Z0-9\-']/g, '')
                    if (clean.length > 1)
                      return (
                        <span
                          key={i}
                          className="cursor-pointer hover:text-primary hover:underline"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleWordClick(part, sub.text)
                          }}
                        >
                          {part}
                        </span>
                      )
                    return <span key={i}>{part}</span>
                  })}
                  {isActive && (
                    <>
                      <button
                        className="ml-2 text-primary hover:text-primary/80"
                        onClick={(e) => {
                          e.stopPropagation()
                          speak(sub.text)
                        }}
                      >
                        <Speaker className="h-3 w-3 inline" />
                      </button>
                      <button
                        className="ml-1 text-primary hover:text-primary/80"
                        title="收藏当前句"
                        onClick={(e) => {
                          e.stopPropagation()
                          openFavorite(sub)
                        }}
                      >
                        <Star className="h-3 w-3 inline" />
                      </button>
                    </>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div className={`${isActive ? 'h-full' : 'hidden'}`}>
      <div className="h-full flex flex-col gap-4">
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          {store.filePath && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                store.closeFile()
                navigate('/')
              }}
            >
              <ArrowLeft className="h-4 w-4 mr-1" /> 返回列表
            </Button>
          )}
          <Button onClick={handleLoadSrt} variant="outline" size="sm">
            <Subtitles className="h-4 w-4 mr-1" /> 加载SRT字幕
          </Button>
          {store.filePath && (
            <span className="text-sm text-muted-foreground truncate max-w-[200px]">
              {store.filePath.split('/').pop()}
            </span>
          )}
        </div>

        {store.filePath ? (
          renderPlayer()
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-4">
            <p className="text-lg">打开一个文件开始播放</p>
            <p className="text-sm">前往「文件库」页面导入文件</p>
          </div>
        )}

        {showLookup && selectedWord && (
          <WordLookupModal
            word={selectedWord}
            sentence={currentSentence}
            onClose={() => setShowLookup(false)}
          />
        )}

        {showTranscribeLangModal && store.filePath && (
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            onClick={() => setShowTranscribeLangModal(false)}
          >
            <Card className="w-80 p-6" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Globe className="h-5 w-5" /> 选择识别语言
              </h3>
              <div className="mb-1">
                <label className="text-sm font-medium">音频语言</label>
                <p className="text-xs text-muted-foreground mb-3">
                  指定音频语言可提高识别准确率，auto 为自动检测
                </p>
              </div>
              <select
                className="w-full bg-background border rounded px-3 py-2 text-sm mb-4"
                value={transcribeLang}
                onChange={(e) => setTranscribeLang(e.target.value)}
              >
                <option value="auto">自动检测</option>
                <option value="en">English</option>
                <option value="zh">中文</option>
                <option value="ja">日本語</option>
                <option value="ko">한국어</option>
                <option value="fr">Français</option>
                <option value="de">Deutsch</option>
                <option value="es">Español</option>
                <option value="ru">Русский</option>
              </select>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setShowTranscribeLangModal(false)}>
                  取消
                </Button>
                <Button
                  onClick={() => {
                    setShowTranscribeLangModal(false)
                    startTranscription(store.filePath!, transcribeLang)
                  }}
                >
                  开始转录
                </Button>
              </div>
            </Card>
          </div>
        )}

        {/* 收藏整句弹窗 */}
        {favTarget && (
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            onClick={() => setFavTarget(null)}
          >
            <Card className="w-96 p-6" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Star className="h-5 w-5" /> 收藏整句
              </h3>
              <p className="text-sm mb-1 line-clamp-3">{favTarget.text}</p>
              <p className="text-xs text-muted-foreground mb-4">
                {formatTime(favTarget.startTime)} - {formatTime(favTarget.endTime)}
              </p>
              <label className="text-sm font-medium">标签</label>
              <select
                className="w-full bg-background border rounded px-3 py-2 text-sm mt-1 mb-3"
                value={favTagId}
                onChange={(e) => setFavTagId(parseInt(e.target.value))}
              >
                <option value={0}>无标签</option>
                {favTags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <Input
                placeholder="或输入新标签名称"
                value={favNewTag}
                onChange={(e) => setFavNewTag(e.target.value)}
                className="mb-4"
              />
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setFavTarget(null)}>
                  取消
                </Button>
                <Button onClick={saveFavorite}>收藏</Button>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}
