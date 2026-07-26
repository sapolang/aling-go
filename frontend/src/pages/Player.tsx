import { useState, useRef, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { usePlayerStore } from '@/stores/playerStore'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { speak } from '@/lib/tts'
import {
  Play, Pause, Repeat,
  FileUp, Subtitles, Loader2, BookmarkPlus, Volume2 as Speaker,
  MoreHorizontal, Download, RotateCcw, X as XIcon, FileDown, ArrowLeft,
  Globe
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
  const [selectedWord, setSelectedWord] = useState('')
  const [wordDefinition, setWordDefinition] = useState('')
  const [wordPhonetic, setWordPhonetic] = useState('')
  const [showAddWord, setShowAddWord] = useState(false)
  const [currentSentence, setCurrentSentence] = useState('')
  const [playError, setPlayError] = useState<string | null>(null)
  const [showSubMenu, setShowSubMenu] = useState(false)
  const [transcribingLabel, setTranscribingLabel] = useState('')
  const [mediaPort, setMediaPort] = useState(0)
  const [showTranscribeLangModal, setShowTranscribeLangModal] = useState(false)
  const [transcribeLang, setTranscribeLang] = useState('auto')

  const ext = store.filePath?.toLowerCase().match(/\.(\w+)$/)?.[1]
  const isAudio = ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac'].includes(ext || '')

  useEffect(() => { window.api.getWhisperLang().then(setTranscribeLang) }, [])

  // --- Refs for event handlers (avoid stale closures) ---
  const onTimeUpdateRef = useRef<() => void>(() => {})
  const onMetaRef = useRef<() => void>(() => {})

  onTimeUpdateRef.current = () => {
    const el = mediaRef.current
    if (!el) return
    store.setPlayed(el.currentTime)
    store.setPlaying(!el.paused)
    const idx = store.subtitles.findIndex(
      (s) => el.currentTime >= s.startTime - 0.08 && el.currentTime <= s.endTime
    )
    if (idx !== -1) store.setCurrentSubtitleIndex(idx)
    if (store.loopEnd && el.currentTime >= store.loopEnd) {
      el.currentTime = store.loopStart || 0
    }
  }

  onMetaRef.current = () => {
    const el = mediaRef.current
    if (el) store.setDuration(el.duration)
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
    if (el && el.readyState >= 1) { store.setPlaying(true); return }
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
    const idx = store.subtitles.findIndex(
      (s) => store.played >= s.startTime - 0.08 && store.played < s.endTime
    )
    if (idx <= 0 || idx === lastSubIdx.current) return
    lastSubIdx.current = idx
    const child = el.children[idx] as HTMLElement
    if (child) child.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [store.played])

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
      if (e.code === 'Space') { e.preventDefault(); store.playing ? el.pause() : el.play(); store.setPlaying(!store.playing) }
      if (e.code === 'ArrowLeft') el.currentTime = Math.max(0, el.currentTime - 5)
      if (e.code === 'ArrowRight') el.currentTime = Math.min(el.duration || 0, el.currentTime + 5)
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
      try {
        const cached = await window.api.getCachedSubtitles(filePath)
        if (cached && cached.length > 0) { store.setSubtitles(cached); return }
        const srtPath = filePath.replace(/\.[^.]+$/, '.srt')
        try { await window.api.readTextFile(srtPath); loadSrtFile(srtPath) } catch {}
      } catch {}
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
        text: s.text
      }))
      store.setSubtitles(subs)
      store.setSubtitlePath(path)
      if (store.filePath) window.api.cacheSubtitles(store.filePath, subs)
    } catch (err) { console.error(err) }
  }

  const startTranscription = async (filePath: string, lang?: string) => {
    const status = await window.api.whisperStatus()
    if (!status.loaded) {
      store.setTranscribing(true); store.setTranscriptionProgress(0)
      setTranscribingLabel('下载模型')
      const dlCleanup = window.api.onDownloadProgress((pct) => store.setTranscriptionProgress(pct))
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
    store.setTranscribing(true); store.setTranscriptionProgress(0)
    setTranscribingLabel('转录中')
    const cleanup = window.api.onWhisperProgress((d) => store.setTranscriptionProgress(d.progress))
    try {
      if (lang) { window.api.setWhisperLang(lang) }
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
    } finally { cleanup(); store.setTranscribing(false); setTranscribingLabel('') }
  }

  const exportSubtitles = async () => {
    if (store.subtitles.length === 0) return
    const toSrtTime = (s: number) => {
      const h = Math.floor(s / 3600)
      const m = Math.floor((s % 3600) / 60)
      const sec = s % 60
      const ms = Math.round((sec % 1) * 1000)
      return `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${Math.floor(sec).toString().padStart(2,'0')},${ms.toString().padStart(3,'0')}`
    }
    const srt = store.subtitles.map((s, i) =>
      `${i + 1}\n${toSrtTime(s.startTime)} --> ${toSrtTime(s.endTime)}\n${s.text}\n`
    ).join('\n')
    const filePath = await window.api.saveFile('subtitle.srt')
    if (filePath) { await window.api.writeTextFile(filePath, srt) }
  }

  const retranscribe = () => { if (store.filePath) setShowTranscribeLangModal(true) }
  const closeSubtitles = () => { store.setSubtitles([]) }

  const handleWordClick = (word: string, sentence: string) => {
    setSelectedWord(word.replace(/[^a-zA-Z0-9\-']/g, ''))
    setCurrentSentence(sentence); setWordDefinition(''); setWordPhonetic(''); setShowAddWord(true)
  }

  const handleAddWord = async () => {
    if (!selectedWord) return
    const today = new Date().toISOString().split('T')[0]
    await window.api.dbWordsAdd({ word: selectedWord, definition: wordDefinition, phonetic: wordPhonetic, example: currentSentence, tags: '', level: 1, next_review: today })
    setShowAddWord(false); setSelectedWord('')
  }

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`
  }

  useEffect(() => { window.api.getMediaPort().then(setMediaPort) }, [])
  const mediaUrl = store.filePath && mediaPort
    ? `http://127.0.0.1:${mediaPort}/media/${encodeURIComponent(store.filePath)}`
    : ''

  // --- Player view ---
  const renderPlayer = () => (
    <div className="flex-1 flex flex-col lg:flex-row gap-4 min-h-0">
      <div className="flex-1 flex flex-col gap-2">
        <div className={`bg-black rounded-lg overflow-hidden relative flex items-center justify-center ${isAudio ? 'h-20' : 'aspect-video'}`}>
          {isAudio
            ? <audio ref={mediaRef as any} src={mediaUrl} controls style={{ width: '90%', height: 50 }} />
            : <video ref={mediaRef as any} src={mediaUrl} className="w-full h-full absolute inset-0 object-contain" playsInline />
          }
          {playError && <div className="absolute inset-0 flex items-center justify-center text-destructive bg-black/80">播放失败: {playError}</div>}
          {!isAudio && (() => {
            const sub = store.subtitles.find(s => store.played >= s.startTime - 0.08 && store.played <= s.endTime)
            return sub ? (
              <div className="absolute bottom-0 left-0 right-0 p-4 pb-6 flex justify-center">
                <span className="bg-black/70 text-white px-4 py-2 rounded text-lg text-center max-w-[90%] leading-relaxed">
                  {sub.text}
                </span>
              </div>
            ) : null
          })()}
        </div>

        {store.filePath && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-12 text-right">{formatTime(store.played)}</span>
            <input type="range" min={0} max={store.duration || 1} value={store.played}
              onChange={(e) => store.requestSeek(parseFloat(e.target.value))} className="flex-1 h-1 accent-primary" />
            <span className="text-xs text-muted-foreground w-12">{formatTime(store.duration)}</span>
          </div>
        )}

        {store.filePath && (
          <div className="flex items-center justify-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => store.setPlaying(!store.playing)}>
              {store.playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
            </Button>
            <select value={store.playbackRate} onChange={(e) => store.setPlaybackRate(parseFloat(e.target.value))}
              className="bg-background border rounded px-2 py-1 text-sm">
              {PLAYBACK_RATES.map((r) => <option key={r} value={r}>{r}x</option>)}
            </select>
            <Button variant="ghost" size="sm" className={store.loopStart !== null ? 'text-primary' : ''}
              onClick={() => store.loopStart !== null ? store.setLoop(null, null) : store.setLoop(store.played, null)}>
              <Repeat className="h-4 w-4" />
            </Button>
            {store.loopStart !== null && (
              <div className="flex items-center gap-1 text-xs">
                <span>A: {formatTime(store.loopStart)}</span>
                <Button variant="ghost" size="sm" onClick={() => store.setLoop(store.loopStart, store.played)}>
                  B: {formatTime(store.played)}
                </Button>
              </div>
            )}
          </div>
        )}

        {store.transcribing && store.transcriptionProgress >= 0 && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Whisper {transcribingLabel} {store.transcriptionProgress}%</span>
            <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden max-w-xs">
              <div className="h-full bg-primary transition-all" style={{ width: `${store.transcriptionProgress}%` }} />
            </div>
          </div>
        )}
      </div>

      <div className="w-full lg:w-96 border rounded-lg bg-card flex flex-col" style={{ maxHeight: 'calc(100vh - 180px)' }}>
        <div className="flex items-center justify-between px-3 pt-3 pb-2 shrink-0">
          <h3 className="text-sm font-semibold">字幕</h3>
          <div className="relative">
            <button className="p-1 hover:bg-muted rounded" onClick={(e) => { e.stopPropagation(); setShowSubMenu(!showSubMenu) }} title="字幕操作">
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {showSubMenu && (
              <div className="absolute right-0 top-full mt-1 bg-popover border rounded shadow-lg py-1 z-50 min-w-[140px]" onClick={(e) => e.stopPropagation()}>
                <button className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent text-left" onClick={() => { setShowSubMenu(false); exportSubtitles() }}>
                  <Download className="h-3.5 w-3.5" /> 导出 SRT
                </button>
                <button className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent text-left" onClick={() => { setShowSubMenu(false); handleLoadSrt() }}>
                  <FileDown className="h-3.5 w-3.5" /> 导入 SRT
                </button>
                {store.subtitles.length > 0 && (
                  <>
                    <button className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent text-left" onClick={() => { setShowSubMenu(false); retranscribe() }}>
                      <RotateCcw className="h-3.5 w-3.5" /> 重新转录
                    </button>
                    <button className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent text-left text-destructive" onClick={() => { setShowSubMenu(false); closeSubtitles() }}>
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
                <Button size="sm" onClick={() => store.filePath && setShowTranscribeLangModal(true)}>
                  <Loader2 className="h-4 w-4 mr-1" /> 转录字幕
                </Button>
              </div>
            </div>
          ) : store.subtitles.map((sub, idx) => {
            const isActive = store.played >= sub.startTime - 0.08 && store.played < sub.endTime
            const isPast = store.played > sub.endTime
            return (
              <div key={sub.id}
                className={`p-2 rounded text-sm cursor-pointer transition-colors mb-1 ${isActive ? 'bg-primary/10 border-l-2 border-primary font-medium' : isPast ? 'text-muted-foreground/60' : 'hover:bg-muted/50'}`}
                onClick={() => store.requestSeek(sub.startTime)}>
                <span className="text-xs text-muted-foreground mr-2">{formatTime(sub.startTime)}</span>
                {sub.text.split(/(\s+)/).map((part, i) => {
                  const clean = part.replace(/[^a-zA-Z0-9\-']/g, '')
                  if (clean.length > 1) return (
                    <span key={i} className="cursor-pointer hover:text-primary hover:underline"
                      onClick={(e) => { e.stopPropagation(); handleWordClick(part, sub.text) }}>{part}</span>
                  )
                  return <span key={i}>{part}</span>
                })}
                {isActive && (
                  <button className="ml-2 text-primary hover:text-primary/80" onClick={(e) => { e.stopPropagation(); speak(sub.text) }}>
                    <Speaker className="h-3 w-3 inline" />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )

  return (
    <div className={`${isActive ? 'h-full' : 'hidden'}`}>
      <div className="h-full flex flex-col gap-4">
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <Button onClick={handleOpenFile} size="sm">
            <FileUp className="h-4 w-4 mr-1" /> 导入音视频
          </Button>
          {store.filePath && (
              <Button variant="ghost" size="sm" onClick={() => { store.closeFile(); navigate('/') }}>
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

        {store.filePath ? renderPlayer() : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-4">
            <p className="text-lg">打开一个文件开始播放</p>
            <p className="text-sm">前往「文件库」页面导入文件，或直接拖入音视频</p>
            <Button size="sm" onClick={handleOpenFile}>
              <FileUp className="h-4 w-4 mr-1" /> 导入音视频
            </Button>
          </div>
        )}

        {showAddWord && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowAddWord(false)}>
            <Card className="w-96 p-6" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-semibold mb-4">添加生词</h3>
              <div className="space-y-3">
                <div><label className="text-sm font-medium">单词</label><Input value={selectedWord} onChange={(e) => setSelectedWord(e.target.value)} /></div>
                <div><label className="text-sm font-medium">释义</label><Input value={wordDefinition} onChange={(e) => setWordDefinition(e.target.value)} placeholder="输入释义" /></div>
                <div><label className="text-sm font-medium">音标</label><Input value={wordPhonetic} onChange={(e) => setWordPhonetic(e.target.value)} placeholder="/ˈeksəmpəl/" /></div>
                <div><label className="text-sm font-medium">例句</label><textarea className="w-full min-h-[60px] rounded-md border border-input bg-background px-3 py-2 text-sm" value={currentSentence} onChange={(e) => setCurrentSentence(e.target.value)} /></div>
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" onClick={() => setShowAddWord(false)}>取消</Button>
                  <Button onClick={handleAddWord}><BookmarkPlus className="h-4 w-4 mr-1" /> 加入生词库</Button>
                </div>
              </div>
            </Card>
          </div>
        )}

        {showTranscribeLangModal && store.filePath && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowTranscribeLangModal(false)}>
            <Card className="w-80 p-6" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Globe className="h-5 w-5" /> 选择识别语言
              </h3>
              <div className="mb-1">
                <label className="text-sm font-medium">音频语言</label>
                <p className="text-xs text-muted-foreground mb-3">指定音频语言可提高识别准确率，auto 为自动检测</p>
              </div>
              <select className="w-full bg-background border rounded px-3 py-2 text-sm mb-4"
                value={transcribeLang} onChange={(e) => setTranscribeLang(e.target.value)}>
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
                <Button variant="outline" onClick={() => setShowTranscribeLangModal(false)}>取消</Button>
                <Button onClick={() => {
                  setShowTranscribeLangModal(false)
                  startTranscription(store.filePath!, transcribeLang)
                }}>开始转录</Button>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}


