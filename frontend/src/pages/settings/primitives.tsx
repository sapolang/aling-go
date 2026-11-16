import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * 一组相关设置。用发丝线分隔行，不再套卡片边框与内边距，
 * 避免"卡片里再套带边框的行"两层轮廓堆叠带来的视觉噪音。
 */
export function SettingsGroup({
  title,
  description,
  action,
  tone = 'default',
  children,
}: {
  title: string
  description?: ReactNode
  action?: ReactNode
  tone?: 'default' | 'danger'
  children?: ReactNode
}) {
  const danger = tone === 'danger'
  return (
    <section className="mb-9 last:mb-0">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex items-baseline gap-2">
          <h3 className={cn('text-sm font-semibold', danger && 'text-destructive')}>{title}</h3>
          {description && (
            <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
          )}
        </div>
        {action}
      </div>
      <div
        className={cn(
          'divide-y border-t',
          danger
            ? 'divide-destructive/20 border-destructive/30'
            : 'divide-border/60 border-border/60',
        )}
      >
        {children}
      </div>
    </section>
  )
}

/** 单条设置：左侧名称与说明，右侧控件 */
export function SettingsRow({
  title,
  description,
  children,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn('flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-4', className)}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium leading-tight">{title}</p>
        {description && (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
      {children && <div className="ml-auto shrink-0">{children}</div>}
    </div>
  )
}
