import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useDictStore, DictWord } from '@/stores/dictStore'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ThumbsUp, ThumbsDown, Plus, BookOpen } from 'lucide-react'

const tagLabels: Record<string, string> = {
  zk: '中考', gk: '高考', cet4: 'CET-4', cet6: 'CET-6',
  ky: '考研', toefl: 'TOEFL', ielts: 'IELTS', gre: 'GRE',
}

export default function ReviewPage() {
  const { tag } = useParams<{ tag: string }>()
  const navigate = useNavigate()
  const { words, currentIndex, loading, openBook, markKnown, markUnknown, addToWordList, addAllUnknown, unknownWords, knownWords, reset } = useDictStore()
  const [flipped, setFlipped] = useState(false)
  const [addedSet, setAddedSet] = useState<Set<string>>(new Set())

  const label = tagLabels[tag || ''] || (tag || '').toUpperCase()
  const current = words[currentIndex]
  const isDone = currentIndex >= words.length

  useEffect(() => {
    if (tag) {
      openBook(tag)
    }
    return () => { reset() }
  }, [tag])

  const handleAdd = async (word: DictWord) => {
    await addToWordList(word)
    setAddedSet((prev) => new Set(prev).add(word.word))
  }

  const handleBack = async (resetProgress?: boolean) => {
    if (resetProgress && tag) {
      await window.api.dbDictSaveProgress(tag, 0)
    }
    if (unknownWords.size > 0) {
      if (window.confirm(`还有 ${unknownWords.size} 个不认识的词，是否添加到词库？`)) {
        await addAllUnknown()
      }
    }
    navigate('/dict')
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground">加载中...</div>
  }

  if (words.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <BookOpen className="h-12 w-12 text-primary" />
        <h2 className="text-xl font-bold">该单词书暂无单词</h2>
        <Button onClick={() => navigate('/dict')}>返回</Button>
      </div>
    )
  }

  if (isDone) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <BookOpen className="h-12 w-12 text-primary" />
        <h2 className="text-xl font-bold">复习完成！</h2>
        <p className="text-muted-foreground">
          认识 {knownWords.size} 词 · 不认识 {unknownWords.size} 词
        </p>
        <Button onClick={() => handleBack(true)}>返回单词书</Button>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => handleBack()}>
          <ChevronLeft className="h-4 w-4 mr-1" /> 返回
        </Button>
        <span className="text-sm text-muted-foreground">
          {label} · {currentIndex + 1}/{words.length}
        </span>
      </div>

      {/* Card */}
      <div
        className="min-h-[300px] rounded-xl border bg-card p-8 flex flex-col items-center justify-center cursor-pointer select-none"
        onClick={() => setFlipped(!flipped)}
      >
        {!flipped ? (
          <div className="text-3xl font-bold">{current?.word}</div>
        ) : (
          <div className="text-center space-y-3">
            <div className="text-3xl font-bold">{current?.word}</div>
            {current?.phonetic && (
              <div className="text-lg text-muted-foreground">{current.phonetic}</div>
            )}
            <div className="text-lg">{current?.translation}</div>
            {current?.definition && (
              <div className="text-sm text-muted-foreground max-w-md">{current.definition}</div>
            )}
            {current?.tag && (
              <div className="flex gap-1 justify-center flex-wrap">
                {current.tag.split(' ').map((t) => (
                  <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                    {tagLabels[t] || t}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="mt-4 text-xs text-muted-foreground">点击翻转</div>
      </div>

      {/* Actions */}
      <div className="flex justify-center gap-4">
        <Button variant="outline" size="lg" className="gap-2" onClick={markUnknown}>
          <ThumbsDown className="h-5 w-5" /> 不认识
        </Button>
        <Button variant="outline" size="lg" className="gap-2" onClick={markKnown}>
          <ThumbsUp className="h-5 w-5" /> 认识
        </Button>
        {current && (
          <Button
            variant="outline"
            size="lg"
            className="gap-2"
            onClick={() => handleAdd(current)}
            disabled={addedSet.has(current.word)}
          >
            <Plus className="h-5 w-5" /> {addedSet.has(current.word) ? '已入库' : '入库'}
          </Button>
        )}
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${((currentIndex + 1) / words.length) * 100}%` }}
        />
      </div>
    </div>
  )
}
