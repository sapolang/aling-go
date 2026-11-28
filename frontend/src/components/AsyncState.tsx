import { AlertCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** 统一的加载中占位，用于列表/统计等内容区 */
export function LoadingState({
  text = '加载中…',
  className = '',
}: {
  text?: string
  className?: string
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground ${className}`}
    >
      <Loader2 className="h-5 w-5 animate-spin" />
      <span>{text}</span>
    </div>
  )
}

/** 统一的加载失败占位，带重试入口 */
export function ErrorState({
  message,
  onRetry,
  className = '',
}: {
  message: string
  onRetry?: () => void
  className?: string
}) {
  return (
    <div
      role="alert"
      className={`flex flex-col items-center justify-center gap-3 py-16 text-center ${className}`}
    >
      <AlertCircle className="h-8 w-8 text-destructive" />
      <p className="text-sm text-muted-foreground">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          重试
        </Button>
      )}
    </div>
  )
}
