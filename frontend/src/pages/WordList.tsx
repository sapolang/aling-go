import { useEffect, useState, useMemo } from 'react'
import { FixedSizeList as List } from 'react-window'
import { useWordStore } from '@/stores/wordStore'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Search, Trash2, Edit, Plus } from 'lucide-react'
import AddWordModal from '@/components/AddWordModal'

const levelLabels = ['待学习', '遗忘', '模糊', '熟悉']

export default function WordListPage() {
  const { words, tags, loadWords, loadTags, deleteWord, deleteBatch, searchQuery, setSearchQuery, selectedTag, setSelectedTag } = useWordStore()
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [showAdd, setShowAdd] = useState(false)
  const [editWord, setEditWord] = useState<any>(null)

  useEffect(() => { loadWords(); loadTags() }, [])

  const filteredWords = useMemo(() => {
    let result = words
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter((w) =>
        w.word.toLowerCase().includes(q) ||
        w.definition.toLowerCase().includes(q) ||
        w.example.toLowerCase().includes(q)
      )
    }
    if (selectedTag) {
      result = result.filter((w) => w.tags.includes(selectedTag))
    }
    return result
  }, [words, searchQuery, selectedTag])

  const toggleSelect = (id: number) => {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredWords.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredWords.map((w) => w.id)))
    }
  }

  const handleDeleteBatch = () => {
    if (selectedIds.size === 0) return
    deleteBatch(Array.from(selectedIds))
    setSelectedIds(new Set())
  }

  const Row = ({ index, style }: { index: number; style: React.CSSProperties }) => {
    const w = filteredWords[index]
    return (
      <div style={style}>
        <Card className="mx-1 mb-1">
          <div className="p-3 flex items-center gap-3">
            <input
              type="checkbox"
              checked={selectedIds.has(w.id)}
              onChange={() => toggleSelect(w.id)}
              className="accent-primary"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{w.word}</span>
                {w.phonetic && <span className="text-xs text-muted-foreground">{w.phonetic}</span>}
                <Badge variant="outline" className="text-xs">
                  {levelLabels[w.level] || '待学习'}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground truncate">{w.definition}</p>
            </div>
            <div className="flex gap-1 items-center">
              {w.tags.split(',').filter(Boolean).map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs">{tag.trim()}</Badge>
              ))}
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditWord(w)}>
                <Edit className="h-3 w-3" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => deleteWord(w.id)}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">生词库</h1>
        <Button size="sm" onClick={() => setShowAdd(true)}>
          <Plus className="h-4 w-4 mr-1" /> 新增
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="搜索原文、释义、例句..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Select value={selectedTag} onValueChange={(v) => setSelectedTag(v)}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="全部标签" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value=" ">全部标签</SelectItem>
            {tags.map((t) => (
              <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{filteredWords.length} 条</span>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={selectedIds.size === filteredWords.length && filteredWords.length > 0}
            onChange={toggleSelectAll}
            className="accent-primary"
          />
          <span className="text-sm">已选 {selectedIds.size} 项</span>
          <Button variant="destructive" size="sm" onClick={handleDeleteBatch}>
            <Trash2 className="h-4 w-4 mr-1" /> 删除选中
          </Button>
        </div>
      )}

      <div className="flex-1">
        {filteredWords.length === 0 ? (
          <Card className="py-12 text-center text-muted-foreground">
            <p>{searchQuery ? '没有匹配结果' : '生词库为空'}</p>
          </Card>
        ) : (
          <List
            height={600}
            itemCount={filteredWords.length}
            itemSize={80}
            width="100%"
          >
            {Row}
          </List>
        )}
      </div>

      {(showAdd || editWord) && (
        <AddWordModal
          word={editWord}
          onClose={() => { setShowAdd(false); setEditWord(null) }}
        />
      )}
    </div>
  )
}
