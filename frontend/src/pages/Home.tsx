import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWordStore } from '@/stores/wordStore'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { BookOpen } from 'lucide-react'

const levelLabels = ['待学习', '遗忘', '模糊', '熟悉']

export default function HomePage() {
  const { reviewWords, loadReview } = useWordStore()
  const navigate = useNavigate()

  useEffect(() => { loadReview() }, [])

  const today = new Date().toLocaleDateString('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
  })

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">今日复习</h1>
        <p className="text-muted-foreground">{today}</p>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">
          待复习词条: <strong className="text-foreground">{reviewWords.length}</strong>
        </span>
        {reviewWords.length > 0 && (
          <Button size="sm" onClick={() => navigate('/card')}>
            <BookOpen className="h-4 w-4 mr-1" /> 开始背诵
          </Button>
        )}
      </div>

      {reviewWords.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <p className="text-lg mb-2">今日没有待复习的词条</p>
            <p className="text-sm">去播放器页面学习新词，或手动添加生词</p>
            <Button className="mt-4" onClick={() => navigate('/words')}>浏览生词库</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {reviewWords.map((w) => (
            <Card key={w.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-semibold">{w.word}</span>
                    {w.phonetic && <span className="text-sm text-muted-foreground">{w.phonetic}</span>}
                    <Badge variant="outline" className="text-xs">
                      {levelLabels[w.level] || '待学习'}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{w.definition}</p>
                  {w.example && (
                    <p className="text-xs text-muted-foreground/70 mt-1 italic">"{w.example}"</p>
                  )}
                </div>
                {w.tags && (
                  <div className="flex gap-1 ml-2">
                    {w.tags.split(',').map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-xs">{tag.trim()}</Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
