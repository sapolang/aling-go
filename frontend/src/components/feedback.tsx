import { useEffect } from 'react'
import { create } from 'zustand'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'

export type ToastVariant = 'success' | 'warning' | 'error' | 'info'

export interface ConfirmOptions {
  title?: string
  description?: string
  confirmText?: string
  cancelText?: string
  destructive?: boolean
}

interface ToastItem {
  id: number
  message: string
  variant: ToastVariant
}

interface ConfirmState extends ConfirmOptions {
  id: number
  resolve: (value: boolean) => void
}

interface FeedbackStore {
  toasts: ToastItem[]
  confirmState: ConfirmState | null
  addToast: (message: string, variant: ToastVariant) => void
  dismissToast: (id: number) => void
  openConfirm: (options: ConfirmOptions, resolve: (value: boolean) => void) => void
  closeConfirm: (value: boolean) => void
}

let toastSeq = 0
let confirmSeq = 0

const useFeedbackStore = create<FeedbackStore>((set, get) => ({
  toasts: [],
  confirmState: null,
  addToast: (message, variant) => {
    const id = ++toastSeq
    set((s) => ({ toasts: [...s.toasts, { id, message, variant }] }))
    setTimeout(() => useFeedbackStore.getState().dismissToast(id), 3200)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  openConfirm: (options, resolve) => {
    set({ confirmState: { ...options, id: ++confirmSeq, resolve } })
  },
  closeConfirm: (value) => {
    const current = get().confirmState
    if (!current) return
    set({ confirmState: null })
    current.resolve(value)
  },
}))

export function showToast(message: string, variant: ToastVariant = 'success') {
  useFeedbackStore.getState().addToast(message, variant)
}

export function confirmDialog(options: ConfirmOptions = {}): Promise<boolean> {
  return new Promise((resolve) => {
    useFeedbackStore.getState().openConfirm(options, resolve)
  })
}

const TOAST_STYLE: Record<ToastVariant, { className: string; Icon: typeof Info }> = {
  success: { className: 'bg-green-600 text-white', Icon: CheckCircle2 },
  warning: { className: 'bg-amber-500 text-white', Icon: AlertTriangle },
  error: { className: 'bg-red-600 text-white', Icon: XCircle },
  info: { className: 'bg-primary text-primary-foreground', Icon: Info },
}

export function FeedbackHost() {
  const toasts = useFeedbackStore((s) => s.toasts)
  const confirmState = useFeedbackStore((s) => s.confirmState)
  const closeConfirm = useFeedbackStore((s) => s.closeConfirm)

  // 确认框打开时，用捕获阶段的监听器拦截全局快捷键（Player / Review 等）
  useEffect(() => {
    if (!confirmState) return
    const onKeyDown = (e: KeyboardEvent) => {
      // 不阻止默认行为，仅阻止事件继续传播，保留按钮的原生 Enter/Space 激活
      e.stopPropagation()
      if (e.key === 'Escape') {
        e.preventDefault()
        closeConfirm(false)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [confirmState, closeConfirm])

  return (
    <>
      {toasts.length > 0 && (
        <div
          className="fixed bottom-16 left-1/2 -translate-x-1/2 z-[80] flex flex-col items-center gap-2 pointer-events-none"
          role="status"
          aria-live="polite"
        >
          {toasts.map((toast) => {
            const style = TOAST_STYLE[toast.variant]
            const Icon = style.Icon
            return (
              <div
                key={toast.id}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg shadow-lg text-sm pointer-events-auto ${style.className}`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{toast.message}</span>
              </div>
            )
          })}
        </div>
      )}

      {confirmState && (
        <div
          className="fixed inset-0 z-[90] bg-black/50 flex items-center justify-center p-4"
          onClick={() => closeConfirm(false)}
        >
          <Card className="w-full max-w-[380px] p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold">{confirmState.title || '确认操作'}</h3>
            {confirmState.description && (
              <p className="text-sm text-muted-foreground mt-2 whitespace-pre-line leading-relaxed">
                {confirmState.description}
              </p>
            )}
            <div className="flex justify-end gap-2 mt-5">
              <Button variant="outline" size="sm" onClick={() => closeConfirm(false)}>
                {confirmState.cancelText || '取消'}
              </Button>
              <Button
                size="sm"
                variant={confirmState.destructive ? 'destructive' : 'default'}
                autoFocus
                onClick={() => closeConfirm(true)}
              >
                {confirmState.confirmText || '确定'}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </>
  )
}
