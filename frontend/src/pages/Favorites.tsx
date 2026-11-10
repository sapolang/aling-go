import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePlayerStore } from '@/stores/playerStore'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Star,
  Play,
  Pause,
  Trash2,
  Plus,
  X,
  CheckCircle2,
  ExternalLink,
  GraduationCap,
  BookPlus,
} from 'lucide-react'
import { confirmDialog, showToast } from '@/components/feedback'

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
  nextReview: string
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

const localDateStr = () => {
  const d = new Date()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export default function FavoritesPage() {
  const navigate = useNavigate()
  const [clips, setClips] = useState<FavoriteClip[]>([])
  const [tags, setTags] = useState<FavoriteTag[]>([])
  const [selectedTag, setSelectedTag] = useState(0)
  const [newTag, setNewTag] = useState('')
  const [activeWord, setActiveWord] = useState<string | null>(null)
  const [focusedId, setFocusedId] = useState<number | null>(null)
  const [playingClip, setPlayingClip] = useState<FavoriteClip | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [mediaPort, setMediaPort] = useState(0)
  const [mediaError, setMediaError] = useState('')
  const mediaRef = useRef<{ el: HTMLMediaElement | null }>({ el: null })
  // 复习队列：进入复习时对当前筛选结果做快照
  const [reviewMode, setReviewMode] = useState(false)
  const [reviewQueue, setReviewQueue] = useState<FavoriteClip[]>([])
  const [reviewIndex, setReviewIndex] = useState(0)

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
    const today = localDateStr()
    return Array.from(map, ([word, items]) => ({
      word,
      items,
      reviewed: items.filter((c) => c.reviewCount > 0).length,
      due: items.filter((c) => !c.nextReview || c.nextReview <= today).length,
    })).sort((a, b) => {
      if (!a.word) return 1
      if (!b.word) return -1
      return b.items.length - a.items.length
    })
  }, [clips])

  // 当前分组被筛掉时按「全部片段」展示
  const effectiveWord =
    activeWord !== null && groups.some((g) => g.word === activeWord) ? activeWord : null

  const shownClips =
    effectiveWord === null ? clips : groups.find((g) => g.word === effectiveWord)?.items || []

  const focusedClip = shownClips.find((c) => c.id === focusedId) || shownClips[0] || null

  // 待复习：从未安排过下次复习，或已到期的片段
  const dueClips = useMemo(() => {
    const today = localDateStr()
    return clips
      .filter((c) => !c.nextReview || c.nextReview <= today)
      .sort((a, b) => {
        const an = a.nextReview || '0000-00-00'
        const bn = b.nextReview || '0000-00-00'
        if (an !== bn) return an.localeCompare(bn)
        return (a.lastReviewedAt || '').localeCompare(b.lastReviewedAt || '')
      })
  }, [clips])

  const reviewClip = reviewMode ? reviewQueue[reviewIndex] || null : null

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

  const addToWordList = async (clip: FavoriteClip) => {
    const word = (clip.word || '').trim()
    if (!word) return
    const words = (await window.api.dbWordsList()) || []
    const exists = words.some(
      (w: any) => (w.word || '').trim().toLowerCase() === word.toLowerCase(),
    )
    if (exists) {
      showToast(`「${word}」已在生词本中`, 'info')
      return
    }
    const id = await window.api.dbWordsAdd({
      word,
      definition: '',
      phonetic: '',
      example: clip.text,
      tags: clip.tagName || '',
      level: 1,
      next_review: localDateStr(),
      repetitions: 0,
      efactor: 2.5,
      interval: 0,
    })
    if (id > 0) showToast(`已加入生词本：${word}`)
    else showToast('加入生词本失败', 'error')
  }

  // 复习开始：对当前标签筛选下的到期片段排序后逐条播放
  const startReview = () => {
    if (!dueClips.length) {
      showToast('今天没有待复习的片段', 'info')
      return
    }
    setReviewQueue(dueClips)
    setReviewIndex(0)
    setReviewMode(true)
    setPlayingClip(dueClips[0])
    setMediaError('')
    setIsPlaying(false)
  }

  const finishReview = (total: number) => {
    mediaRef.current.el?.pause()
    setReviewMode(false)
    setReviewQueue([])
    setReviewIndex(0)
    setPlayingClip(null)
    setIsPlaying(false)
    loadClips(selectedTag)
    showToast(`本轮复习完成，共 ${total} 条`)
  }

  const exitReview = () => {
    mediaRef.current.el?.pause()
    setReviewMode(false)
    setReviewQueue([])
    setReviewIndex(0)
    setPlayingClip(null)
    setIsPlaying(false)
    loadClips(selectedTag)
  }

  // 三档自评：1 不认识 / 2 模糊 / 3 认识
  const ratingRef = useRef(false)
  const rateClip = async (clip: FavoriteClip, rating: number) => {
    if (ratingRef.current) return
    ratingRef.current = true
    try {
      await window.api.favoriteReview(clip.id, rating)
      if (reviewMode) {
        const nextIndex = reviewIndex + 1
        if (nextIndex >= reviewQueue.length) {
          finishReview(reviewQueue.length)
        } else {
          setReviewIndex(nextIndex)
          setPlayingClip(reviewQueue[nextIndex])
          setMediaError('')
          setIsPlaying(false)
        }
        return
      }
      await loadClips(selectedTag)
      showToast('已标记为认识')
    } finally {
      ratingRef.current = false
    }
  }

  const seekClipStart = (clip: FavoriteClip) => {
    const media = mediaRef.current.el
    if (!media) return
    media.currentTime = clip.startTime
    media.play().catch(() => setMediaError('无法自动播放，请点击播放器上的播放按钮'))
  }

  const loopClip = (clip: FavoriteClip) => {
    const media = mediaRef.current.el
    if (!media) return
    if (media.currentTime >= clip.endTime) {
      media.currentTime = clip.startTime
    }
  }

  const toggleClip = (clip: FavoriteClip) => {
    setFocusedId(clip.id)
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

  const moveFocus = (delta: number) => {
    if (!shownClips.length) return
    const current = focusedClip || shownClips[0]
    const idx = shownClips.findIndex((c) => c.id === current.id)
    const next = shownClips[Math.max(0, Math.min(shownClips.length - 1, idx + delta))]
    if (next) setFocusedId(next.id)
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

  // 键盘操作通过 ref 读取最新状态，避免反复绑定监听器
  const keyRef = useRef<{
    reviewMode: boolean
    reviewClip: FavoriteClip | null
    focusedClip: FavoriteClip | null
    rateClip: (clip: FavoriteClip, rating: number) => void
    toggleClip: (clip: FavoriteClip) => void
    moveFocus: (delta: number) => void
    exitReview: () => void
    deleteClip: (id: number) => void
  }>({
    reviewMode: false,
    reviewClip: null,
    focusedClip: null,
    rateClip: () => {},
    toggleClip: () => {},
    moveFocus: () => {},
    exitReview: () => {},
    deleteClip: () => {},
  })

  useEffect(() => {
    keyRef.current = {
      reviewMode,
      reviewClip,
      focusedClip,
      rateClip,
      toggleClip,
      moveFocus,
      exitReview,
      deleteClip,
    }
  })

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      const s = keyRef.current
      if (s.reviewMode) {
        if (e.key === '1' || e.key === '2' || e.key === '3') {
          if (!s.reviewClip) return
          e.preventDefault()
          s.rateClip(s.reviewClip, Number(e.key))
        } else if (e.key === ' ' || e.code === 'Space') {
          if (!s.reviewClip) return
          e.preventDefault()
          s.toggleClip(s.reviewClip)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          s.exitReview()
        }
        return
      }
      if (e.key === 'j' || e.key === 'J' || e.key === 'ArrowDown') {
        e.preventDefault()
        s.moveFocus(1)
      } else if (e.key === 'k' || e.key === 'K' || e.key === 'ArrowUp') {
        e.preventDefault()
        s.moveFocus(-1)
      } else if (e.key === ' ' || e.code === 'Space') {
        if (!s.focusedClip) return
        e.preventDefault()
        s.toggleClip(s.focusedClip)
      } else if (e.key === 'r' || e.key === 'R') {
        if (!s.focusedClip) return
        e.preventDefault()
        s.rateClip(s.focusedClip, 3)
      } else if (e.key === 'd' || e.key === 'D') {
        if (!s.focusedClip) return
        e.preventDefault()
        s.deleteClip(s.focusedClip.id)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const renderMedia = (clip: FavoriteClip) => {
    const url = mediaPort
      ? `http://127.0.0.1:${mediaPort}/media/${encodeURIComponent(clip.filePath)}`
      : ''
    const common = {
      src: url,
      controls: true,
      onLoadedMetadata: () => seekClipStart(clip),
      onTimeUpdate: () => loopClip(clip),
      onPlay: () => {
        setIsPlaying(true)
        setMediaError('')
      },
      onPause: () => setIsPlaying(false),
      onError: () => setMediaError('无法加载该文件，可能已被移动或删除'),
    }
    return isAudioPath(clip.filePath) ? (
      <audio
        key={clip.id}
        ref={(el) => {
          mediaRef.current.el = el
        }}
        {...common}
        className="w-full"
      />
    ) : (
      <video
        key={clip.id}
        ref={(el) => {
          mediaRef.current.el = el
        }}
        {...common}
        className="w-full max-h-[320px] rounded bg-black"
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Star className="h-6 w-6" /> 收藏工作台
          </h1>
          {!reviewMode && clips.length > 0 && (
            <Button size="sm" onClick={startReview} disabled={dueClips.length === 0}>
              <GraduationCap className="h-4 w-4 mr-1" />
              {dueClips.length > 0 ? `开始复习（${dueClips.length}）` : '今天已复习完'}
            </Button>
          )}
        </div>
        {!reviewMode && (
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
        )}
      </div>

      {!reviewMode && (
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
      )}

      {reviewMode && reviewClip ? (
        <Card className="max-w-2xl mx-auto p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GraduationCap className="h-5 w-5" />
              <span className="text-sm font-medium">
                复习 {reviewIndex + 1} / {reviewQueue.length}
              </span>
            </div>
            <Button variant="ghost" size="sm" onClick={exitReview}>
              <X className="h-4 w-4 mr-1" /> 退出
            </Button>
          </div>
          <div>
            <p className="text-lg leading-relaxed">{reviewClip.text}</p>
            <p className="text-xs text-muted-foreground mt-2">
              {reviewClip.fileName} · {formatTime(reviewClip.startTime)} -{' '}
              {formatTime(reviewClip.endTime)}
              {reviewClip.word && ` · 关联词 ${reviewClip.word}`}
            </p>
          </div>
          {renderMedia(reviewClip)}
          {mediaError && <p className="text-xs text-destructive">{mediaError}</p>}
          <div className="grid grid-cols-3 gap-2">
            <Button
              variant="outline"
              className="border-red-500/50 text-red-600 hover:bg-red-500/10"
              onClick={() => rateClip(reviewClip, 1)}
            >
              不认识 <span className="ml-1 text-xs opacity-70">1</span>
            </Button>
            <Button
              variant="outline"
              className="border-amber-500/50 text-amber-600 hover:bg-amber-500/10"
              onClick={() => rateClip(reviewClip, 2)}
            >
              模糊 <span className="ml-1 text-xs opacity-70">2</span>
            </Button>
            <Button onClick={() => rateClip(reviewClip, 3)}>
              认识 <span className="ml-1 text-xs opacity-70">3</span>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground text-center">
            快捷键：1 不认识 · 2 模糊 · 3 认识 · Space 播放/暂停 · Esc 退出
          </p>
        </Card>
      ) : clips.length === 0 ? (
        <div className="text-center text-muted-foreground py-16">
          <p>暂无收藏片段</p>
          <p className="text-sm mt-1">在播放器字幕列表中点击 ★ 收藏当前句</p>
        </div>
      ) : reviewMode ? null : (
        <>
          <p className="text-xs text-muted-foreground">
            快捷键：J/K 切换片段 · Space 播放/暂停 · R 标记认识 · D 删除
          </p>
          <div className="flex gap-4 items-start">
            {/* 左侧词表 */}
            <Card className="w-56 shrink-0 p-2">
              <button
                className={`w-full text-left px-3 py-2 rounded-md text-sm flex items-center justify-between ${
                  effectiveWord === null ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
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
                      effectiveWord === g.word
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-muted'
                    }`}
                    onClick={() => setActiveWord(g.word)}
                  >
                    <span className="text-sm font-medium block truncate">{g.word || '未归类'}</span>
                    <span className="text-xs opacity-70 block">
                      {g.items.length} 个片段 · 待复习 {g.due} · 已复习 {g.reviewed}
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
                  {renderMedia(playingClip)}
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
                        playingClip?.id === clip.id
                          ? 'ring-1 ring-primary'
                          : focusedClip?.id === clip.id
                            ? 'bg-muted/50'
                            : ''
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
                      <div
                        className="flex-1 min-w-0 cursor-pointer"
                        onClick={() => toggleClip(clip)}
                      >
                        <p className="text-sm font-medium line-clamp-2">{clip.text}</p>
                        <p className="text-xs text-muted-foreground">
                          {clip.fileName} · {formatTime(clip.startTime)} -{' '}
                          {formatTime(clip.endTime)}
                          {clip.lastReviewedAt && ` · 最近复习 ${formatDate(clip.lastReviewedAt)}`}
                        </p>
                      </div>
                      {clip.tagName && <Badge variant="secondary">{clip.tagName}</Badge>}
                      {clip.word && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          title={`加入生词本：${clip.word}`}
                          onClick={() => addToWordList(clip)}
                        >
                          <BookPlus className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0"
                        title="标记为认识"
                        onClick={() => rateClip(clip, 3)}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                        {clip.reviewCount > 0 ? `已复习 ${clip.reviewCount}` : '标记认识'}
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
        </>
      )}
    </div>
  )
}
