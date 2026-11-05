import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { LearningStats, TypingProgress } from '@/types/electron'

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </Card>
  )
}

export default function StatsPage() {
  const navigate = useNavigate()
  const [stats, setStats] = useState<LearningStats | null>(null)
  const [typing, setTyping] = useState({ bestWpm: 0, completed: 0 })

  useEffect(() => {
    window.api.learningStats().then(setStats)
    window.api.getAllTypingProgress().then((list: TypingProgress[]) => {
      setTyping({
        bestWpm: list.reduce((max, item) => Math.max(max, item.bestWpm || 0), 0),
        completed: list.filter((item) => item.completed).length,
      })
    })
  }, [])

  const maxCount = Math.max(1, ...(stats?.daily.map((d) => d.count) ?? [1]))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">学习统计</h2>
        <Button size="sm" onClick={() => navigate('/card')}>
          去复习
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="今日复习" value={stats?.todayReviews ?? 0} />
        <StatCard label="连续学习" value={`${stats?.streak ?? 0} 天`} />
        <StatCard label="累计复习" value={stats?.totalReviews ?? 0} />
        <StatCard label="已掌握" value={`${stats?.mastered ?? 0} / ${stats?.totalWords ?? 0}`} />
      </div>

      <Card className="p-4">
        <p className="text-sm font-medium">最近 30 天复习量</p>
        <div className="mt-3 flex h-32 items-end gap-1">
          {(stats?.daily ?? []).map((day) => (
            <div
              key={day.date}
              className="flex-1 rounded-t bg-primary/70"
              style={{ height: `${Math.max(2, (day.count / maxCount) * 100)}%` }}
              title={`${day.date}：${day.count} 次`}
            />
          ))}
        </div>
        <div className="mt-2 flex justify-between text-xs text-muted-foreground">
          <span>30 天前</span>
          <span>今天</span>
        </div>
      </Card>

      <Card className="p-4">
        <p className="text-sm font-medium">文章打字</p>
        <p className="mt-1 text-2xl font-semibold">
          {typing.bestWpm.toFixed(0)}{' '}
          <span className="text-sm font-normal text-muted-foreground">最佳 WPM</span>
        </p>
        <p className="mt-1 text-sm text-muted-foreground">已完成 {typing.completed} 篇文章</p>
      </Card>
    </div>
  )
}
