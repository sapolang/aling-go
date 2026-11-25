import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import {
  ArrowLeft,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  FileText,
  Loader2,
  Pause,
  Play,
  Repeat1,
  RotateCcw,
  Sparkles,
  Volume2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import WordHoverCard from '@/components/WordHoverCard'
import WordLookupModal from '@/components/WordLookupModal'
import AISentencePanel from '@/pages/player/AISentencePanel'
import { useAIPanel } from '@/pages/player/useAIPanel'
import { showToast } from '@/components/feedback'
import { useTtsQueuePlayer } from '@/hooks/useTtsQueuePlayer'
import { useTextWordHover } from '@/hooks/useTextWordHover'
import { TTS_VOICE_STORAGE_KEY as VOICE_STORAGE_KEY } from '@/lib/tts'
import { useWordStore } from '@/stores/wordStore'
import type {
  EngineStatus,
  InstallProgress,
  PDFDocument,
  PDFSentence,
  SubtitleItem,
} from '@/types/api'
import './PdfListenPlayer.css'

const RATES = [0.6, 0.8, 1, 1.2, 1.5]
const GAPS = [0, 1, 2]

// 与 internal/tts/install.go 的 localVoiceCatalog 保持一致，
// TTSStatus 只返回已安装模型，因此安装对话框需要这份可安装清单。
const LOCAL_VOICES = [
  { id: 'en_US-lessac-medium', name: 'Lessac · 美式女声（推荐）' },
  { id: 'en_US-amy-medium', name: 'Amy · 美式女声' },
  { id: 'en_GB-alan-medium', name: 'Alan · 英式男声' },
]

interface PdfRouteState {
  path?: string
  name?: string
}

const ENGINE_LABELS: Record<string, string> = {
  edge: '在线 Edge 语音',
  local: '本地离线语音',
  browser: '浏览器语音（降级）',
}

function sentenceToSubtitle(index: number, sentence: PDFSentence): SubtitleItem {
  return { id: index + 1, startTime: 0, endTime: 0, text: sentence.text }
}

export default function PdfListenPlayer() {
  const location = useLocation()
  const navigate = useNavigate()
  const routeState = (location.state ?? {}) as PdfRouteState
  const path = routeState.path || ''

  const [doc, setDoc] = useState<PDFDocument | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [voice, setVoice] = useState(
    () => localStorage.getItem(VOICE_STORAGE_KEY) || 'en-US-AriaNeural',
  )
  const [status, setStatus] = useState<EngineStatus | null>(null)
  // 默认显示原文，用户主动开启盲听后才会模糊遮蔽。
  const [blind, setBlind] = useState(false)
  const [peekIndex, setPeekIndex] = useState<number | null>(null)
  const [autoFollow, setAutoFollow] = useState(true)
  const [installOpen, setInstallOpen] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [installProgress, setInstallProgress] = useState<InstallProgress | null>(null)
  const [resumeIndex, setResumeIndex] = useState(0)

  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const progressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const progressIndexRef = useRef(0)
  const progressPathRef = useRef('')
  const autoPlayedRef = useRef('')
  const docPathRef = useRef('')

  const sentences = useMemo(() => doc?.sentences ?? [], [doc])

  // 生词库词表：已收藏的词在正文中高亮
  const savedWordList = useWordStore((s) => s.words)
  const loadWords = useWordStore((s) => s.loadWords)
  const savedWords = useMemo(
    () => new Set(savedWordList.map((w) => w.word.toLowerCase())),
    [savedWordList],
  )
  useEffect(() => {
    void loadWords()
  }, [loadWords])

  const isSavedWord = useCallback(
    (part: string) => {
      let clean = part.toLowerCase().replace(/[^a-z0-9\-']/g, '')
      if (clean.endsWith("'s")) clean = clean.slice(0, -2)
      return clean.length > 1 && savedWords.has(clean)
    },
    [savedWords],
  )

  const saveProgress = useCallback((index: number, immediate = false) => {
    const pathNow = progressPathRef.current
    if (!pathNow) return
    progressIndexRef.current = index
    if (progressTimer.current) {
      clearTimeout(progressTimer.current)
      progressTimer.current = null
    }
    if (immediate) {
      void window.api.pdfUpdateProgress(pathNow, index).catch(() => {})
      return
    }
    progressTimer.current = setTimeout(() => {
      progressTimer.current = null
      void window.api.pdfUpdateProgress(pathNow, index).catch(() => {})
    }, 700)
  }, [])

  const handleIndexChange = useCallback(
    (index: number) => {
      setResumeIndex(index)
      // 点击某句会先“偷看”，播放推进到下一句后重新遮住。
      setPeekIndex((peek) => (peek !== null && peek !== index ? null : peek))
      saveProgress(index)
    },
    [saveProgress],
  )

  const player = useTtsQueuePlayer({
    sentences,
    voice,
    sourceKey: path,
    initialIndex: resumeIndex,
    onIndexChange: handleIndexChange,
    onError: (message) => showToast(message, 'warning'),
  })
  const {
    index,
    playing,
    loading: audioLoading,
    engine,
    rate,
    repeat,
    gap,
    playAt,
    toggle,
    next,
    prev,
    setRate,
    setRepeat,
    setGap,
  } = player

  const hover = useTextWordHover({
    isSavedWord,
    onWordOpen: () => {
      if (playing) toggle()
    },
  })
  const ai = useAIPanel(path)

  // 打开文档：并行取句子索引与 TTS 能力，避免先播放再切发音导致队列被重置。
  useEffect(() => {
    let cancelled = false
    docPathRef.current = path
    progressPathRef.current = path
    autoPlayedRef.current = ''
    setDoc(null)
    setError('')
    setLoading(true)
    setPeekIndex(null)
    setResumeIndex(0)

    if (!path) {
      setLoading(false)
      setError('未指定 PDF 文件，请从文件库中打开。')
      return () => {
        cancelled = true
      }
    }

    ;(async () => {
      try {
        const [loadResult, engineStatus] = await Promise.all([
          window.api.pdfLoad(path),
          window.api.ttsStatus().catch(() => null),
        ])
        if (cancelled) return
        if (!loadResult?.ok || !loadResult.document) {
          setError(loadResult?.error || '无法解析这个 PDF')
          setLoading(false)
          return
        }
        const loaded = loadResult.document
        setDoc(loaded)
        setResumeIndex(loaded.lastSentence)
        progressIndexRef.current = loaded.lastSentence
        if (engineStatus) {
          setStatus(engineStatus)
          const allVoices = [
            ...(engineStatus.edgeVoices ?? []),
            ...(engineStatus.localModels ?? []),
          ]
          const stored = localStorage.getItem(VOICE_STORAGE_KEY) || ''
          const validStored = allVoices.some((v) => v.id === stored)
          const nextVoice = validStored
            ? stored
            : engineStatus.defaultVoice || allVoices[0]?.id || voice
          setVoice(nextVoice)
          localStorage.setItem(VOICE_STORAGE_KEY, nextVoice)
        }
        setLoading(false)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : '加载 PDF 失败')
        setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
    // voice 只用于无可用引擎状态时的兜底，不应触发重新加载文档
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  // 打开后从上次停下的句子继续，稍等排版稳定再自动播放。
  // 用户先手动点了播放时，不再抢回上次的句子。
  useEffect(() => {
    if (!doc || sentences.length === 0) return
    if (autoPlayedRef.current === doc.path) return
    if (playing) {
      autoPlayedRef.current = doc.path
      return
    }
    const timer = setTimeout(() => {
      if (autoPlayedRef.current === doc.path) return
      autoPlayedRef.current = doc.path
      playAt(doc.lastSentence)
    }, 320)
    return () => clearTimeout(timer)
  }, [doc, playing, playAt, sentences])

  // 当前句变化时跟随滚动；用户关闭跟随后只保留高亮。
  useEffect(() => {
    if (!autoFollow) return
    const timer = setTimeout(() => {
      virtuosoRef.current?.scrollToIndex({ index, align: 'center', behavior: 'smooth' })
    }, 60)
    return () => clearTimeout(timer)
  }, [index, autoFollow, doc])

  // 安装进度事件由后端推送，页面关闭时取消订阅。
  useEffect(() => {
    return window.api.ttsOnInstallProgress((progress) => {
      setInstallProgress(progress)
    })
  }, [])

  // 离开页面时立即落盘，避免最后一句进度丢失。
  useEffect(() => {
    return () => {
      if (progressTimer.current) {
        clearTimeout(progressTimer.current)
        progressTimer.current = null
      }
      if (progressPathRef.current) {
        void window.api
          .pdfUpdateProgress(progressPathRef.current, progressIndexRef.current)
          .catch(() => {})
      }
    }
  }, [])

  // 键盘快捷键：空格播放/暂停，左右切句，R 单句复读，B 盲听。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      ) {
        return
      }
      if (installOpen || hover.showLookup || ai.aiTarget || ai.aiExplain) return
      if (e.code === 'Space') {
        e.preventDefault()
        toggle()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        prev()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        next()
      } else if (e.key.toLowerCase() === 'r') {
        e.preventDefault()
        setRepeat(!repeat)
      } else if (e.key.toLowerCase() === 'b') {
        e.preventDefault()
        setBlind((v) => !v)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    ai.aiExplain,
    ai.aiTarget,
    hover.showLookup,
    installOpen,
    next,
    prev,
    repeat,
    setRepeat,
    toggle,
  ])

  const handleVoiceChange = (nextVoice: string) => {
    setVoice(nextVoice)
    localStorage.setItem(VOICE_STORAGE_KEY, nextVoice)
  }

  const handleInstall = async (voiceID: string) => {
    if (installing) return
    setInstalling(true)
    setInstallProgress(null)
    try {
      const result = await window.api.installLocalTTS(voiceID)
      setStatus(result.status)
      if (result.ok) {
        setVoice(voiceID)
        localStorage.setItem(VOICE_STORAGE_KEY, voiceID)
        showToast('离线语音已安装，可以在发音列表中选择', 'success')
      } else {
        showToast(result.error || '离线语音安装失败', 'error')
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '离线语音安装失败', 'error')
    } finally {
      setInstalling(false)
    }
  }

  const handleRowClick = (sentenceIndex: number) => {
    hover.cancelHover()
    ai.closeAll()
    setPeekIndex(sentenceIndex)
    playAt(sentenceIndex)
  }

  const handleViewPdf = () => {
    if (!path) return
    void window.api.openExternal(path).catch(() => showToast('打开原版 PDF 失败', 'error'))
  }

  const [reindexing, setReindexing] = useState(false)
  const handleReindex = async () => {
    if (!path || reindexing) return
    setReindexing(true)
    try {
      const result = await window.api.pdfImport(path)
      if (!result?.ok) {
        showToast(result?.error || '重新解析失败', 'error')
        return
      }
      // 强制 pdfImport 替换了后端索引，重新 load 一次拿完整 doc + 保留的进度
      const reload = await window.api.pdfLoad(path)
      if (!reload?.ok || !reload.document) {
        showToast(result?.error || '重新解析后加载失败', 'error')
        return
      }
      const loaded = reload.document
      setDoc(loaded)
      setResumeIndex(loaded.lastSentence)
      progressIndexRef.current = loaded.lastSentence
      setPeekIndex(null)
      showToast(`已重新解析：${loaded.pageCount} 页，${loaded.sentenceCount} 句`, 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '重新解析失败', 'error')
    } finally {
      setReindexing(false)
    }
  }

  const voiceOptions = useMemo(
    () => [...(status?.edgeVoices ?? []), ...(status?.localModels ?? [])],
    [status],
  )
  const activeSentence = sentences[index]
  const total = sentences.length
  const engineLabel = ENGINE_LABELS[engine] || '准备就绪'

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-3rem)] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        正在解析 PDF 并提取句子…
      </div>
    )
  }

  if (error || !doc) {
    return (
      <div className="flex h-[calc(100vh-3rem)] flex-col items-center justify-center gap-4 text-center">
        <FileText className="h-10 w-10 text-muted-foreground" />
        <div>
          <p className="text-lg font-medium">PDF 精听不可用</p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            {error || '没有可朗读的句子'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate('/')}>
            返回文件库
          </Button>
          {path && (
            <Button variant="secondary" onClick={handleViewPdf}>
              查看原版 PDF
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="pdf-listen-root flex h-[calc(100vh-3rem)] min-h-[520px] flex-col">
      <header className="pdf-listen-header">
        <div className="flex min-w-0 items-start gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="mt-0.5 h-8 w-8 shrink-0"
            title="返回文件库"
            onClick={() => navigate('/')}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold" title={doc.title}>
              {doc.title || routeState.name || 'PDF 精听'}
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {doc.pageCount} 页 · {doc.sentenceCount} 句
              {activeSentence ? ` · 当前第 ${activeSentence.page} 页` : ''} · {engineLabel}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <Select value={voice} onValueChange={handleVoiceChange}>
            <SelectTrigger className="h-8 w-48 text-xs" title="朗读发音">
              <Volume2 className="mr-1 h-3.5 w-3.5 shrink-0" />
              <SelectValue placeholder="选择发音" />
            </SelectTrigger>
            <SelectContent>
              {voiceOptions.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            title="安装离线语音包（断网时使用）"
            onClick={() => setInstallOpen(true)}
          >
            <Download className="mr-1 h-3.5 w-3.5" />
            离线语音
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-muted-foreground"
            title="文件内容变更后重新提取句子"
            disabled={reindexing}
            onClick={() => void handleReindex()}
          >
            {reindexing ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="mr-1 h-3.5 w-3.5" />
            )}
            重新解析
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-muted-foreground"
            onClick={handleViewPdf}
          >
            <FileText className="mr-1 h-3.5 w-3.5" />
            查看原版 PDF
          </Button>
        </div>
      </header>

      <div className="pdf-listen-controls">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            title="上一句（←）"
            onClick={prev}
            disabled={total === 0}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            className="h-10 w-10 rounded-full"
            title={playing ? '暂停（空格）' : '播放（空格）'}
            onClick={toggle}
            disabled={total === 0}
          >
            {audioLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : playing ? (
              <Pause className="h-5 w-5" />
            ) : (
              <Play className="h-5 w-5" />
            )}
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            title="下一句（→）"
            onClick={next}
            disabled={total === 0}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant={repeat ? 'secondary' : 'ghost'}
            size="icon"
            className={`h-9 w-9 ${repeat ? 'text-primary' : ''}`}
            title="单句无限复读（R）"
            aria-pressed={repeat}
            onClick={() => setRepeat(!repeat)}
          >
            <Repeat1 className="h-4 w-4" />
          </Button>
        </div>

        <div className="pdf-listen-divider" />

        <div className="flex items-center gap-1.5">
          <span className="pdf-listen-label">语速</span>
          {RATES.map((value) => (
            <button
              type="button"
              key={value}
              className={`pdf-pill ${Math.abs(rate - value) < 0.001 ? 'is-active' : ''}`}
              onClick={() => setRate(value)}
            >
              {value}x
            </button>
          ))}
        </div>

        <div className="pdf-listen-divider" />

        <div className="flex items-center gap-1.5">
          <span className="pdf-listen-label">句间停顿</span>
          {GAPS.map((value) => (
            <button
              type="button"
              key={value}
              className={`pdf-pill ${gap === value ? 'is-active' : ''}`}
              onClick={() => setGap(value)}
            >
              {value === 0 ? '0s' : `${value}s`}
            </button>
          ))}
        </div>

        <div className="pdf-listen-divider" />

        <div className="flex items-center gap-2">
          <button
            type="button"
            className={`pdf-pill flex items-center gap-1.5 ${blind ? 'is-active' : ''}`}
            aria-pressed={blind}
            title="盲听时模糊原文，悬停或点击句子可偷看（B）"
            onClick={() => setBlind((v) => !v)}
          >
            {blind ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            盲听
          </button>
          <button
            type="button"
            className={`pdf-pill ${autoFollow ? 'is-active' : ''}`}
            aria-pressed={autoFollow}
            title="自动滚动到正在朗读的句子"
            onClick={() => setAutoFollow((v) => !v)}
          >
            跟随
          </button>
        </div>

        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          <span className="tabular-nums">{total === 0 ? '0 / 0' : `${index + 1} / ${total}`}</span>
          {activeSentence && (
            <span className="flex items-center gap-1">
              <BookOpen className="h-3.5 w-3.5" />
              P.{activeSentence.page}
            </span>
          )}
        </div>
      </div>

      <div className="pdf-sentence-list">
        {total === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            没有从该 PDF 中提取到可朗读的句子
          </div>
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            data={sentences}
            computeItemKey={(_, item) => item.index}
            increaseViewportBy={400}
            itemContent={(sentenceIndex, sentence) => {
              const isActive = sentenceIndex === index
              const isBlind = blind && peekIndex !== sentenceIndex
              return (
                <div className="pdf-sentence-shell">
                  <div
                    role="button"
                    tabIndex={0}
                    aria-current={isActive ? 'true' : undefined}
                    className={`pdf-sentence-row ${isActive ? 'is-active' : ''} ${
                      isBlind ? 'is-blind' : ''
                    } ${sentenceIndex < index ? 'is-past' : ''}`}
                    onClick={() => handleRowClick(sentenceIndex)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return
                      e.preventDefault()
                      e.stopPropagation()
                      handleRowClick(sentenceIndex)
                    }}
                  >
                    <span className="pdf-sentence-page" title={`第 ${sentence.page} 页`}>
                      {sentence.page}
                    </span>
                    <span className="pdf-sentence-text">
                      {hover.renderWords(sentence.text, sentence.text, `s-${sentence.index}`)}
                    </span>
                    <span className="pdf-sentence-actions">
                      <button
                        type="button"
                        className="pdf-row-action"
                        title="用 AI 翻译/详解本句"
                        onClick={(e) => {
                          e.stopPropagation()
                          hover.cancelHover()
                          ai.toggleForSubtitle(sentenceToSubtitle(sentenceIndex, sentence))
                        }}
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </div>
                </div>
              )
            }}
          />
        )}
      </div>

      <p className="pdf-listen-hint">
        空格播放/暂停 · ←/→ 切句 · R 单句复读 · B 盲听 · 点击句子从该句连播
      </p>

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

      <Dialog open={installOpen} onOpenChange={(open) => !installing && setInstallOpen(open)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" /> 离线语音包
            </DialogTitle>
            <DialogDescription>
              下载 Piper
              引擎与语音模型到本地数据目录。断网或在线语音超时后会自动使用；已安装的模型不会重复下载。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            {LOCAL_VOICES.map((item) => {
              const installed = (status?.localModels ?? []).some((m) => m.id === item.id)
              return (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {installed
                        ? '已安装'
                        : status?.localBinaryReady
                          ? '待下载模型'
                          : '首次安装会下载引擎'}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={installed ? 'outline' : 'secondary'}
                    disabled={installing}
                    onClick={() => void handleInstall(item.id)}
                  >
                    {installed ? '重新检查' : '安装'}
                  </Button>
                </div>
              )
            })}
          </div>

          {installing && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {installProgress?.message || '正在准备安装…'}
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${installProgress?.progress ?? 0}%` }}
                />
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            在线 Edge 语音仍然优先；离线语音只作为断网兜底，不生成或缓存整本音频。
          </p>
        </DialogContent>
      </Dialog>
    </div>
  )
}
