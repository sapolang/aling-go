import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useDictStore, DictWord } from '@/stores/dictStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { speak } from '@/lib/tts'
import { ChevronLeft, ThumbsUp, ThumbsDown, Plus, BookOpen, Speaker, Pencil } from 'lucide-react'

const tagLabels: Record<string, string> = {
  zk: '中考', gk: '高考', cet4: 'CET-4', cet6: 'CET-6',
  ky: '考研', toefl: 'TOEFL', ielts: 'IELTS', gre: 'GRE',
}

export default function ReviewPage() {
  const { tag } = useParams<{ tag: string }>()
  const navigate = useNavigate()
  const { words, currentIndex, loading, openBook, markKnown, markUnknown, addToWordList, addAllUnknown, unknownWords, knownWords, reset, setCurrentIndex } = useDictStore()
  const [flipped, setFlipped] = useState(false)
  const [addedSet, setAddedSet] = useState<Set<string>>(new Set())
  const [writeInput, setWriteInput] = useState('')
  const [writeCount, setWriteCount] = useState(0)
  const [writeError, setWriteError] = useState(false)

  const label = tagLabels[tag || ''] || (tag || '').toUpperCase()
  const current = words[currentIndex]
  const isDone = currentIndex >= words.length

  useEffect(() => {
    if (tag) {
      openBook(tag)
    }
    return () => { reset() }
  }, [tag])

  useEffect(() => {
    setWriteInput('')
    setWriteCount(0)
    setWriteError(false)
  }, [currentIndex])

  const handleWrite = () => {
    if (!current || !writeInput.trim()) return
    if (writeInput.trim().toLowerCase() === current.word.toLowerCase()) {
      setWriteCount((c) => c + 1)
      setWriteInput('')
      setWriteError(false)
    } else {
      setWriteError(true)
      setTimeout(() => setWriteError(false), 600)
    }
  }

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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === ' ') { e.preventDefault(); setFlipped((f) => !f); return }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setFlipped(false)
        const newIdx = Math.max(0, currentIndex - 1)
        setCurrentIndex(newIdx)
        if (tag) window.api.dbDictSaveProgress(tag, newIdx)
        return
      }
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault()
        setFlipped(false)
        const newIdx = Math.min(words.length, currentIndex + 1)
        setCurrentIndex(newIdx)
        if (tag) window.api.dbDictSaveProgress(tag, newIdx)
        return
      }
      if (e.key === '1') { e.preventDefault(); markUnknown(); setFlipped(false); return }
      if (e.key === '2') { e.preventDefault(); markKnown(); setFlipped(false); return }
      if (e.key === '3' && current) { e.preventDefault(); handleAdd(current); return }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [currentIndex, flipped, current, words.length, tag])

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
          <div className="flex flex-col items-center gap-4">
            <div className="text-3xl font-bold">{current?.word}</div>
            <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); speak(current?.word) }}>
              <Speaker className="h-4 w-4 mr-1" /> 朗读
            </Button>
          </div>
        ) : (
          <div className="text-center space-y-3">
            <div className="text-3xl font-bold">{current?.word}</div>
            {current?.phonetic && (
              <div className="text-lg text-muted-foreground">/{current.phonetic}/</div>
            )}
            <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); speak(current?.word) }}>
              <Speaker className="h-4 w-4 mr-1" /> 朗读
            </Button>
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
            <div className="pt-3 border-t border-border mt-3">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  写一写 {writeCount > 0 && <span className="text-green-500 font-medium">{writeCount} ✓</span>}
                </span>
              </div>
              <div className="flex gap-2 justify-center">
                <Input
                  className={`w-40 h-8 text-center text-sm transition-colors ${writeError ? 'border-red-500 bg-red-50' : ''}`}
                  placeholder="拼写单词"
                  value={writeInput}
                  onChange={(e) => { setWriteInput(e.target.value); setWriteError(false) }}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') handleWrite()
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={(e) => { e.stopPropagation(); handleWrite() }}>
                  确认
                </Button>
              </div>
            </div>
          </div>
        )}
        <div className="mt-4 text-xs text-muted-foreground">空格翻面 · ← → Enter 导航</div>
      </div>

      {/* Actions */}
      <div className="flex justify-center gap-4">
        <Button variant="outline" size="lg" className="gap-2" onClick={markUnknown}>
          <ThumbsDown className="h-5 w-5" /> 不认识 <span className="text-[10px] opacity-50 ml-1">(1)</span>
        </Button>
        <Button variant="outline" size="lg" className="gap-2" onClick={markKnown}>
          <ThumbsUp className="h-5 w-5" /> 认识 <span className="text-[10px] opacity-50 ml-1">(2)</span>
        </Button>
        {current && (
          <Button
            variant="outline"
            size="lg"
            className="gap-2"
            onClick={() => handleAdd(current)}
            disabled={addedSet.has(current.word)}
          >
            <Plus className="h-5 w-5" /> {addedSet.has(current.word) ? '已入库' : '入库'} <span className="text-[10px] opacity-50 ml-1">(3)</span>
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
