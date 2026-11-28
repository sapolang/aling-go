import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Loader2,
  Pause,
  Play,
  RotateCcw,
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
import { PdfPageView } from '@/components/PdfPageView'
import { showToast } from '@/components/feedback'
import { usePdfReadAloud } from '@/hooks/usePdfReadAloud'
import { TTS_VOICE_STORAGE_KEY as VOICE_STORAGE_KEY } from '@/lib/tts'
import {
  loadPdfDocument,
  type PdfDocumentData,
  type PdfReadParagraph,
  type PdfSentenceSpan,
} from '@/lib/pdfReader'
import type { EngineStatus, InstallProgress } from '@/types/api'
import './PdfListenPlayer.css'

const RATES = [0.6, 0.8, 1, 1.2, 1.5]

// 页面缩放：0.75~2，步进 0.1。原 PDF 版式不变，只整体放大缩小。
const SCALE_MIN = 0.75
const SCALE_MAX = 2
const SCALE_STEP = 0.1

// 每次打开默认放大到 150%，缩放调整仅在当前阅读会话生效。
const DEFAULT_SCALE = 1.5

// 与 internal/tts/install.go 的 localVoiceCatalog 保持一致
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

/** 进度以全局句下标存储，找到它所属的段落下标。 */
function findParagraphIndex(paragraphs: PdfReadParagraph[], sentenceIndex: number): number {
  for (let i = paragraphs.length - 1; i >= 0; i--) {
    if (paragraphs[i].firstSentence <= sentenceIndex) return i
  }
  return 0
}

export default function PdfListenPlayer() {
  const location = useLocation()
  const navigate = useNavigate()
  const routeState = (location.state ?? {}) as PdfRouteState
  const path = routeState.path || ''

  const [reader, setReader] = useState<PdfDocumentData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [voice, setVoice] = useState(
    () => localStorage.getItem(VOICE_STORAGE_KEY) || 'en-US-AriaNeural',
  )
  const [status, setStatus] = useState<EngineStatus | null>(null)
  const [autoFollow, setAutoFollow] = useState(true)
  const [installOpen, setInstallOpen] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [installProgress, setInstallProgress] = useState<InstallProgress | null>(null)
  const [resumeIndex, setResumeIndex] = useState(0)
  const [scale, setScale] = useState(DEFAULT_SCALE)
  const [docVersion, setDocVersion] = useState(0)

  const scrollRef = useRef<HTMLDivElement>(null)
  const readerRef = useRef<PdfDocumentData | null>(null)
  const progressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const progressIndexRef = useRef(0)
  const progressPathRef = useRef('')
  const seekedRef = useRef('')

  const adjustScale = useCallback((delta: number) => {
    setScale((prev) => Math.round(Math.min(SCALE_MAX, Math.max(SCALE_MIN, prev + delta)) * 10) / 10)
  }, [])

  const paragraphs = useMemo(() => reader?.paragraphs ?? [], [reader])
  const paragraphsRef = useRef(paragraphs)
  paragraphsRef.current = paragraphs

  const sentencesByPage = useMemo(() => {
    const map = new Map<number, PdfSentenceSpan[]>()
    for (const sentence of reader?.sentences ?? []) {
      const list = map.get(sentence.page) ?? []
      list.push(sentence)
      map.set(sentence.page, list)
    }
    return map
  }, [reader])

  // progressIndexRef 与后端 last_sentence 同语义：以全局句为单位的游标。
  const saveProgress = useCallback((sentenceIdx: number, immediate = false) => {
    const pathNow = progressPathRef.current
    if (!pathNow) return
    progressIndexRef.current = sentenceIdx
    if (progressTimer.current) {
      clearTimeout(progressTimer.current)
      progressTimer.current = null
    }
    const commit = () => {
      void window.api.pdfUpdateProgress(pathNow, sentenceIdx).catch(() => {})
    }
    if (immediate) {
      commit()
      return
    }
    progressTimer.current = setTimeout(() => {
      progressTimer.current = null
      commit()
    }, 700)
  }, [])

  // hook 回报的是段落下标，换算成该段首句的全局句下标再落库。
  const handleIndexChange = useCallback(
    (paragraphIdx: number) => {
      saveProgress(paragraphsRef.current[paragraphIdx]?.firstSentence ?? 0)
    },
    [saveProgress],
  )

  const sourceKey = `${path}#${docVersion}`
  const player = usePdfReadAloud({
    paragraphs,
    voice,
    sourceKey,
    initialIndex: resumeIndex,
    onIndexChange: handleIndexChange,
    onError: (message) => showToast(message, 'warning'),
  })
  const {
    index,
    sentenceIndex,
    playing,
    loading: audioLoading,
    engine,
    rate,
    playAt,
    seek,
    toggle,
    next,
    prev,
    setRate,
  } = player

  const globalSentenceIndex = paragraphs[index]
    ? paragraphs[index].firstSentence + sentenceIndex
    : 0

  // 打开文档：读取原 PDF 字节，用 pdf.js 渲染并提取句子位置。
  useEffect(() => {
    let cancelled = false
    progressPathRef.current = path
    seekedRef.current = ''
    setReader(null)
    setError('')
    setLoading(true)
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
        const [fileResult, loadResult, engineStatus] = await Promise.all([
          window.api.pdfReadFile(path),
          window.api.pdfLoad(path).catch(() => null),
          window.api.ttsStatus().catch(() => null),
        ])
        if (cancelled) return
        if (!fileResult?.ok || !fileResult.data) {
          setError(fileResult?.error || '无法读取原 PDF 文件')
          setLoading(false)
          return
        }
        const data = await loadPdfDocument(fileResult.data)
        if (cancelled) {
          void data.dispose()
          return
        }
        readerRef.current = data
        setReader(data)
        const lastSentence = loadResult?.document?.lastSentence ?? 0
        setResumeIndex(findParagraphIndex(data.paragraphs, lastSentence))
        progressIndexRef.current = lastSentence
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
        setError(err instanceof Error ? err.message : '打开 PDF 失败')
        setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      // 重新解析或切换文档时释放上一份 pdf.js 资源
      const previous = readerRef.current
      readerRef.current = null
      if (previous) void previous.dispose()
    }
    // voice 只用于无可用引擎状态时的兜底，不应触发重新加载文档
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, docVersion])

  // 打开后把游标定位到上次停下的段落，但不自动播放。
  useEffect(() => {
    if (!reader || paragraphs.length === 0) return
    if (seekedRef.current === sourceKey) return
    seekedRef.current = sourceKey
    seek(resumeIndex)
  }, [reader, paragraphs, resumeIndex, seek, sourceKey])

  // 跟随朗读：滚到当前句所在页的句子位置。
  useEffect(() => {
    if (!autoFollow || !reader) return
    const sentence = reader.sentences[globalSentenceIndex]
    if (!sentence) return
    const timer = setTimeout(() => {
      const container = scrollRef.current
      const pageEl = container?.querySelector<HTMLElement>(`[data-page="${sentence.page}"]`)
      if (!container || !pageEl) return
      const firstRect = sentence.parts
        .map((part) => reader.items[part.itemIndex])
        .find((item) => item && item.page === sentence.page)?.rect
      const top = pageEl.offsetTop + (firstRect?.y ?? 0) * scale - 110
      container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
    }, 80)
    return () => clearTimeout(timer)
  }, [globalSentenceIndex, autoFollow, reader, scale])

  // 安装进度事件由后端推送，页面关闭时取消订阅。
  useEffect(() => {
    return window.api.ttsOnInstallProgress((progress) => {
      setInstallProgress(progress)
    })
  }, [])

  // 离开页面时立即落盘，避免最后一段进度丢失。
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
      const data = readerRef.current
      readerRef.current = null
      if (data) void data.dispose()
    }
  }, [])

  // 键盘快捷键：空格播放/暂停，左右切段，+/- 缩放页面。
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
      if (installOpen) return
      if (e.code === 'Space') {
        e.preventDefault()
        toggle()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        prev()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        next()
      } else if (e.code === 'Equal' || e.code === 'NumpadAdd') {
        e.preventDefault()
        adjustScale(SCALE_STEP)
      } else if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
        e.preventDefault()
        adjustScale(-SCALE_STEP)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [adjustScale, installOpen, next, prev, toggle])

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

  const handleSentenceClick = useCallback(
    (sentence: PdfSentenceSpan) => {
      const paragraphIndex = paragraphs.findIndex((p) => p.number === sentence.paragraph)
      if (paragraphIndex >= 0) playAt(paragraphIndex)
    },
    [paragraphs, playAt],
  )

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
      setDocVersion((v) => v + 1)
      showToast(`已重新解析：${result.pageCount} 页，${result.sentenceCount} 句`, 'success')
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
  const activePage = reader?.sentences[globalSentenceIndex]?.page ?? 0
  const engineLabel = ENGINE_LABELS[engine] || '准备就绪'

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-3rem)] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        正在打开原始 PDF 并提取朗读位置…
      </div>
    )
  }

  if (error || !reader) {
    return (
      <div className="flex h-[calc(100vh-3rem)] flex-col items-center justify-center gap-4 text-center">
        <FileText className="h-10 w-10 text-muted-foreground" />
        <div>
          <p className="text-lg font-medium">PDF 朗读不可用</p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            {error || '没有可朗读的内容'}
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
            <h1 className="truncate text-xl font-semibold" title={path}>
              {routeState.name || path.split('/').pop() || 'PDF 朗读'}
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {reader.pageCount} 页 · {paragraphs.length} 段
              {activePage ? ` · 当前第 ${activePage} 页` : ''} · {engineLabel}
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
            title="文件内容变更后重新提取朗读位置"
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
            title="上一段（←）"
            onClick={prev}
            disabled={paragraphs.length === 0}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            className="h-10 w-10 rounded-full"
            title={playing ? '暂停（空格）' : '播放（空格）'}
            onClick={toggle}
            disabled={paragraphs.length === 0}
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
            title="下一段（→）"
            onClick={next}
            disabled={paragraphs.length === 0}
          >
            <ChevronRight className="h-4 w-4" />
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
          <span className="pdf-listen-label">缩放</span>
          <button
            type="button"
            className="pdf-pill"
            title="缩小页面（-）"
            aria-label="缩小页面"
            disabled={scale <= SCALE_MIN}
            onClick={() => adjustScale(-SCALE_STEP)}
          >
            A-
          </button>
          <span className="pdf-font-scale-value">{Math.round(scale * 100)}%</span>
          <button
            type="button"
            className="pdf-pill"
            title="放大页面（+）"
            aria-label="放大页面"
            disabled={scale >= SCALE_MAX}
            onClick={() => adjustScale(SCALE_STEP)}
          >
            A+
          </button>
        </div>

        <div className="pdf-listen-divider" />

        <div className="flex items-center gap-2">
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
          <span className="tabular-nums">
            {paragraphs.length === 0 ? '0 / 0' : `${index + 1} / ${paragraphs.length}`}
          </span>
          {activePage > 0 && <span className="tabular-nums">P.{activePage}</span>}
        </div>
      </div>

      <div ref={scrollRef} className="pdf-page-scroll">
        {paragraphs.length === 0 && (
          <p className="pdf-no-text">这份 PDF 没有可提取的文字，页面仍可查看，但无法朗读。</p>
        )}
        {Array.from({ length: reader.pageCount }, (_, i) => i + 1).map((pageNo) => (
          <PdfPageView
            key={`${sourceKey}-${pageNo}`}
            pdf={reader.pdf}
            pageNumber={pageNo}
            scale={scale}
            sentences={sentencesByPage.get(pageNo) ?? []}
            items={reader.items}
            activeSentenceIndex={globalSentenceIndex}
            onSentenceClick={handleSentenceClick}
          />
        ))}
      </div>

      <p className="pdf-listen-hint">
        空格播放/暂停 · ←/→ 切段 · +/- 缩放 · 点击页面上的句子从该段连播
      </p>

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
