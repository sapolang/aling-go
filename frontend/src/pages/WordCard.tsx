import { useEffect, useState } from 'react'
import { useWordStore } from '@/stores/wordStore'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { speak } from '@/lib/tts'
import { Speaker, ChevronLeft, ChevronRight } from 'lucide-react'

const levelOptions = [
  { level: 1, label: '遗忘', desc: '1天后复习', days: 1, className: 'bg-red-500 hover:bg-red-600' },
  { level: 2, label: '模糊', desc: '3天后复习', days: 3, className: 'bg-yellow-500 hover:bg-yellow-600' },
  { level: 3, label: '熟悉', desc: '7天后复习', days: 7, className: 'bg-green-500 hover:bg-green-600' }
]

export default function WordCardPage() {
  const { reviewWords, loadReview, updateWord } = useWordStore()
  const [currentIndex, setCurrentIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)

  useEffect(() => { loadReview() }, [])

  const current = reviewWords[currentIndex]

  const handleLevel = async (level: number, days: number) => {
    if (!current) return
    const nextDate = new Date(Date.now() + days * 86400000).toISOString().split('T')[0]
    await updateWord(current.id, { level, next_review: nextDate })
    setFlipped(false)
    if (currentIndex < reviewWords.length - 1) {
      setCurrentIndex(currentIndex + 1)
    } else {
      loadReview()
      setCurrentIndex(0)
    }
  }

  const progress = reviewWords.length > 0
    ? `${currentIndex + 1} / ${reviewWords.length}`
    : '0 / 0'

  if (reviewWords.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <Card className="p-12 text-center">
          <p className="text-lg text-muted-foreground mb-2">今日没有待复习的词条</p>
          <p className="text-sm text-muted-foreground">前往播放器学习新词或浏览生词库</p>
        </Card>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto space-y-6 pt-8">
      <div className="text-center space-y-1">
        <h1 className="text-2xl font-bold">卡片背诵</h1>
        <p className="text-sm text-muted-foreground">进度: {progress}</p>
      </div>

      <div
        className="cursor-pointer"
        style={{ perspective: '1000px' }}
        onClick={() => setFlipped(!flipped)}
      >
        <div
          className="transition-transform duration-500"
          style={{
            transformStyle: 'preserve-3d',
            transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
            minHeight: '300px'
          }}
        >
          <Card
            className="absolute inset-0 flex items-center justify-center"
            style={{ backfaceVisibility: 'hidden' }}
          >
            <CardContent className="text-center p-8">
              <h2 className="text-4xl font-bold mb-2">{current.word}</h2>
              {current.phonetic && (
                <p className="text-lg text-muted-foreground mb-4">{current.phonetic}</p>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => { e.stopPropagation(); speak(current.word) }}
              >
                <Speaker className="h-4 w-4 mr-1" /> 朗读
              </Button>
              <p className="text-sm text-muted-foreground mt-4">点击卡片翻面</p>
            </CardContent>
          </Card>

          <Card
            className="absolute inset-0 flex items-center justify-center"
            style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
          >
            <CardContent className="text-center p-8">
              <h2 className="text-2xl font-bold mb-2">{current.word}</h2>
              {current.phonetic && (
                <p className="text-sm text-muted-foreground mb-3">{current.phonetic}</p>
              )}
              <p className="text-lg mb-4">{current.definition}</p>
              {current.example && (
                <p className="text-sm text-muted-foreground italic mb-6">"{current.example}"</p>
              )}
              {current.tags && (
                <div className="flex justify-center gap-1 mb-4">
                  {current.tags.split(',').map((tag) => (
                    <Badge key={tag} variant="secondary">{tag.trim()}</Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {flipped && (
        <div className="flex gap-3 justify-center">
          {levelOptions.map((opt) => (
            <Button
              key={opt.level}
              className={`${opt.className} text-white`}
              onClick={() => handleLevel(opt.level, opt.days)}
            >
              {opt.label}<br /><span className="text-xs opacity-80">{opt.desc}</span>
            </Button>
          ))}
        </div>
      )}

      <div className="flex justify-center gap-4">
        <Button variant="outline" onClick={() => { setFlipped(false); setCurrentIndex(Math.max(0, currentIndex - 1)) }}>
          <ChevronLeft className="h-4 w-4 mr-1" /> 上一个
        </Button>
        <Button variant="outline" onClick={() => { setFlipped(false); setCurrentIndex(Math.min(reviewWords.length - 1, currentIndex + 1)) }}>
          下一个 <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  )
}
