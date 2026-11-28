import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { ExtendedStats, LearningStats, TypingProgress } from '@/types/api'
import {
  DailyReviewChart,
  DistributionBars,
  EmptyHint,
  TypingTrendChart,
  type DistributionItem,
} from '@/components/StatsCharts'
import { LoadingState, ErrorState } from '@/components/AsyncState'

const fmtInt = (n: number): string => n.toLocaleString('zh-CN')

const fmtPct = (ratio: number): string => `${(ratio * 100).toFixed(0)}%`

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </Card>
  )
}

const GRADE_STYLE: Record<number, { label: string; colorClass: string }> = {
  1: { label: '忘记', colorClass: 'bg-red-500' },
  3: { label: '困难', colorClass: 'bg-orange-500' },
  4: { label: '良好', colorClass: 'bg-blue-500' },
  5: { label: '简单', colorClass: 'bg-green-500' },
}

export default function StatsPage() {
  const navigate = useNavigate()
  const [stats, setStats] = useState<LearningStats | null>(null)
  const [extended, setExtended] = useState<ExtendedStats | null>(null)
  const [typing, setTyping] = useState({ bestWpm: 0, completed: 0 })
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setFailed(false)
    Promise.all([
      window.api.learningStats(),
      window.api.extendedStats(),
      window.api.getAllTypingProgress(),
    ])
      .then(([s, e, list]: [LearningStats, ExtendedStats, TypingProgress[]]) => {
        setStats(s)
        setExtended(e)
        setTyping({
          bestWpm: list.reduce((max, item) => Math.max(max, item.bestWpm || 0), 0),
          completed: list.filter((item) => item.completed).length,
        })
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const masteredRatio = stats && stats.totalWords > 0 ? stats.mastered / stats.totalWords : 0

  const gradeItems = useMemo<DistributionItem[]>(
    () =>
      (extended?.gradeDistribution ?? []).map((g) => {
        const style = GRADE_STYLE[g.grade] ?? {
          label: `评分 ${g.grade}`,
          colorClass: 'bg-slate-400',
        }
        return { label: style.label, count: g.count, colorClass: style.colorClass }
      }),
    [extended],
  )

  const levelItems = useMemo<DistributionItem[]>(() => {
    const buckets = [
      { label: '新词（Lv.1）', count: 0, colorClass: 'bg-sky-500' },
      { label: '学习中（Lv.2）', count: 0, colorClass: 'bg-amber-500' },
      { label: '较熟悉（Lv.3+）', count: 0, colorClass: 'bg-green-500' },
    ]
    for (const item of extended?.levelDistribution ?? []) {
      if (item.level <= 1) buckets[0].count += item.count
      else if (item.level === 2) buckets[1].count += item.count
      else buckets[2].count += item.count
    }
    return buckets
  }, [extended])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">学习统计</h1>
        <Button size="sm" onClick={() => navigate('/card')}>
          去复习
        </Button>
      </div>

      {loading ? (
        <LoadingState text="正在加载统计数据…" />
      ) : failed ? (
        <ErrorState message="统计数据加载失败" onRetry={load} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="今日复习" value={fmtInt(stats?.todayReviews ?? 0)} />
            <StatCard label="连续复习" value={`${fmtInt(stats?.streak ?? 0)} 天`} />
            <StatCard label="累计复习" value={fmtInt(stats?.totalReviews ?? 0)} />
            <StatCard
              label="已掌握"
              value={`${fmtInt(stats?.mastered ?? 0)} / ${fmtInt(stats?.totalWords ?? 0)}`}
              sub={stats ? `掌握率 ${fmtPct(masteredRatio)}` : undefined}
            />
          </div>

          <Card className="p-4">
            <p className="text-sm font-medium">最近 30 天复习量</p>
            <div className="mt-3">
              <DailyReviewChart data={stats?.daily ?? []} />
            </div>
          </Card>

          <div className="grid gap-3 md:grid-cols-2">
            <Card className="p-4">
              <p className="text-sm font-medium">复习评分分布</p>
              <div className="mt-3">
                <DistributionBars items={gradeItems} emptyText="还没有复习评分记录" />
              </div>
            </Card>
            <Card className="p-4">
              <p className="text-sm font-medium">生词掌握度分布</p>
              <div className="mt-3">
                <DistributionBars
                  items={levelItems}
                  emptyText="生词库还是空的，先去添加一些生词吧"
                />
              </div>
            </Card>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <Card className="p-4">
              <p className="text-sm font-medium">文章打字</p>
              {typing.bestWpm > 0 || typing.completed > 0 ? (
                <>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">
                    {fmtInt(Math.round(typing.bestWpm))}{' '}
                    <span className="text-sm font-normal text-muted-foreground">最佳 WPM</span>
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    已完成 {fmtInt(typing.completed)} 篇文章
                  </p>
                </>
              ) : (
                <EmptyHint text="还没有打字练习记录" />
              )}
            </Card>
            <Card className="p-4 md:col-span-2">
              <p className="text-sm font-medium">最近 30 天打字练习趋势</p>
              <div className="mt-3">
                <TypingTrendChart data={extended?.typingDaily ?? []} />
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
