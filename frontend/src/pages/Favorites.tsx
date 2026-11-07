import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePlayerStore } from '@/stores/playerStore'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Star, Play, Pause, Trash2, Plus, X, CheckCircle2, ExternalLink } from 'lucide-react'
import { confirmDialog } from '@/components/feedback'

interface FavoriteClip {
  id: number
  filePath: string
  fileName: string
  startTime: number
  endTime: number
  text: string
  tagId: number
  tagName: string
  word: string
  reviewCount: number
  lastReviewedAt: string
  createdAt: string
}

interface FavoriteTag {
  id: number
  name: string
}

const formatTime = (s: number) => {
  const m = Math.floor(s / 60)
  return `${m}:${Math.floor(s % 60)
    .toString()
    .padStart(2, '0')}`
}

const isAudioPath = (path: string) =>
  ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac'].includes(path.split('.').pop()?.toLowerCase() || '')

const formatDate = (s: string) => (s ? s.split(' ')[0] : '')

export default function FavoritesPage() {
  const navigate = useNavigate()
  const [clips, setClips] = useState<FavoriteClip[]>([])
  const [tags, setTags] = useState<FavoriteTag[]>([])
  const [selectedTag, setSelectedTag] = useState(0)
  const [newTag, setNewTag] = useState('')
  const [activeWord, setActiveWord] = useState<string | null>(null)
  const [playingClip, setPlayingClip] = useState<FavoriteClip | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [mediaPort, setMediaPort] = useState(0)
  const [mediaError, setMediaError] = useState('')
  const mediaRef = useRef<{ el: HTMLMediaElement | null }>({ el: null })

  const loadTags = () => window.api.favoriteTagsList().then((t: FavoriteTag[]) => setTags(t || []))

  const loadClips = (tagId: number) =>
    window.api.favoriteList(tagId).then((list: FavoriteClip[]) => setClips(list || []))

  useEffect(() => {
    loadTags()
    window.api.getMediaPort().then(setMediaPort)
  }, [])

  useEffect(() => {
    loadClips(selectedTag)
  }, [selectedTag])

  // 按关联单词分组，未关联的归到「未归类」
  const groups = useMemo(() => {
    const map = new Map<string, FavoriteClip[]>()
    for (const c of clips) {
      const key = (c.word || '').trim()
      const list = map.get(key) || []
      list.push(c)
      map.set(key, list)
    }
    return Array.from(map, ([word, items]) => ({
      word,
      items,
      reviewed: items.filter((c) => c.reviewCount > 0).length,
    })).sort((a, b) => {
      if (!a.word) return 1
      if (!b.word) return -1
      return b.items.length - a.items.length
    })
  }, [clips])

  // 当前分组被筛掉后回到「全部片段」
  useEffect(() => {
    if (activeWord !== null && !groups.some((g) => g.word === activeWord)) {
      setActiveWord(null)
    }
  }, [groups, activeWord])

  const shownClips =
    activeWord === null ? clips : groups.find((g) => g.word === activeWord)?.items || []

  const mediaUrl =
    playingClip && mediaPort
      ? `http://127.0.0.1:${mediaPort}/media/${encodeURIComponent(playingClip.filePath)}`
      : ''

  const addTag = async () => {
    const name = newTag.trim()
    if (!name) return
    await window.api.favoriteTagAdd(name)
    setNewTag('')
    loadTags()
  }

  const deleteTag = async (id: number) => {
    const ok = await confirmDialog({
      title: '删除这个标签？',
      description: '标签下的收藏片段会保留，并变为未分类。',
      confirmText: '删除',
      destructive: true,
    })
    if (!ok) return
    await window.api.favoriteTagDelete(id)
    if (selectedTag === id) setSelectedTag(0)
    loadTags()
    loadClips(selectedTag === id ? 0 : selectedTag)
  }

  const deleteClip = async (id: number) => {
    const ok = await confirmDialog({
      title: '删除这个收藏片段？',
      description: '删除后无法恢复。',
      confirmText: '删除',
      destructive: true,
    })
    if (!ok) return
    await window.api.favoriteDelete(id)
    setClips((prev) => prev.filter((c) => c.id !== id))
    setPlayingClip((prev) => (prev?.id === id ? null : prev))
  }

  const markReviewed = async (clip: FavoriteClip) => {
    await window.api.favoriteMarkReviewed(clip.id)
    loadClips(selectedTag)
  }

  const startClip = () => {
    const media = mediaRef.current.el
    if (!media || !playingClip) return
    media.currentTime = playingClip.startTime
    media.play().catch(() => setMediaError('无法自动播放，请点击播放器上的播放按钮'))
  }

  const loopClip = () => {
    const media = mediaRef.current.el
    if (!media || !playingClip) return
    if (media.currentTime >= playingClip.endTime) {
      media.currentTime = playingClip.startTime
    }
  }

  const toggleClip = (clip: FavoriteClip) => {
    if (playingClip?.id === clip.id) {
      const media = mediaRef.current.el
      if (!media) return
      if (media.paused) {
        media.play().catch(() => {})
      } else {
        media.pause()
      }
      return
    }
    setPlayingClip(clip)
    setMediaError('')
    setIsPlaying(false)
  }

  // 跳转播放器，定位到片段起点并循环
  const playInPlayer = (clip: FavoriteClip) => {
    const store = usePlayerStore.getState()
    if (store.filePath === clip.filePath) {
      store.setLoop(clip.startTime, clip.endTime)
      store.requestSeek(clip.startTime)
      store.setPlaying(true)
    } else {
      store.setPlayClip({
        filePath: clip.filePath,
        startTime: clip.startTime,
        endTime: clip.endTime,
      })
      store.setFilePath(clip.filePath)
      window.api.getCachedSubtitles(clip.filePath).then((subs: any) => {
        if (subs) usePlayerStore.getState().setSubtitles(subs)
      })
      window.api.recentAdd(clip.filePath)
    }
    navigate('/player')
  }

  return (
    <div className="max-w-4xl lg:max-w-5xl xl:max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Star className="h-6 w-6" /> 收藏工作台
        </h1>
        <div className="flex gap-2">
          <Input
            placeholder="新标签名称"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addTag()}
            className="w-40"
          />
          <Button variant="outline" size="sm" onClick={addTag} disabled={!newTag.trim()}>
            <Plus className="h-4 w-4 mr-1" /> 添加标签
          </Button>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <Badge
          variant={selectedTag === 0 ? 'default' : 'outline'}
          className="cursor-pointer"
          onClick={() => setSelectedTag(0)}
        >
          全部
        </Badge>
        {tags.map((t) => (
          <Badge
            key={t.id}
            variant={selectedTag === t.id ? 'default' : 'outline'}
            className="cursor-pointer flex items-center gap-1"
            onClick={() => setSelectedTag(t.id)}
          >
            {t.name}
            <button
              className="ml-1 hover:text-destructive"
              title="删除标签"
              onClick={(e) => {
                e.stopPropagation()
                deleteTag(t.id)
              }}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
      </div>

      {clips.length === 0 ? (
        <div className="text-center text-muted-foreground py-16">
          <p>暂无收藏片段</p>
          <p className="text-sm mt-1">在播放器字幕列表中点击 ★ 收藏当前句</p>
        </div>
      ) : (
        <div className="flex gap-4 items-start">
          {/* 左侧词表 */}
          <Card className="w-56 shrink-0 p-2">
            <button
              className={`w-full text-left px-3 py-2 rounded-md text-sm flex items-center justify-between ${
                activeWord === null ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
              }`}
              onClick={() => setActiveWord(null)}
            >
              <span>全部片段</span>
              <span className="text-xs opacity-80">{clips.length}</span>
            </button>
            <div className="mt-1 space-y-1">
              {groups.map((g) => (
                <button
                  key={g.word || '__ungrouped__'}
                  className={`w-full text-left px-3 py-2 rounded-md ${
                    activeWord === g.word ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                  }`}
                  onClick={() => setActiveWord(g.word)}
                >
                  <span className="text-sm font-medium block truncate">{g.word || '未归类'}</span>
                  <span className="text-xs opacity-70 block">
                    {g.items.length} 个片段 · 已复习 {g.reviewed}/{g.items.length}
                  </span>
                </button>
              ))}
            </div>
          </Card>

          {/* 右侧片段区 */}
          <div className="flex-1 min-w-0 space-y-3">
            {playingClip && (
              <Card className="p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium line-clamp-2">{playingClip.text}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {playingClip.fileName} · {formatTime(playingClip.startTime)} -{' '}
                      {formatTime(playingClip.endTime)} · 循环本片段
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    title="关闭播放器"
                    onClick={() => setPlayingClip(null)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                {isAudioPath(playingClip.filePath) ? (
                  <audio
                    key={playingClip.id}
                    ref={(el) => {
                      mediaRef.current.el = el
                    }}
                    src={mediaUrl}
                    controls
                    className="w-full"
                    onLoadedMetadata={startClip}
                    onTimeUpdate={loopClip}
                    onPlay={() => {
                      setIsPlaying(true)
                      setMediaError('')
                    }}
                    onPause={() => setIsPlaying(false)}
                    onError={() => setMediaError('无法加载该文件，可能已被移动或删除')}
                  />
                ) : (
                  <video
                    key={playingClip.id}
                    ref={(el) => {
                      mediaRef.current.el = el
                    }}
                    src={mediaUrl}
                    controls
                    className="w-full max-h-[320px] rounded bg-black"
                    onLoadedMetadata={startClip}
                    onTimeUpdate={loopClip}
                    onPlay={() => {
                      setIsPlaying(true)
                      setMediaError('')
                    }}
                    onPause={() => setIsPlaying(false)}
                    onError={() => setMediaError('无法加载该文件，可能已被移动或删除')}
                  />
                )}
                {mediaError && <p className="text-xs text-destructive">{mediaError}</p>}
              </Card>
            )}

            {shownClips.length === 0 ? (
              <div className="text-center text-muted-foreground py-16">
                <p>该分类下暂无片段</p>
              </div>
            ) : (
              <div className="space-y-2">
                {shownClips.map((clip) => (
                  <Card
                    key={clip.id}
                    className={`p-3 flex items-center gap-3 ${
                      playingClip?.id === clip.id ? 'ring-1 ring-primary' : ''
                    }`}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      title={playingClip?.id === clip.id && isPlaying ? '暂停' : '播放该片段'}
                      onClick={() => toggleClip(clip)}
                    >
                      {playingClip?.id === clip.id && isPlaying ? (
                        <Pause className="h-4 w-4" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                    </Button>
                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => toggleClip(clip)}>
                      <p className="text-sm font-medium line-clamp-2">{clip.text}</p>
                      <p className="text-xs text-muted-foreground">
                        {clip.fileName} · {formatTime(clip.startTime)} - {formatTime(clip.endTime)}
                        {clip.lastReviewedAt && ` · 最近复习 ${formatDate(clip.lastReviewedAt)}`}
                      </p>
                    </div>
                    {clip.tagName && <Badge variant="secondary">{clip.tagName}</Badge>}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0"
                      title="标记已复习"
                      onClick={() => markReviewed(clip)}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                      {clip.reviewCount > 0 ? `已复习 ${clip.reviewCount}` : '标记已复习'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      title="在播放器中打开"
                      onClick={() => playInPlayer(clip)}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      title="删除"
                      onClick={() => deleteClip(clip.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
