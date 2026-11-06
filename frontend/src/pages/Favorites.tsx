import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePlayerStore } from '@/stores/playerStore'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Star, Play, Trash2, Plus, X } from 'lucide-react'

interface FavoriteClip {
  id: number
  filePath: string
  fileName: string
  startTime: number
  endTime: number
  text: string
  tagId: number
  tagName: string
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

export default function FavoritesPage() {
  const navigate = useNavigate()
  const [clips, setClips] = useState<FavoriteClip[]>([])
  const [tags, setTags] = useState<FavoriteTag[]>([])
  const [selectedTag, setSelectedTag] = useState(0)
  const [newTag, setNewTag] = useState('')

  const loadTags = () => window.api.favoriteTagsList().then((t: FavoriteTag[]) => setTags(t || []))

  useEffect(() => {
    loadTags()
  }, [])

  useEffect(() => {
    window.api.favoriteList(selectedTag).then((list: FavoriteClip[]) => setClips(list || []))
  }, [selectedTag])

  const addTag = async () => {
    const name = newTag.trim()
    if (!name) return
    await window.api.favoriteTagAdd(name)
    setNewTag('')
    loadTags()
  }

  const deleteTag = async (id: number) => {
    await window.api.favoriteTagDelete(id)
    if (selectedTag === id) setSelectedTag(0)
    loadTags()
    window.api
      .favoriteList(selectedTag === id ? 0 : selectedTag)
      .then((list: FavoriteClip[]) => setClips(list || []))
  }

  const deleteClip = async (id: number) => {
    await window.api.favoriteDelete(id)
    setClips((prev) => prev.filter((c) => c.id !== id))
  }

  // 跳转播放器，定位到片段起点并循环
  const playClip = (clip: FavoriteClip) => {
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
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Star className="h-6 w-6" /> 收藏片段
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
        <div className="space-y-2">
          {clips.map((clip) => (
            <Card key={clip.id} className="p-3 flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                title="循环播放该片段"
                onClick={() => playClip(clip)}
              >
                <Play className="h-4 w-4" />
              </Button>
              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => playClip(clip)}>
                <p className="text-sm font-medium truncate">{clip.text}</p>
                <p className="text-xs text-muted-foreground">
                  {clip.fileName} · {formatTime(clip.startTime)} - {formatTime(clip.endTime)}
                </p>
              </div>
              {clip.tagName && <Badge variant="secondary">{clip.tagName}</Badge>}
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
  )
}
