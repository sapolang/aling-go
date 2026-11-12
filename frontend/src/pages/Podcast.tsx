import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { confirmDialog, showToast } from '@/components/feedback'
import { QRCodeSVG } from 'qrcode.react'
import { useFeedStore, type FeedEpisode } from '@/stores/feedStore'
import { usePlayerStore } from '@/stores/playerStore'
import type { PlatformSubtitleCue, PlatformSubtitleResult } from '@/types/electron.d.ts'
import {
  Rss,
  Plus,
  RefreshCw,
  Trash2,
  Play,
  Loader2,
  Settings2,
  Check,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  PlayCircle,
} from 'lucide-react'

// 推荐订阅源，都是公开发布的 RSS，不依赖任何私有接口
// BBC 与 TED 的源在国内网络直连经常超时，需要在播客页配置代理后使用
const recommendedFeeds = [
  { name: 'BBC 6 Minute English', url: 'https://podcasts.files.bbci.co.uk/p02pc9tn.rss' },
  { name: 'TED Talks Daily', url: 'https://feeds.acast.com/public/shows/ted-talks-daily' },
  { name: 'NPR News Now', url: 'https://feeds.npr.org/500005/podcast.xml' },
  { name: 'ESL Pod', url: 'https://www.eslpod.com/feed.xml' },
  {
    name: "Luke's English Podcast",
    url: 'https://feeds.acast.com/public/shows/62b0ada25c7ea10012f541cb',
  },
]

function formatDate(value: string): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

function formatDuration(seconds: number): string {
  if (!seconds) return ''
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟`
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`
}

export default function PodcastPage() {
  const navigate = useNavigate()
  // 记录来源页面，播放页的返回按钮回到这里而不是固定回文件库
  const openPlayer = () => navigate('/player', { state: { from: '/podcast' } })
  const player = usePlayerStore()
  const {
    feeds,
    episodes,
    selectedFeedId,
    loadingFeeds,
    loadingEpisodes,
    refreshing,
    downloadProgress,
    loadFeeds,
    addFeed,
    removeFeed,
    refreshFeed,
    selectFeed,
    setDownloadProgress,
  } = useFeedStore()

  const [showAdd, setShowAdd] = useState(false)
  const [showProxy, setShowProxy] = useState(false)
  const [feedURL, setFeedURL] = useState('')
  const [adding, setAdding] = useState(false)
  const [proxy, setProxy] = useState('')
  const [biliCookie, setBiliCookie] = useState('')
  const [savingProxy, setSavingProxy] = useState(false)

  // B站 扫码登录
  const [qrOpen, setQrOpen] = useState(false)
  const [qrURL, setQrURL] = useState('')
  const [qrKey, setQrKey] = useState('')
  const [qrStatus, setQrStatus] = useState<
    'loading' | 'waiting' | 'scanned' | 'expired' | 'failed'
  >('loading')
  const [qrError, setQrError] = useState('')

  // YouTube/B站 链接转换
  const [showPlatformConvert, setShowPlatformConvert] = useState(false)
  const [platformURL, setPlatformURL] = useState('')
  const [converting, setConverting] = useState(false)

  // 正在获取 B站 播放地址的节目，避免重复点击
  const [biliLoadingId, setBiliLoadingId] = useState<number | null>(null)

  const selectedFeed = useMemo(
    () => feeds.find((f) => f.id === selectedFeedId) || null,
    [feeds, selectedFeedId],
  )

  useEffect(() => {
    loadFeeds()
  }, [loadFeeds])

  // 下载进度由后端事件推送，避免前端轮询
  useEffect(() => {
    const cleanup = window.api.feedOnProgress((data: { episodeId: number; pct: number }) => {
      setDownloadProgress(data.episodeId, data.pct)
    })
    return () => cleanup()
  }, [setDownloadProgress])

  const handleAdd = async (url?: string) => {
    const target = (url ?? feedURL).trim()
    if (!target) return
    setAdding(true)
    try {
      const res = await addFeed(target)
      if (res.ok) {
        showToast(res.message || '订阅成功', 'success')
        setShowAdd(false)
        setFeedURL('')
      } else {
        showToast(res.message || '订阅失败', 'error')
      }
    } finally {
      setAdding(false)
    }
  }

  const handleRemove = async (id: number, title: string) => {
    const ok = await confirmDialog({
      title: `取消订阅《${title || '未命名'}》？`,
      description: '仅移除订阅记录与节目列表，已下载到本地的音频文件不会被删除。',
      confirmText: '取消订阅',
      cancelText: '保留',
      destructive: true,
    })
    if (!ok) return
    await removeFeed(id)
    showToast('已取消订阅', 'success')
  }

  const handleRefresh = async (id: number) => {
    const res = await refreshFeed(id)
    showToast(res.message || (res.ok ? '已更新' : '更新失败'), res.ok ? 'success' : 'error')
  }

  const openProxyDialog = async () => {
    setProxy(await window.api.feedGetProxy())
    setBiliCookie(await window.api.feedGetBilibiliCookie())
    setShowProxy(true)
  }

  const handleSaveProxy = async () => {
    setSavingProxy(true)
    try {
      const res = await window.api.feedSetProxy(proxy)
      if (!res?.ok) {
        showToast(res?.error || '保存失败', 'error')
        return
      }
      const cookieRes = await window.api.feedSetBilibiliCookie(biliCookie)
      if (cookieRes?.ok) {
        showToast('网络与 Cookie 设置已保存', 'success')
        setShowProxy(false)
      } else {
        showToast(cookieRes?.error || '保存失败', 'error')
      }
    } finally {
      setSavingProxy(false)
    }
  }

  const resetQR = () => {
    setQrOpen(false)
    setQrURL('')
    setQrKey('')
    setQrStatus('loading')
    setQrError('')
  }

  const startQR = async () => {
    setQrOpen(true)
    setQrStatus('loading')
    setQrError('')
    setQrURL('')
    setQrKey('')
    const res = await window.api.feedStartBilibiliQRLogin()
    if (!res?.ok || !res.url || !res.key) {
      setQrStatus('failed')
      setQrError(res?.error || '生成二维码失败')
      return
    }
    setQrURL(res.url)
    setQrKey(res.key)
    setQrStatus('waiting')
  }

  // 扫码后每 2 秒轮询一次登录状态
  useEffect(() => {
    if (!qrOpen || !qrKey) return
    let cancelled = false
    let timer: number | undefined
    const tick = async () => {
      const res = await window.api.feedPollBilibiliQRLogin(qrKey)
      if (cancelled) return
      if (res?.ok && res.status === 'success') {
        showToast('B站 登录成功', 'success')
        setBiliCookie(await window.api.feedGetBilibiliCookie())
        resetQR()
        return
      }
      if (res?.status === 'expired' || res?.status === 'failed' || !res?.ok) {
        setQrStatus(res?.status === 'expired' ? 'expired' : 'failed')
        setQrError(res?.error || '')
        return
      }
      setQrStatus(res.status === 'scanned' ? 'scanned' : 'waiting')
      timer = window.setTimeout(tick, 2000)
    }
    timer = window.setTimeout(tick, 1500)
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [qrOpen, qrKey])

  const qrStatusText =
    qrStatus === 'loading'
      ? '正在生成二维码…'
      : qrStatus === 'waiting'
        ? '请使用 B站 App 扫码'
        : qrStatus === 'scanned'
          ? '已扫码，请在手机上确认登录'
          : qrStatus === 'expired'
            ? '二维码已过期，请刷新'
            : qrError || '登录失败，请重试'

  const playLocalFile = async (path: string, title?: string) => {
    player.setFilePath(path, title)
    await window.api.recentAdd(path)
    openPlayer()
    player.setWaveformLoading(true)
    window.api
      .getWaveformData(path)
      .then((data: number[]) => {
        if (data && data.length > 0) player.setWaveformData(data)
        else player.setWaveformLoading(false)
      })
      .catch(() => player.setWaveformLoading(false))
    const cached = await window.api.getCachedSubtitles(path)
    if (cached && cached.length > 0) player.setSubtitles(cached)
  }

  // 平台字幕在后台拉取，回来后确认用户没有切走再写入
  const loadPlatformSubtitles = (episodeId: number, expectedPath: string) => {
    window.api
      .platformGetSubtitles(episodeId)
      .then((r: PlatformSubtitleResult) => {
        if (!r.ok || !r.cues || r.cues.length === 0) return
        if (usePlayerStore.getState().filePath !== expectedPath) return
        usePlayerStore.getState().setSubtitles(
          r.cues.map((c: PlatformSubtitleCue, i: number) => ({
            id: i,
            startTime: c.start,
            endTime: c.end,
            text: c.text,
          })),
        )
      })
      .catch(() => {
        // 字幕失败不影响播放，用户可在播放页重新转录
      })
  }

  // B站 节目：先用登录态换取本地代理播放地址，再交给统一播放页
  const playBilibiliEpisode = async (ep: FeedEpisode, bvid: string) => {
    if (biliLoadingId !== null) return
    setBiliLoadingId(ep.id)
    try {
      const res = await window.api.getBilibiliStream(bvid)
      if (!res.ok || !res.url) {
        showToast(res.error || '获取 B站 播放地址失败', 'error')
        return
      }
      player.setFilePath(res.url, ep.title || res.title || 'B站 视频', ep.id, {
        sourceKind: 'bilibili',
        mediaKind: 'video',
      })
      if (res.duration > 0) player.setDuration(res.duration)
      openPlayer()
      loadPlatformSubtitles(ep.id, res.url)
    } catch {
      showToast('获取 B站 播放地址失败', 'error')
    } finally {
      setBiliLoadingId(null)
    }
  }

  // YouTube 节目：把 videoId 交给统一播放页，iframe 通过本地中转页播放
  const playYouTubeEpisode = (ep: FeedEpisode, videoId: string) => {
    const sourcePath = `yt:${videoId}`
    player.setFilePath(sourcePath, ep.title || 'YouTube', ep.id, {
      sourceKind: 'youtube',
      mediaKind: 'video',
    })
    openPlayer()
    loadPlatformSubtitles(ep.id, sourcePath)
  }

  const handleEpisodeClick = async (ep: FeedEpisode) => {
    const isOnlineOnly = !ep.audioUrl && !!ep.link
    // 在线视频：B站 和 YouTube 都进统一播放页
    if (isOnlineOnly) {
      const bv = ep.link.match(/bilibili\.com\/video\/(BV[a-zA-Z0-9]+)/)
      if (bv) {
        await playBilibiliEpisode(ep, bv[1])
        return
      }
      const yt = ep.link.match(/(?:[?&]v=|youtu\.be\/|embed\/|shorts\/)([A-Za-z0-9_-]{11})/)
      if (yt) {
        playYouTubeEpisode(ep, yt[1])
        return
      }
      // 识别不出视频 ID 的站点暂不支持播放
      showToast('暂不支持该站点的视频，目前仅支持 B站 与 YouTube', 'error')
      return
    }
    // 已下载的音频优先播放本地文件，未下载的直接在线播放
    if (ep.localPath) {
      await playLocalFile(ep.localPath, ep.title)
      return
    }
    if (ep.audioUrl) {
      player.setFilePath(ep.audioUrl, ep.title, ep.id)
      openPlayer()
      try {
        const cached = await window.api.getCachedSubtitles(ep.audioUrl)
        if (cached && cached.length > 0 && usePlayerStore.getState().filePath === ep.audioUrl) {
          player.setSubtitles(cached)
        }
      } catch {
        // 缓存读取失败不影响在线播放，可在播放页重新转录
      }
    }
  }

  const handleConvertPlatform = async () => {
    const url = platformURL.trim()
    if (!url) return
    setConverting(true)
    try {
      const res = await window.api.platformConvertToRSS(url)
      if (res.ok && res.rssUrl) {
        setFeedURL(res.rssUrl)
        setShowPlatformConvert(false)
        setPlatformURL('')
        showToast(`已转换为 ${res.platform} 订阅源 RSS，点击下方「订阅」即可`, 'success')
      } else {
        showToast(res.error || '转换失败', 'error')
      }
    } catch {
      showToast('转换请求失败，请检查网络或代理设置', 'error')
    } finally {
      setConverting(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Rss className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">播客订阅</h2>
        <span className="text-xs text-muted-foreground">
          {feeds.length > 0 ? `${feeds.length} 个订阅源` : '订阅 RSS 后自动获取节目'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={openProxyDialog}
            title="配置拉取订阅源使用的网络代理"
          >
            <Settings2 className="h-4 w-4" />
            代理
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={refreshing !== null || feeds.length === 0}
            onClick={() => handleRefresh(0)}
          >
            <RefreshCw className={`h-4 w-4 ${refreshing === 0 ? 'animate-spin' : ''}`} />
            全部刷新
          </Button>
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4" />
            添加订阅
          </Button>
        </div>
      </div>

      {loadingFeeds && feeds.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">加载中...</div>
      ) : feeds.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center space-y-4">
            <Rss className="h-8 w-8 mx-auto text-muted-foreground" />
            <div className="space-y-1">
              <p className="font-medium">还没有订阅任何播客</p>
              <p className="text-sm text-muted-foreground">
                粘贴一个 RSS 地址，或从下面推荐源开始；下载音频后可直接进入播放器精听
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {recommendedFeeds.map((f) => (
                <Button
                  key={f.url}
                  variant="outline"
                  size="sm"
                  disabled={adding}
                  onClick={() => handleAdd(f.url)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {f.name}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
          {/* 窄窗口下订阅源横向滚动，宽窗口下左侧竖排 */}
          <div className="flex shrink-0 gap-2 overflow-x-auto pb-1 lg:hidden">
            {feeds.map((f) => (
              <button
                key={f.id}
                onClick={() => selectFeed(f.id)}
                className={`shrink-0 max-w-[180px] rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                  selectedFeedId === f.id
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-muted/50'
                }`}
              >
                <span className="block truncate font-medium">{f.title || '未命名订阅'}</span>
                <span className="text-xs text-muted-foreground">{f.episodeCount} 期</span>
              </button>
            ))}
          </div>

          <Card className="hidden py-2 lg:flex lg:w-[260px] lg:shrink-0 lg:flex-col">
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-2">
              {feeds.map((f) => (
                <div
                  key={f.id}
                  className={`group flex items-center gap-2 rounded-lg px-2 py-2 cursor-pointer transition-colors ${
                    selectedFeedId === f.id ? 'bg-muted' : 'hover:bg-muted/60'
                  }`}
                  onClick={() => selectFeed(f.id)}
                >
                  {f.image ? (
                    <img
                      src={f.image}
                      alt=""
                      className="h-9 w-9 rounded object-cover shrink-0"
                      onError={(e) => {
                        ;(e.currentTarget as HTMLImageElement).style.display = 'none'
                      }}
                    />
                  ) : (
                    <div className="h-9 w-9 rounded bg-muted flex items-center justify-center shrink-0">
                      <Rss className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{f.title || '未命名订阅'}</p>
                    <p className="text-xs text-muted-foreground">
                      {f.episodeCount} 期
                      {f.lastError ? <span className="text-destructive"> · 更新失败</span> : null}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 shrink-0"
                    title="取消订阅"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleRemove(f.id, f.title)
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </Card>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
            {selectedFeed && (
              <div className="flex items-center gap-2 flex-wrap">
                <div className="min-w-0">
                  <h3 className="font-semibold truncate">{selectedFeed.title || '未命名订阅'}</h3>
                  {selectedFeed.description && (
                    <p className="text-xs text-muted-foreground line-clamp-1">
                      {selectedFeed.description}
                    </p>
                  )}
                </div>
                <div className="ml-auto flex items-center gap-2 shrink-0">
                  {selectedFeed.siteUrl && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => window.api.openExternal(selectedFeed.siteUrl)}
                    >
                      <ExternalLink className="h-4 w-4" />
                      主页
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={refreshing !== null}
                    onClick={() => handleRefresh(selectedFeed.id)}
                  >
                    <RefreshCw
                      className={`h-4 w-4 ${refreshing === selectedFeed.id ? 'animate-spin' : ''}`}
                    />
                    刷新
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="lg:hidden"
                    onClick={() => handleRemove(selectedFeed.id, selectedFeed.title)}
                  >
                    <Trash2 className="h-4 w-4" />
                    取消订阅
                  </Button>
                </div>
              </div>
            )}

            {selectedFeed?.lastError && (
              <p className="text-xs text-destructive break-all">{selectedFeed.lastError}</p>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
              {loadingEpisodes ? (
                <div className="text-center text-muted-foreground py-12">加载节目列表...</div>
              ) : episodes.length === 0 ? (
                <Card>
                  <CardContent className="p-8 text-center text-sm text-muted-foreground">
                    该订阅源暂无可播放的节目，点「刷新」重新拉取
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {episodes.map((ep) => {
                    const pct = downloadProgress[ep.id]
                    const downloading = pct !== undefined
                    const isOnlineOnly = !ep.audioUrl && !!ep.link
                    const thumb = ep.image || selectedFeed?.image || ''
                    const meta = [formatDate(ep.publishedAt), formatDuration(ep.duration)]
                      .filter(Boolean)
                      .join(' · ')
                    return (
                      <div
                        key={ep.id}
                        onClick={() => !downloading && handleEpisodeClick(ep)}
                        className={`group rounded-lg border bg-card overflow-hidden transition-colors ${
                          downloading ? 'opacity-80' : 'cursor-pointer hover:border-primary/50'
                        }`}
                      >
                        {/* 缩略图 */}
                        <div className="relative aspect-video bg-muted overflow-hidden">
                          {thumb ? (
                            <img
                              src={thumb}
                              alt={ep.title}
                              className="w-full h-full object-cover"
                              loading="lazy"
                              onError={(e) => {
                                ;(e.currentTarget as HTMLImageElement).style.display = 'none'
                              }}
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-muted-foreground/40">
                              <PlayCircle className="h-10 w-10" />
                            </div>
                          )}
                          {/* 悬浮播放图标 */}
                          {!downloading && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-colors">
                              <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                                <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center">
                                  <Play className="h-6 w-6 text-black ml-0.5" />
                                </div>
                              </div>
                            </div>
                          )}
                          {isOnlineOnly && (
                            <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[10px] font-medium bg-black/60 text-white flex items-center gap-1">
                              <PlayCircle className="h-3 w-3" />
                              视频
                            </span>
                          )}
                          {ep.localPath && (
                            <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/80 text-primary-foreground flex items-center gap-1">
                              <Check className="h-3 w-3" />
                              已下载
                            </span>
                          )}
                          {downloading && (
                            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                              <div className="text-center text-white">
                                <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                                <span className="text-sm">{pct}%</span>
                              </div>
                            </div>
                          )}
                          {biliLoadingId === ep.id && (
                            <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2 text-white">
                              <Loader2 className="h-6 w-6 animate-spin" />
                              <span className="text-xs">获取播放地址…</span>
                            </div>
                          )}
                        </div>
                        {/* 内容 */}
                        <div className="p-3 space-y-1.5">
                          <p className="text-sm font-medium line-clamp-2 leading-snug min-h-[2.5rem]">
                            {ep.title || '未命名节目'}
                          </p>
                          {meta && <p className="text-xs text-muted-foreground">{meta}</p>}
                          {ep.description && (
                            <p className="text-xs text-muted-foreground line-clamp-2">
                              {ep.description}
                            </p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>添加播客订阅</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="feed-url">RSS 地址</Label>
              <Input
                id="feed-url"
                placeholder="https://example.com/podcast.rss"
                value={feedURL}
                onChange={(e) => setFeedURL(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAdd()
                }}
              />
              <p className="text-xs text-muted-foreground">
                支持标准 RSS 2.0 播客源；拉取失败时可在右上角「代理」中配置网络代理
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>推荐订阅源</Label>
              <div className="flex flex-wrap gap-2">
                {recommendedFeeds.map((f) => (
                  <Button
                    key={f.url}
                    variant="outline"
                    size="sm"
                    disabled={adding}
                    onClick={() => handleAdd(f.url)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {f.name}
                  </Button>
                ))}
              </div>
            </div>
            <div>
              <button
                type="button"
                onClick={() => setShowPlatformConvert(!showPlatformConvert)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {showPlatformConvert ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
                从 YouTube / B站 频道链接生成 RSS
              </button>
              {showPlatformConvert && (
                <div className="mt-2 space-y-1.5 rounded-md border border-border p-3">
                  <Label htmlFor="platform-url" className="text-xs">
                    YouTube 频道主页或 B站 UP主 空间链接
                  </Label>
                  <Input
                    id="platform-url"
                    placeholder="https://www.youtube.com/@MKBHD 或 https://space.bilibili.com/123456"
                    value={platformURL}
                    onChange={(e) => setPlatformURL(e.target.value)}
                    disabled={converting}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    YouTube 自动识别频道 ID；B站 通过 RSSHub
                    桥接，若转换失败请在播客页代理设置旁配置 RSSHub 实例
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!platformURL.trim() || converting}
                    onClick={handleConvertPlatform}
                  >
                    {converting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    转换为 RSS
                  </Button>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowAdd(false)}>
              取消
            </Button>
            <Button disabled={adding || !feedURL.trim()} onClick={() => handleAdd()}>
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              订阅
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showProxy}
        onOpenChange={(open) => {
          setShowProxy(open)
          if (!open) resetQR()
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>网络与 Cookie</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="feed-proxy">代理地址</Label>
            <Input
              id="feed-proxy"
              placeholder="http://127.0.0.1:7890"
              value={proxy}
              onChange={(e) => setProxy(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              仅用于拉取订阅源和下载节目音频，留空表示直连
            </p>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>B站 登录态</Label>
              <Button
                variant="outline"
                size="sm"
                disabled={qrOpen && qrStatus === 'loading'}
                onClick={startQR}
              >
                {qrOpen && qrStatus === 'loading' ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : null}
                {qrOpen ? '刷新二维码' : '扫码登录'}
              </Button>
            </div>
            {qrOpen ? (
              <div className="flex flex-col items-center gap-2 rounded-md border p-3">
                {qrURL ? (
                  <QRCodeSVG value={qrURL} size={160} />
                ) : (
                  <div className="flex h-40 w-40 items-center justify-center text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                )}
                <p
                  className={`text-xs ${
                    qrStatus === 'expired' || qrStatus === 'failed'
                      ? 'text-destructive'
                      : 'text-muted-foreground'
                  }`}
                >
                  {qrStatusText}
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                扫码登录后可稳定拉取 B站 订阅源列表，登录态仅保存在本机。
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bili-cookie">B站 Cookie（可选）</Label>
            <Input
              id="bili-cookie"
              placeholder="SESSDATA=xxx; bili_jct=xxx"
              value={biliCookie}
              onChange={(e) => setBiliCookie(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              扫码成功后会自动填入。也可以手动在浏览器登录 B站 后按 F12 → Application →
              Cookies，复制 SESSDATA（建议连同 bili_jct、buvid3）粘贴到这里。
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setShowProxy(false)
                resetQR()
              }}
            >
              取消
            </Button>
            <Button disabled={savingProxy} onClick={handleSaveProxy}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
