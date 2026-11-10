import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWordStore, Word } from '@/stores/wordStore'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { showToast } from '@/components/feedback'
import { speak } from '@/lib/tts'
import { gradeOptions, sm2, srsIntervalLabel } from '@/lib/srs'
import { Speaker, ChevronLeft, ChevronRight, Pencil, Undo2, Settings2 } from 'lucide-react'

interface UndoEntry {
  word: Word
  index: number
}

export default function WordCardPage() {
  const navigate = useNavigate()
  const {
    reviewWords,
    reviewTotal,
    reviewCompleted,
    newLimit,
    reviewLimit,
    truncatedNew,
    truncatedReview,
    loadReview,
    updateWord,
    incrementCompleted,
    decrementCompleted,
    restoreReviewWord,
    setNewLimit,
    setReviewLimit,
  } = useWordStore()
  const [currentIndex, setCurrentIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [showButtons, setShowButtons] = useState(false)
  const [rating, setRating] = useState(false)
  const [writeInput, setWriteInput] = useState('')
  const [writeCount, setWriteCount] = useState(0)
  const [writeError, setWriteError] = useState(false)
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([])
  const [showLimits, setShowLimits] = useState(false)
  const writeRef = useRef<HTMLInputElement>(null)
  const flipTimer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    loadReview()
  }, [])

  useEffect(() => {
    if (truncatedNew > 0) {
      showToast(`今日新词已达上限（${newLimit} 个），${truncatedNew} 个新词顺延到明天`, 'warning')
    }
    if (truncatedReview > 0) {
      showToast(
        `今日复习已达上限（${reviewLimit} 个），${truncatedReview} 个复习词顺延到明天`,
        'warning',
      )
    }
  }, [truncatedNew, truncatedReview])

  useEffect(() => {
    setWriteInput('')
    setWriteCount(0)
    setWriteError(false)
  }, [currentIndex])

  useEffect(() => {
    if (flipped) {
      flipTimer.current = setTimeout(() => setShowButtons(true), 300)
    } else {
      setShowButtons(false)
      clearTimeout(flipTimer.current)
    }
    return () => clearTimeout(flipTimer.current)
  }, [flipped])

  const current = reviewWords[currentIndex]

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

  const handleGrade = useCallback(
    async (quality: number) => {
      if (!current || rating) return
      setRating(true)
      // 评分前保存完整快照，供撤销恢复 SRS 字段与队列位置
      setUndoStack((s) => [...s.slice(-9), { word: { ...current }, index: currentIndex }])
      const { nextReview, newEfactor, newInterval, newRepetitions } = sm2(
        current.efactor || 2.5,
        current.interval || 0,
        current.repetitions || 0,
        quality,
      )
      await updateWord(current.id, {
        word: current.word,
        definition: current.definition,
        phonetic: current.phonetic,
        example: current.example,
        tags: current.tags,
        level: quality === 1 ? 1 : quality === 3 ? 2 : 3,
        next_review: nextReview,
        repetitions: newRepetitions,
        efactor: newEfactor,
        interval: newInterval,
      } as any)
      void window.api.logReview(current.id, quality).catch(() => undefined)
      incrementCompleted()
      setRating(false)
      setFlipped(false)
      if (currentIndex < reviewWords.length - 1) {
        setCurrentIndex(currentIndex + 1)
      } else {
        loadReview()
        setCurrentIndex(0)
      }
    },
    [current, currentIndex, rating, reviewWords.length, updateWord, incrementCompleted, loadReview],
  )

  const handleUndo = useCallback(async () => {
    const snap = undoStack[undoStack.length - 1]
    if (!snap || rating) return
    setUndoStack((s) => s.slice(0, -1))
    const w = snap.word
    // 恢复评分前的 SRS 字段
    await updateWord(w.id, {
      word: w.word,
      definition: w.definition,
      phonetic: w.phonetic,
      example: w.example,
      tags: w.tags,
      level: w.level,
      next_review: w.next_review,
      repetitions: w.repetitions,
      efactor: w.efactor,
      interval: w.interval,
    } as any)
    restoreReviewWord(w, snap.index)
    decrementCompleted()
    setFlipped(false)
    setCurrentIndex(Math.min(snap.index, reviewWords.length))
    showToast(`已撤销 ${w.word}`)
  }, [undoStack, rating, reviewWords.length, updateWord, restoreReviewWord, decrementCompleted])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (undoStack.length > 0) {
          e.preventDefault()
          handleUndo()
        }
        return
      }
      if (e.key === ' ') {
        e.preventDefault()
        setFlipped((f) => !f)
        return
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        setFlipped(false)
        setCurrentIndex((i) => {
          if (e.key === 'ArrowLeft') return Math.max(0, i - 1)
          return Math.min(reviewWords.length - 1, i + 1)
        })
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        setFlipped(false)
        setCurrentIndex((i) => Math.min(reviewWords.length - 1, i + 1))
        return
      }
      if (flipped && e.key === '1') {
        e.preventDefault()
        handleGrade(1)
        return
      }
      if (flipped && e.key === '2') {
        e.preventDefault()
        handleGrade(3)
        return
      }
      if (flipped && e.key === '3') {
        e.preventDefault()
        handleGrade(4)
        return
      }
      if (flipped && e.key === '4') {
        e.preventDefault()
        handleGrade(5)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [flipped, handleGrade, handleUndo, undoStack.length, reviewWords.length])

  if (reviewWords.length === 0 && reviewCompleted === 0) {
    return (
      <div className="flex items-center justify-center h-full px-4">
        <Card className="p-8 sm:p-12 text-center">
          <p className="text-lg text-muted-foreground mb-2">今日没有待复习的词条</p>
          <p className="text-sm text-muted-foreground mb-4">前往播放器学习新词或浏览生词库</p>
          <Button variant="outline" onClick={() => navigate('/dict')}>
            去词库浏览
          </Button>
        </Card>
      </div>
    )
  }

  if (reviewWords.length === 0 && reviewCompleted > 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 px-4">
        <Card className="p-8 sm:p-12 text-center">
          <p className="text-2xl font-bold mb-2">今日复习完成</p>
          <p className="text-lg text-muted-foreground mb-4">本次复习了 {reviewCompleted} 个词</p>
          <Button
            variant="outline"
            onClick={() => {
              loadReview()
              setCurrentIndex(0)
            }}
          >
            再来一轮
          </Button>
        </Card>
      </div>
    )
  }

  const progressPct = reviewTotal > 0 ? (reviewCompleted / reviewTotal) * 100 : 0

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground flex-1 text-center">
            今日待复习 {reviewTotal} | 已完成 {reviewCompleted} | 剩余{' '}
            {reviewTotal - reviewCompleted}
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => setShowLimits((v) => !v)}
            title="每日上限设置"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {showLimits && (
        <Card className="p-4 flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">每日新词上限</label>
            <Input
              type="number"
              min={1}
              className="w-24 h-8 text-sm"
              value={newLimit}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10)
                if (Number.isFinite(v) && v > 0) setNewLimit(v)
              }}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">每日复习上限</label>
            <Input
              type="number"
              min={1}
              className="w-24 h-8 text-sm"
              value={reviewLimit}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10)
                if (Number.isFinite(v) && v > 0) setReviewLimit(v)
              }}
            />
          </div>
          <p className="text-xs text-muted-foreground pb-2">修改后下一轮复习生效</p>
        </Card>
      )}

      <div className="cursor-pointer" onClick={() => setFlipped(!flipped)}>
        <Card
          key={flipped ? 'back' : 'front'}
          className="relative overflow-hidden shadow-none"
          style={{
            minHeight: 'clamp(280px, 45vh, 380px)',
            animation: 'word-card-flip 260ms ease-out',
          }}
        >
          {!flipped ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <CardContent className="text-center p-6 sm:p-8">
                <h2 className="text-4xl sm:text-5xl font-bold mb-3 break-all">{current.word}</h2>
                {current.phonetic && (
                  <p className="text-xl text-muted-foreground mb-6">/{current.phonetic}/</p>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    speak(current.word)
                  }}
                >
                  <Speaker className="h-4 w-4 mr-1" /> 朗读
                </Button>
                <p className="text-xs text-muted-foreground mt-6">空格翻面 · ← → Enter 导航</p>
              </CardContent>
            </div>
          ) : (
            <div className="absolute inset-0 overflow-y-auto">
              <CardContent className="text-center p-6 sm:p-8 space-y-3">
                <h2 className="text-2xl font-bold break-all">{current.word}</h2>
                {current.phonetic && (
                  <p className="text-sm text-muted-foreground">/{current.phonetic}/</p>
                )}
                <p className="text-xl font-semibold text-primary break-words">
                  {current.definition}
                </p>
                {current.example && (
                  <p className="text-base text-muted-foreground italic">"{current.example}"</p>
                )}
                {current.tags && (
                  <div className="flex justify-center gap-1 flex-wrap">
                    {current.tags.split(',').map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-xs">
                        {tag.trim()}
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="pt-3 border-t border-border">
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      写一写{' '}
                      {writeCount > 0 && (
                        <span className="text-green-500 font-medium">{writeCount} ✓</span>
                      )}
                    </span>
                  </div>
                  <div className="flex gap-2 justify-center">
                    <Input
                      ref={writeRef}
                      className={`w-40 h-8 text-center text-sm transition-colors ${writeError ? 'border-red-500 bg-red-50' : ''}`}
                      placeholder="拼写单词"
                      value={writeInput}
                      onChange={(e) => {
                        setWriteInput(e.target.value)
                        setWriteError(false)
                      }}
                      onKeyDown={(e) => {
                        e.stopPropagation()
                        if (e.key === 'Enter') handleWrite()
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleWrite()
                      }}
                    >
                      确认
                    </Button>
                  </div>
                </div>
              </CardContent>
            </div>
          )}
        </Card>
      </div>

      <div
        className={`flex gap-3 justify-center flex-wrap transition-all duration-200 ${
          showButtons ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
        }`}
      >
        {gradeOptions.map((opt) => (
          <Button
            key={opt.grade}
            disabled={rating}
            className={`${opt.className} text-white min-w-[80px] rounded-xl flex-col h-auto py-3 gap-0.5`}
            onClick={() => handleGrade(opt.grade)}
          >
            <span className="text-sm font-semibold">{opt.label}</span>
            <span className="text-xs opacity-80">{srsIntervalLabel(opt.grade, current)}</span>
            <span className="text-[10px] opacity-60">({opt.key})</span>
          </Button>
        ))}
      </div>

      <div className="flex justify-center gap-4 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setFlipped(false)
            setCurrentIndex(Math.max(0, currentIndex - 1))
          }}
        >
          <ChevronLeft className="h-4 w-4 mr-1" /> 上一个
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleUndo}
          disabled={undoStack.length === 0 || rating}
          title="撤销上一次评分 (Ctrl/⌘+Z)"
        >
          <Undo2 className="h-4 w-4 mr-1" /> 撤销
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setFlipped(false)
            setCurrentIndex(Math.min(reviewWords.length - 1, currentIndex + 1))
          }}
        >
          下一个 <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground text-center -mt-2">
        ← → 或 Enter 切换单词 · Ctrl/⌘+Z 撤销
      </p>
    </div>
  )
}
