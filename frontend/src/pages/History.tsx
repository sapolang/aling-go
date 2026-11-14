import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePlayerStore } from '@/stores/playerStore'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { confirmDialog, showToast } from '@/components/feedback'
import type { HistoryEntry } from '@/types/electron'
import { basename } from '@/utils/path'
import { formatClockTime as formatTime } from '@/lib/subtitles'
import { History as HistoryIcon, PlayCircle, Trash2 } from 'lucide-react'

const PAGE_SIZE = 50

const KINDS = [
  { key: '', label: '全部' },
  { key: 'local', label: '本地' },
  { key: 'podcast', label: '播客' },
  { key: 'youtube', label: 'YouTube' },
  { key: 'bilibili', label: 'B站' },
]

const KIND_LABELS: Record<string, string> = {
  local: '本地',
  podcast: '播客',
  youtube: 'YouTube',
  bilibili: 'B站',
}

const IS_REMOTE = /^https?:\/\//i

export default function HistoryPage() {
  const navigate = useNavigate()
  const player = usePlayerStore()
  const [kind, setKind] = useState('')
  const [items, setItems] = useState<HistoryEntry[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)

  const fetchPage = useCallback(async (nextKind: string, offset: number) => {
    setLoading(true)
    try {
      const rows = await window.api.historyList(nextKind, PAGE_SIZE, offset)
      setItems((prev) => (offset === 0 ? rows : [...prev, ...rows]))
      setHasMore(rows.length === PAGE_SIZE)
    } catch {
      showToast('读取播放历史失败', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    window.api
      .historyList(kind, PAGE_SIZE, 0)
      .then((rows: HistoryEntry[]) => {
        if (cancelled) return
        setItems(rows || [])
        setHasMore((rows || []).length === PAGE_SIZE)
      })
      .catch(() => {
        if (!cancelled) showToast('读取播放历史失败', 'error')
      })
    return () => {
      cancelled = true
    }
  }, [kind])

  // 恢复播放：在线视频重新取流，播客在线音频直连，本地文件交给播放页加载波形与字幕
  const openEntry = async (entry: HistoryEntry) => {
    const meta = { cover: entry.cover, sourceUrl: entry.sourceUrl }
    if (entry.kind === 'youtube') {
      player.setFilePath(entry.mediaKey, entry.title, entry.episodeId, {
        ...meta,
        sourceKind: 'youtube',
        mediaKind: 'video',
        historyKey: entry.mediaKey,
      })
      navigate('/player', { state: { from: '/history' } })
      return
    }
    if (entry.kind === 'bilibili') {
      const res = await window.api.getBilibiliStream(entry.sourceUrl)
      if (!res.ok || !res.url) {
        showToast(res.error || '获取 B站 播放地址失败', 'error')
        return
      }
      player.setFilePath(res.url, entry.title, entry.episodeId, {
        ...meta,
        sourceKind: 'bilibili',
        mediaKind: 'video',
        historyKey: entry.mediaKey,
      })
      if (res.duration > 0) player.setDuration(res.duration)
      navigate('/player', { state: { from: '/history' } })
      return
    }
    player.setFilePath(entry.mediaKey, entry.title, entry.episodeId, meta)
    navigate('/player', { state: { from: '/history' } })
    if (IS_REMOTE.test(entry.mediaKey)) return
    player.setWaveformLoading(true)
    window.api
      .getWaveformData(entry.mediaKey)
      .then((data: number[]) => {
        if (data && data.length > 0) player.setWaveformData(data)
        else player.setWaveformLoading(false)
      })
      .catch(() => player.setWaveformLoading(false))
    try {
      const cached = await window.api.getCachedSubtitles(entry.mediaKey)
      if (cached && cached.length > 0) player.setSubtitles(cached)
    } catch {
      /* 字幕缓存读取失败不影响播放 */
    }
  }

  const removeEntry = async (entry: HistoryEntry) => {
    const ok = await confirmDialog({
      title: '删除这条播放记录？',
      description: '仅从学习历史移除，不会删除磁盘上的原文件。',
      confirmText: '删除',
      destructive: true,
    })
    if (!ok) return
    await window.api.historyDelete(entry.mediaKey)
    setItems((prev) => prev.filter((i) => i.mediaKey !== entry.mediaKey))
  }

  const clearAll = async () => {
    const ok = await confirmDialog({
      title: '清空全部播放历史？',
      description: '播放进度将一并清除，媒体库与收藏片段不受影响。',
      confirmText: '清空',
      destructive: true,
    })
    if (!ok) return
    await window.api.historyClear()
    setItems([])
    setHasMore(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {KINDS.map((k) => (
            <Button
              key={k.key}
              size="sm"
              variant={kind === k.key ? 'default' : 'outline'}
              onClick={() => setKind(k.key)}
            >
              {k.label}
            </Button>
          ))}
        </div>
        <Button size="sm" variant="ghost" onClick={clearAll} disabled={items.length === 0}>
          <Trash2 className="h-4 w-4 mr-1" /> 清空历史
        </Button>
      </div>

      {items.length === 0 && !loading && (
        <Card className="flex flex-col items-center justify-center gap-2 p-10 text-center">
          <HistoryIcon className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">还没有播放记录</p>
          <p className="text-xs text-muted-foreground">
            播放本地文件、播客或在线视频后，这里会自动记录进度
          </p>
        </Card>
      )}

      <div className="space-y-2">
        {items.map((entry) => {
          const pct =
            entry.duration > 0 ? Math.min(100, (entry.position / entry.duration) * 100) : 0
          return (
            <Card key={entry.mediaKey} className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="text-sm font-medium truncate">
                  {entry.title || basename(entry.mediaKey)}
                </p>
                <div className="h-1 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{KIND_LABELS[entry.kind] || entry.kind}</span>
                  <span>·</span>
                  <span>
                    {formatTime(entry.position)} / {formatTime(entry.duration)}
                  </span>
                  <span>·</span>
                  <span>{entry.lastPlayedAt}</span>
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => openEntry(entry)}>
                <PlayCircle className="h-4 w-4 mr-1" /> 继续
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground"
                onClick={() => removeEntry(entry)}
                title="删除记录"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </Card>
          )
        })}
      </div>

      {hasMore && (
        <div className="flex justify-center">
          <Button
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={() => fetchPage(kind, items.length)}
          >
            {loading ? '加载中…' : '加载更多'}
          </Button>
        </div>
      )}
    </div>
  )
}
