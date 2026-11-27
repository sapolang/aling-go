import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Virtuoso } from 'react-virtuoso'
import { useWordStore } from '@/stores/wordStore'
import type { Word } from '@/types/api'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Search, Trash2, Edit, Plus } from 'lucide-react'
import { confirmDialog } from '@/components/feedback'
import { LoadingState, ErrorState } from '@/components/AsyncState'
import AddWordModal from '@/components/AddWordModal'

const levelLabels = ['待学习', '遗忘', '模糊', '熟悉']

interface WordRowProps {
  word: Word
  selected: boolean
  onToggleSelect: (id: number) => void
  onEdit: (word: Word) => void
  onDelete: (word: Word) => void
}

// 列表行保持顶层定义并 memo，父级重渲染（如勾选、搜索）时只有属性变化的行才重渲染
const WordRow = memo(function WordRow({
  word,
  selected,
  onToggleSelect,
  onEdit,
  onDelete,
}: WordRowProps) {
  return (
    <div className="px-1 pb-1">
      <Card>
        <div className="p-3 flex items-center gap-3">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(word.id)}
            className="accent-primary"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold">{word.word}</span>
              {word.phonetic && (
                <span className="text-xs text-muted-foreground">{word.phonetic}</span>
              )}
              <Badge variant="outline" className="text-xs">
                {levelLabels[word.level] || '待学习'}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground truncate">{word.definition}</p>
          </div>
          <div className="flex gap-1 items-center flex-wrap justify-end">
            <div className="hidden md:flex gap-1 items-center flex-wrap justify-end">
              {word.tags
                .split(',')
                .filter(Boolean)
                .map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    {tag.trim()}
                  </Badge>
                ))}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title="编辑"
              onClick={() => onEdit(word)}
            >
              <Edit className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive"
              title="删除"
              onClick={() => onDelete(word)}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
})

export default function WordListPage() {
  const {
    words,
    tags,
    loading,
    error,
    loadWords,
    loadTags,
    deleteWord,
    deleteBatch,
    searchQuery,
    setSearchQuery,
    selectedTag,
    setSelectedTag,
  } = useWordStore()
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [showAdd, setShowAdd] = useState(false)
  const [editWord, setEditWord] = useState<Word | null>(null)

  useEffect(() => {
    loadWords()
    loadTags()
  }, [loadWords, loadTags])

  const filteredWords = useMemo(() => {
    let result = words
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (w) =>
          w.word.toLowerCase().includes(q) ||
          w.definition.toLowerCase().includes(q) ||
          w.example.toLowerCase().includes(q),
      )
    }
    if (selectedTag) {
      result = result.filter((w) => w.tags.includes(selectedTag))
    }
    return result
  }, [words, searchQuery, selectedTag])

  const toggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleEdit = useCallback((word: Word) => setEditWord(word), [])

  const handleDelete = useCallback(
    async (word: Word) => {
      const ok = await confirmDialog({
        title: '删除这个生词？',
        description: `${word.word} 将被移除，此操作不可撤销。`,
        confirmText: '删除',
        destructive: true,
      })
      if (ok) await deleteWord(word.id)
    },
    [deleteWord],
  )

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredWords.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredWords.map((w) => w.id)))
    }
  }

  const handleDeleteBatch = async () => {
    if (selectedIds.size === 0) return
    const ok = await confirmDialog({
      title: `删除 ${selectedIds.size} 个生词？`,
      description: '这些生词将连同学习记录一起移除，此操作不可撤销。',
      confirmText: '删除',
      destructive: true,
    })
    if (!ok) return
    deleteBatch(Array.from(selectedIds))
    setSelectedIds(new Set())
  }

  return (
    <div className="h-full flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">生词库</h1>
        <Button size="sm" onClick={() => setShowAdd(true)}>
          <Plus className="h-4 w-4 mr-1" /> 新增
        </Button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
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
              <SelectItem key={t.id} value={t.name}>
                {t.name}
              </SelectItem>
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

      <div className="flex-1 min-h-0">
        {loading ? (
          <LoadingState text="正在加载生词…" />
        ) : error ? (
          <ErrorState message={error} onRetry={loadWords} />
        ) : filteredWords.length === 0 ? (
          <Card className="py-12 text-center text-muted-foreground">
            <p>{searchQuery ? '没有匹配结果' : '生词库为空'}</p>
          </Card>
        ) : (
          <Virtuoso
            style={{ height: '100%' }}
            data={filteredWords}
            computeItemKey={(_, w) => w.id}
            itemContent={(_, w) => (
              <WordRow
                word={w}
                selected={selectedIds.has(w.id)}
                onToggleSelect={toggleSelect}
                onEdit={handleEdit}
                onDelete={handleDelete}
              />
            )}
          />
        )}
      </div>

      {(showAdd || editWord) && (
        <AddWordModal
          word={editWord}
          onClose={() => {
            setShowAdd(false)
            setEditWord(null)
          }}
        />
      )}
    </div>
  )
}
