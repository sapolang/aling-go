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
import { useFeedStore, type FeedEpisode } from '@/stores/feedStore'
import { usePlayerStore } from '@/stores/playerStore'
import {
  Rss,
  Plus,
  RefreshCw,
  Trash2,
  Download,
  Play,
  Loader2,
  Settings2,
  Check,
  ExternalLink,
  ChevronDown,
  ChevronUp,
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
    downloadEpisode,
    setDownloadProgress,
  } = useFeedStore()

  const [showAdd, setShowAdd] = useState(false)
  const [showProxy, setShowProxy] = useState(false)
  const [feedURL, setFeedURL] = useState('')
  const [adding, setAdding] = useState(false)
  const [proxy, setProxy] = useState('')
  const [savingProxy, setSavingProxy] = useState(false)

  // YouTube/B站 链接转换
  const [showPlatformConvert, setShowPlatformConvert] = useState(false)
  const [platformURL, setPlatformURL] = useState('')
  const [converting, setConverting] = useState(false)

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
    setShowProxy(true)
  }

  const handleSaveProxy = async () => {
    setSavingProxy(true)
    try {
      const res = await window.api.feedSetProxy(proxy)
      if (res?.ok) {
        showToast('代理设置已保存', 'success')
        setShowProxy(false)
      } else {
        showToast(res?.error || '保存失败', 'error')
      }
    } finally {
      setSavingProxy(false)
    }
  }

  const handlePlay = async (ep: FeedEpisode) => {
    if (!ep.localPath) return
    player.setFilePath(ep.localPath)
    await window.api.recentAdd(ep.localPath)
    navigate('/player')
    player.setWaveformLoading(true)
    window.api
      .getWaveformData(ep.localPath)
      .then((data: number[]) => {
        if (data && data.length > 0) player.setWaveformData(data)
        else player.setWaveformLoading(false)
      })
      .catch(() => player.setWaveformLoading(false))
    const cached = await window.api.getCachedSubtitles(ep.localPath)
    if (cached && cached.length > 0) player.setSubtitles(cached)
  }

  const handleDownload = async (ep: FeedEpisode) => {
    const res = await downloadEpisode(ep.id)
    if (res.ok) {
      showToast('已下载并加入媒体库', 'success')
      // 媒体库数据变了，刷新订阅列表里的节目数量展示
      loadFeeds()
    } else {
      showToast(res.message, 'error')
    }
  }

  const handleOnlineListen = (ep: FeedEpisode) => {
    // 把节目信息通过 location state 传给在线播放器
    navigate('/player-online', {
      state: { episodeId: ep.id, link: ep.link, title: ep.title },
    })
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
    <div className="space-y-4">
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
            disabled={refreshing || feeds.length === 0}
            onClick={() => handleRefresh(0)}
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
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
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4 items-start">
          {/* 窄窗口下订阅源横向滚动，宽窗口下左侧竖排 */}
          <div className="flex gap-2 overflow-x-auto pb-1 lg:hidden">
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

          <Card className="hidden lg:block py-2">
            <div className="px-2 space-y-1 max-h-[calc(100vh-220px)] overflow-y-auto">
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

          <div className="space-y-3 min-w-0">
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
                    disabled={refreshing}
                    onClick={() => handleRefresh(selectedFeed.id)}
                  >
                    <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
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

            {loadingEpisodes ? (
              <div className="text-center text-muted-foreground py-12">加载节目列表...</div>
            ) : episodes.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center text-sm text-muted-foreground">
                  该订阅源暂无可播放的节目，点「刷新」重新拉取
                </CardContent>
              </Card>
            ) : (
              <Card className="py-0 overflow-hidden">
                <div className="divide-y">
                  {episodes.map((ep) => {
                    const pct = downloadProgress[ep.id]
                    const downloading = pct !== undefined
                    const isOnlineOnly = !ep.audioUrl && !!ep.link
                    return (
                      <div key={ep.id} className="p-3 flex items-start gap-3 hover:bg-muted/40">
                        <div className="flex-1 min-w-0 space-y-1">
                          <p className="text-sm font-medium line-clamp-2">
                            {ep.title || '未命名节目'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {[formatDate(ep.publishedAt), formatDuration(ep.duration)]
                              .filter(Boolean)
                              .join(' · ') || '未知发布时间'}
                          </p>
                          {ep.description && (
                            <p className="text-xs text-muted-foreground line-clamp-2">
                              {ep.description}
                            </p>
                          )}
                        </div>
                        <div className="shrink-0 flex items-center gap-1">
                          {isOnlineOnly ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleOnlineListen(ep)}
                            >
                              <Play className="h-4 w-4" />
                              在线精听
                            </Button>
                          ) : ep.localPath ? (
                            <>
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <Check className="h-3 w-3" /> 已下载
                              </span>
                              <Button size="sm" variant="outline" onClick={() => handlePlay(ep)}>
                                <Play className="h-4 w-4" />
                                播放
                              </Button>
                            </>
                          ) : downloading ? (
                            <span className="text-xs text-muted-foreground flex items-center gap-1 w-16 justify-end">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              {pct}%
                            </span>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => handleDownload(ep)}>
                              <Download className="h-4 w-4" />
                              下载
                            </Button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </Card>
            )}
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

      <Dialog open={showProxy} onOpenChange={setShowProxy}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>网络代理</DialogTitle>
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
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowProxy(false)}>
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
