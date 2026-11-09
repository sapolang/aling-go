import { useMemo, useState } from 'react'
import type { DailyReview, TypingDayStat } from '@/types/electron'

const fmtInt = (n: number): string => n.toLocaleString('zh-CN')

const fmtPct = (ratio: number): string => `${(ratio * 100).toFixed(0)}%`

const shortDate = (date: string): string => (date.length >= 10 ? date.slice(5) : date)

export function EmptyHint({ text }: { text: string }) {
  return (
    <div className="flex h-32 flex-col items-center justify-center gap-1 text-center">
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  )
}

/** 最近 30 天复习量柱状图：稀疏刻度防重叠 + 悬停 tooltip */
export function DailyReviewChart({ data }: { data: DailyReview[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const maxCount = useMemo(() => Math.max(1, ...data.map((d) => d.count)), [data])
  const total = useMemo(() => data.reduce((sum, d) => sum + d.count, 0), [data])

  if (data.length === 0 || total === 0) {
    return <EmptyHint text="最近 30 天还没有复习记录，完成一次复习后这里会展示趋势" />
  }

  const labelEvery = Math.max(1, Math.ceil(data.length / 6))

  return (
    <div className="relative" onMouseLeave={() => setHover(null)}>
      {hover !== null && data[hover] && (
        <div
          className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
          style={{ left: `${((hover + 0.5) / data.length) * 100}%` }}
        >
          {data[hover].date} · {fmtInt(data[hover].count)} 次
        </div>
      )}
      <div className="flex h-32 items-end gap-[2px]">
        {data.map((day, i) => (
          <div
            key={day.date}
            className="flex-1 rounded-t bg-primary/80 transition-colors hover:bg-primary"
            style={{ height: `${Math.max(2, (day.count / maxCount) * 100)}%` }}
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </div>
      <div className="mt-1 flex gap-[2px]">
        {data.map((day, i) => (
          <span
            key={day.date}
            className="flex-1 overflow-hidden text-center text-[10px] text-muted-foreground"
          >
            {i % labelEvery === 0 || i === data.length - 1 ? shortDate(day.date) : ''}
          </span>
        ))}
      </div>
      <p className="mt-1 text-right text-[10px] text-muted-foreground">
        单日峰值 {fmtInt(maxCount)} 次 · 30 天共 {fmtInt(total)} 次
      </p>
    </div>
  )
}

export interface DistributionItem {
  label: string
  count: number
  colorClass: string
}

/** 分布横向条形图：标签 + 计数 + 占比 */
export function DistributionBars({
  items,
  emptyText,
}: {
  items: DistributionItem[]
  emptyText: string
}) {
  const total = items.reduce((sum, item) => sum + item.count, 0)
  const maxCount = Math.max(1, ...items.map((item) => item.count))

  if (total === 0) {
    return <EmptyHint text={emptyText} />
  }

  return (
    <div className="space-y-2">
      {items.map((item) => {
        const ratio = item.count / total
        return (
          <div key={item.label} className="space-y-1">
            <div className="flex items-baseline justify-between text-xs">
              <span className="text-muted-foreground">{item.label}</span>
              <span className="tabular-nums text-muted-foreground">
                <span className="text-sm font-medium text-foreground">{fmtInt(item.count)}</span>
                {' · '}
                {fmtPct(ratio)}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full ${item.colorClass}`}
                style={{ width: `${Math.max(2, (item.count / maxCount) * 100)}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

interface TypingTrendPoint extends TypingDayStat {
  fullDate: string
}

/** 打字练习趋势：柱状为练习次数，折线为平均正确率（0-100%） */
export function TypingTrendChart({ data }: { data: TypingDayStat[] }) {
  const [hover, setHover] = useState<number | null>(null)

  const points = useMemo<TypingTrendPoint[]>(() => {
    const byDate = new Map(data.map((d) => [d.date, d]))
    const result: TypingTrendPoint[] = []
    for (let i = 29; i >= 0; i--) {
      const date = new Date()
      date.setDate(date.getDate() - i)
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
        date.getDate(),
      ).padStart(2, '0')}`
      const hit = byDate.get(key)
      result.push({
        date: key,
        fullDate: key,
        count: hit?.count ?? 0,
        avgAccuracy: hit?.avgAccuracy ?? 0,
        avgWpm: hit?.avgWpm ?? 0,
        totalDuration: hit?.totalDuration ?? 0,
      })
    }
    return result
  }, [data])

  const totalCount = useMemo(() => points.reduce((sum, p) => sum + p.count, 0), [points])

  if (totalCount === 0) {
    return <EmptyHint text="最近 30 天还没有打字练习记录，去文章页练一段吧" />
  }

  const W = 600
  const H = 150
  const padL = 28
  const padR = 8
  const padT = 8
  const padB = 20
  const plotW = W - padL - padR
  const plotH = H - padT - padB
  const maxCount = Math.max(1, ...points.map((p) => p.count))
  const barW = plotW / points.length

  const accY = (acc: number) => padT + plotH * (1 - Math.min(1, Math.max(0, acc)))
  const linePath = points
    .map(
      (p, i) =>
        `${i === 0 ? 'M' : 'L'}${(padL + barW * (i + 0.5)).toFixed(1)},${accY(p.avgAccuracy).toFixed(1)}`,
    )
    .join(' ')

  const hoverPoint = hover !== null ? points[hover] : null

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const x = ((e.clientX - rect.left) / rect.width) * W
          const idx = Math.floor(((x - padL) / plotW) * points.length)
          setHover(idx >= 0 && idx < points.length ? idx : null)
        }}
      >
        {[0, 0.5, 1].map((ratio) => (
          <g key={ratio}>
            <line
              x1={padL}
              x2={W - padR}
              y1={accY(ratio)}
              y2={accY(ratio)}
              className="stroke-border"
              strokeDasharray={ratio === 0 ? '' : '3 3'}
              strokeWidth={1}
            />
            <text
              x={padL - 4}
              y={accY(ratio) + 3}
              textAnchor="end"
              className="fill-muted-foreground"
              fontSize={9}
            >
              {Math.round(ratio * 100)}%
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          p.count > 0 ? (
            <rect
              key={p.date}
              x={padL + barW * i + barW * 0.15}
              y={padT + plotH * (1 - p.count / maxCount)}
              width={barW * 0.7}
              height={plotH * (p.count / maxCount)}
              rx={1.5}
              className="fill-primary/60"
            />
          ) : null,
        )}
        <path d={linePath} fill="none" className="stroke-green-500" strokeWidth={1.5} />
        {hover !== null && (
          <line
            x1={padL + barW * (hover + 0.5)}
            x2={padL + barW * (hover + 0.5)}
            y1={padT}
            y2={padT + plotH}
            className="stroke-muted-foreground/50"
            strokeWidth={1}
          />
        )}
        {points.map((p, i) =>
          i % 6 === 0 || i === points.length - 1 ? (
            <text
              key={p.date}
              x={padL + barW * (i + 0.5)}
              y={H - 6}
              textAnchor="middle"
              className="fill-muted-foreground"
              fontSize={9}
            >
              {shortDate(p.date)}
            </text>
          ) : null,
        )}
      </svg>
      {hoverPoint && (
        <div className="pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md">
          {hoverPoint.fullDate} · 练习 {fmtInt(hoverPoint.count)} 次 · 正确率{' '}
          {fmtPct(hoverPoint.avgAccuracy)} · 平均 {hoverPoint.avgWpm.toFixed(0)} WPM
        </div>
      )}
      <div className="mt-1 flex items-center justify-end gap-4 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-primary/60" /> 练习次数
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-3 bg-green-500" /> 平均正确率
        </span>
      </div>
    </div>
  )
}
