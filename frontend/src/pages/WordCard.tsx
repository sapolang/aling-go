import { useEffect, useState, useCallback, useRef } from 'react'
import { useWordStore } from '@/stores/wordStore'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { speak } from '@/lib/tts'
import { gradeOptions, sm2, srsIntervalLabel } from '@/lib/srs'
import { Speaker, ChevronLeft, ChevronRight, Pencil } from 'lucide-react'

export default function WordCardPage() {
  const {
    reviewWords, reviewTotal, reviewCompleted,
    loadReview, updateWord, incrementCompleted,
  } = useWordStore()
  const [currentIndex, setCurrentIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [showButtons, setShowButtons] = useState(false)
  const [rating, setRating] = useState(false)
  const [writeInput, setWriteInput] = useState('')
  const [writeCount, setWriteCount] = useState(0)
  const [writeError, setWriteError] = useState(false)
  const writeRef = useRef<HTMLInputElement>(null)
  const flipTimer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => { loadReview() }, [])

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

  const handleGrade = useCallback(async (quality: number) => {
    if (!current || rating) return
    setRating(true)
    const { nextReview, newEfactor, newInterval, newRepetitions } = sm2(
      current.efactor || 2.5,
      current.interval || 0,
      current.repetitions || 0,
      quality,
    )
    await updateWord(current.id, {
      level: quality === 1 ? 1 : quality === 3 ? 2 : 3,
      next_review: nextReview,
      repetitions: newRepetitions,
      efactor: newEfactor,
      interval: newInterval,
    } as any)
    incrementCompleted()
    setRating(false)
    setFlipped(false)
    if (currentIndex < reviewWords.length - 1) {
      setCurrentIndex(currentIndex + 1)
    } else {
      loadReview()
      setCurrentIndex(0)
    }
  }, [current, currentIndex, rating, reviewWords.length, updateWord, incrementCompleted, loadReview])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === ' ') { e.preventDefault(); setFlipped((f) => !f); return }
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
      if (flipped && e.key === '1') { e.preventDefault(); handleGrade(1); return }
      if (flipped && e.key === '2') { e.preventDefault(); handleGrade(3); return }
      if (flipped && e.key === '3') { e.preventDefault(); handleGrade(4); return }
      if (flipped && e.key === '4') { e.preventDefault(); handleGrade(5); return }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [flipped, handleGrade, reviewWords.length])

  if (reviewWords.length === 0 && reviewCompleted === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <Card className="p-12 text-center">
          <p className="text-lg text-muted-foreground mb-2">今日没有待复习的词条</p>
          <p className="text-sm text-muted-foreground">前往播放器学习新词或浏览生词库</p>
        </Card>
      </div>
    )
  }

  if (reviewWords.length === 0 && reviewCompleted > 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <Card className="p-12 text-center">
          <p className="text-2xl font-bold mb-2">今日复习完成</p>
          <p className="text-lg text-muted-foreground mb-4">本次复习了 {reviewCompleted} 个词</p>
        </Card>
      </div>
    )
  }

  const progressPct = reviewTotal > 0 ? (reviewCompleted / reviewTotal) * 100 : 0

  return (
    <div className="max-w-lg mx-auto space-y-4 pt-6">
      <div className="space-y-1">
        <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground text-center">
          今日待复习 {reviewTotal} | 已完成 {reviewCompleted} | 剩余 {reviewTotal - reviewCompleted}
        </p>
      </div>

      <div
        className="cursor-pointer"
        style={{ perspective: '1000px' }}
        onClick={() => setFlipped(!flipped)}
      >
        <div
          className="transition-transform duration-500 relative"
          style={{
            transformStyle: 'preserve-3d',
            transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
            minHeight: '360px',
          }}
        >
          <Card
            className="absolute inset-0 flex items-center justify-center"
            style={{ backfaceVisibility: 'hidden' }}
          >
            <CardContent className="text-center p-8">
              <h2 className="text-5xl font-bold mb-3">{current.word}</h2>
              {current.phonetic && (
                <p className="text-xl text-muted-foreground mb-6">/{current.phonetic}/</p>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => { e.stopPropagation(); speak(current.word) }}
              >
                <Speaker className="h-4 w-4 mr-1" /> 朗读
              </Button>
              <p className="text-xs text-muted-foreground mt-6">空格翻面 · ← → Enter 导航</p>
            </CardContent>
          </Card>

          <Card
            className="absolute inset-0 overflow-hidden"
            style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
          >
            <CardContent className="text-center p-8 space-y-3 overflow-y-auto max-h-full">
              <h2 className="text-2xl font-bold">{current.word}</h2>
              {current.phonetic && (
                <p className="text-sm text-muted-foreground">/{current.phonetic}/</p>
              )}
              <p className="text-xl font-semibold text-primary break-words">{current.definition}</p>
              {current.example && (
                <p className="text-base text-muted-foreground italic">"{current.example}"</p>
              )}
              {current.tags && (
                <div className="flex justify-center gap-1 flex-wrap">
                  {current.tags.split(',').map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs">{tag.trim()}</Badge>
                  ))}
                </div>
              )}
              <div className="pt-3 border-t border-border">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    写一写 {writeCount > 0 && <span className="text-green-500 font-medium">{writeCount} ✓</span>}
                  </span>
                </div>
                <div className="flex gap-2 justify-center">
                  <Input
                    ref={writeRef}
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
            </CardContent>
          </Card>
        </div>
      </div>

      <div
        className={`flex gap-3 justify-center transition-all duration-200 ${
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
            <span className="text-xs opacity-80">
              {srsIntervalLabel(opt.grade, current)}
            </span>
            <span className="text-[10px] opacity-60">({opt.key})</span>
          </Button>
        ))}
      </div>

      <div className="flex justify-center gap-4">
        <Button variant="outline" size="sm" onClick={() => { setFlipped(false); setCurrentIndex(Math.max(0, currentIndex - 1)) }}>
          <ChevronLeft className="h-4 w-4 mr-1" /> 上一个
        </Button>
        <Button variant="outline" size="sm" onClick={() => { setFlipped(false); setCurrentIndex(Math.min(reviewWords.length - 1, currentIndex + 1)) }}>
          下一个 <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground text-center -mt-2">← → 或 Enter 切换单词</p>
    </div>
  )
}
