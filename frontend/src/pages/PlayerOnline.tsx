import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { showToast } from '@/components/feedback'
import { ArrowLeft, Loader2, ListChecks, Quote, ExternalLink, Download } from 'lucide-react'
import type { PlatformSubtitleCue, PlatformSubtitleResult } from '@/types/electron.d.ts'

// iframe 里的 YouTube embed 播放器通过 postMessage 向外层暴露状态
// 我们监听这些消息来同步播放时间和播放状态
// 参考：https://developers.google.cn/youtube/player_parameters

type Platform = 'youtube' | 'bilibili'

interface OnlinePlayerState {
  episodeId: number
  link: string
  title: string
}

// 从 YouTube/B站 视频页面 URL 提取 videoId / bvid
function extractID(link: string): { platform: Platform | null; id: string } {
  // YouTube
  const ytWatch = link.match(/[?&]v=([a-zA-Z0-9_-]{11})/)
  if (ytWatch) return { platform: 'youtube', id: ytWatch[1] }
  const ytShort = link.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/)
  if (ytShort) return { platform: 'youtube', id: ytShort[1] }
  const ytEmbed = link.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/)
  if (ytEmbed) return { platform: 'youtube', id: ytEmbed[1] }
  const ytAt = link.match(/youtube\.com\/@([^/?#]+)/)
  if (ytAt) return { platform: 'youtube', id: '@' + ytAt[1] }
  // Bilibili
  const bv = link.match(/bilibili\.com\/video\/(BV[a-zA-Z0-9]+)/)
  if (bv) return { platform: 'bilibili', id: bv[1] }
  return { platform: null, id: '' }
}

function buildEmbedURL(platform: Platform, id: string, mediaPort: number): string {
  if (platform === 'youtube') {
    // 通过本地 http 中转页嵌入：wails:// 页面直接嵌 YouTube 会因缺少 Referer 报错误 153
    if (!mediaPort) return ''
    return `http://127.0.0.1:${mediaPort}/yt-embed?v=${id}`
  }
  return `//player.bilibili.com/player.html?bvid=${id}&page=1&high_quality=1&danmaku=0&autoplay=1`
}

function formatTime(seconds: number): string {
  if (!seconds || seconds < 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function PlayerOnlinePage() {
  const location = useLocation()
  const navigate = useNavigate()
  const state = (location.state as OnlinePlayerState | null) || null

  const { platform, id } = state?.link ? extractID(state.link) : { platform: null, id: '' }
  const isValid = !!state && !!platform && !!id

  // 字幕状态
  const [subtitleResult, setSubtitleResult] = useState<PlatformSubtitleResult | null>(null)
  const [loadingSubs, setLoadingSubs] = useState(false)
  const [subError, setSubError] = useState<string>('')

  // 播放时间（由本地中转页 postMessage 回传）
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [mediaPort, setMediaPort] = useState(0)

  const containerRef = useRef<HTMLDivElement>(null)
  const subtitleRefs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    window.api.getMediaPort().then(setMediaPort)
  }, [])

  // 抓取字幕
  useEffect(() => {
    if (!isValid || !state?.episodeId) return
    setLoadingSubs(true)
    setSubError('')
    window.api
      .platformGetSubtitles(state.episodeId)
      .then((res: PlatformSubtitleResult) => {
        setSubtitleResult(res)
        if (!res.ok) setSubError(res.error || '字幕获取失败')
      })
      .catch(() => {
        setSubError('字幕请求异常')
      })
      .finally(() => {
        setLoadingSubs(false)
      })
  }, [isValid, state?.episodeId])

  const fetchSubtitles = () => {
    // 重试按钮复用同一个逻辑
    setLoadingSubs(true)
    setSubError('')
    if (!state?.episodeId) return
    window.api
      .platformGetSubtitles(state.episodeId)
      .then((res: PlatformSubtitleResult) => {
        setSubtitleResult(res)
        if (!res.ok) setSubError(res.error || '字幕获取失败')
      })
      .catch(() => {
        setSubError('字幕请求异常')
      })
      .finally(() => {
        setLoadingSubs(false)
      })
  }

  // 本地中转页通过 postMessage 回传播放进度与时长
  useEffect(() => {
    if (!isValid || platform !== 'youtube') return

    const handleMessage = (event: MessageEvent) => {
      let data: any = event.data
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data)
        } catch {
          return
        }
      }
      if (!data || data.source !== 'yt-embed' || data.event !== 'status') return
      if (typeof data.currentTime === 'number') {
        setCurrentTime(data.currentTime)
      }
      if (typeof data.duration === 'number' && data.duration > 0) {
        setDuration(data.duration)
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [isValid, platform])

  // 高亮当前字幕：用 useMemo 计算，避免在 effect 里 setState
  const currentCueIndex = useMemo(() => {
    const cues = subtitleResult?.cues
    if (!cues || cues.length === 0) return -1
    let lo = 0,
      hi = cues.length - 1,
      found = -1
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2)
      const c = cues[mid]
      if (currentTime >= c.start && currentTime < c.end) {
        found = mid
        break
      } else if (currentTime < c.start) {
        hi = mid - 1
      } else {
        lo = mid + 1
      }
    }
    return found
  }, [currentTime, subtitleResult?.cues])

  // 当前字幕滚到视野内
  useEffect(() => {
    if (currentCueIndex < 0) return
    const el = subtitleRefs.current[currentCueIndex]
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [currentCueIndex])

  const handleSaveSegment = () => {
    if (currentCueIndex < 0 || !subtitleResult?.cues) return
    const cue = subtitleResult.cues[currentCueIndex]
    showToast(`已标记片段："${cue.text.slice(0, 30)}..."`, 'success')
  }

  // Hooks 全部声明完毕后再做 early return
  if (!isValid) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-12 text-center">
        <ListChecks className="h-12 w-12 text-muted-foreground" />
        <h2 className="text-xl font-semibold">请从播客订阅页进入</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          在播客订阅页订阅 YouTube/B站
          频道后，节目列表里会出现「在线精听」按钮，点击即可进入此页面。
        </p>
        <Button variant="outline" onClick={() => navigate('/podcast')}>
          前往播客订阅
        </Button>
      </div>
    )
  }

  const iframeURL = buildEmbedURL(platform!, id, mediaPort)

  return (
    <div className="flex flex-col h-full">
      {/* 顶部工具栏 */}
      <div className="flex items-center gap-2 px-4 py-2 border-b shrink-0">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" />
          返回
        </Button>
        <h2 className="text-sm font-medium truncate flex-1">{state.title || '在线精听'}</h2>
        {state.link && (
          <Button variant="ghost" size="sm" onClick={() => window.open(state.link, '_blank')}>
            <ExternalLink className="h-4 w-4" />
            原页面
          </Button>
        )}
      </div>

      {/* 主区域：视频 + 字幕 双栏 */}
      <div
        ref={containerRef}
        className="flex-1 flex flex-col lg:flex-row gap-4 p-4 min-h-0 overflow-hidden"
      >
        {/* 视频/播放器 */}
        <div className="flex-1 min-h-0 min-w-0 flex flex-col">
          <Card className="flex-1 overflow-hidden">
            <CardContent className="p-0 h-full">
              <iframe
                src={iframeURL}
                title={state.title || '在线播放器'}
                className="w-full h-full border-0 bg-black"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </CardContent>
          </Card>
          {currentTime > 0 && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-2">
              <span>{formatTime(currentTime)}</span>
              <span>/</span>
              <span>{formatTime(duration)}</span>
              <span className="ml-auto">{platform === 'youtube' ? 'YouTube' : 'Bilibili'}</span>
            </div>
          )}
        </div>

        {/* 右侧字幕面板 */}
        <Card className="lg:w-[420px] shrink-0 flex flex-col min-h-0">
          <CardContent className="p-0 flex flex-col h-full">
            <div className="flex items-center gap-2 px-3 py-2 border-b shrink-0">
              <ListChecks className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">字幕</span>
              <div className="ml-auto flex items-center gap-1">
                {loadingSubs && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                {!loadingSubs && subtitleResult?.ok && subtitleResult.cues && (
                  <span className="text-xs text-muted-foreground">
                    {subtitleResult.cues.length} 条
                  </span>
                )}
              </div>
            </div>

            {subError ? (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-3">
                <p className="text-sm text-destructive">{subError}</p>
                {state.link && (
                  <p className="text-xs text-muted-foreground">
                    可直接在原页面查看字幕，或等后续支持本地下载精听
                  </p>
                )}
                <Button variant="outline" size="sm" onClick={fetchSubtitles} disabled={loadingSubs}>
                  {loadingSubs ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  重试
                </Button>
              </div>
            ) : loadingSubs ? (
              <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                正在抓取字幕...
              </div>
            ) : subtitleResult?.cues && subtitleResult.cues.length > 0 ? (
              <div className="flex-1 overflow-y-auto py-1">
                {subtitleResult.cues.map((cue: PlatformSubtitleCue, idx: number) => (
                  <div
                    key={idx}
                    ref={(el) => {
                      subtitleRefs.current[idx] = el
                    }}
                    className={`px-3 py-1.5 cursor-pointer border-l-2 transition-colors text-sm leading-relaxed ${
                      idx === currentCueIndex
                        ? 'border-primary bg-primary/5 font-medium'
                        : 'border-transparent hover:bg-muted/40'
                    }`}
                  >
                    <span className="text-[11px] text-muted-foreground mr-2 align-middle">
                      {formatTime(cue.start)}
                    </span>
                    <span>{cue.text}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm px-6 text-center">
                该视频没有可用字幕
              </div>
            )}

            {/* 底部操作栏 */}
            <div className="flex items-center gap-1 px-3 py-2 border-t shrink-0">
              <Button
                variant="ghost"
                size="sm"
                disabled={currentCueIndex < 0}
                onClick={handleSaveSegment}
                title="将当前字幕片段收藏到生词本"
              >
                <Quote className="h-3.5 w-3.5" />
                收藏片段
              </Button>
              <Button variant="ghost" size="sm" disabled title="本地下载精听功能待实现">
                <Download className="h-3.5 w-3.5" />
                本地下载
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
