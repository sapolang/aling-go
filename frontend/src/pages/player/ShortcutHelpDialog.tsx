import { Keyboard } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  SHORTCUT_ACTIONS,
  SHORTCUT_GROUP_LABELS,
  SHORTCUT_GROUP_ORDER,
  formatBinding,
  useShortcutStore,
} from '@/stores/shortcutStore'

interface ShortcutHelpDialogProps {
  open: boolean
  onClose: () => void
}

/** 播放器快捷键帮助：按分组列出当前绑定（含用户自定义） */
export default function ShortcutHelpDialog({ open, onClose }: ShortcutHelpDialogProps) {
  const shortcutBindings = useShortcutStore((s) => s.bindings)

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] gap-0 overflow-y-auto">
        <DialogHeader className="mb-4">
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5" /> 播放器快捷键
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-5 sm:grid-cols-2">
          {SHORTCUT_GROUP_ORDER.map((group) => {
            const actions = SHORTCUT_ACTIONS.filter((action) => action.group === group)
            if (actions.length === 0) return null
            return (
              <div key={group}>
                <h4 className="text-xs font-medium text-muted-foreground mb-2">
                  {SHORTCUT_GROUP_LABELS[group]}
                </h4>
                <div className="space-y-1.5">
                  {actions.map((action) => {
                    const binding = shortcutBindings[action.id]
                    return (
                      <div
                        key={action.id}
                        className="flex items-center justify-between gap-3 text-sm"
                      >
                        <span className="text-muted-foreground">{action.label}</span>
                        <kbd className="inline-flex min-w-[2.5rem] shrink-0 items-center justify-center rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">
                          {binding ? formatBinding(binding) : '未设置'}
                        </kbd>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
        <p className="mt-5 text-xs text-muted-foreground">
          快捷键仅在播放页生效；输入框聚焦时自动停用，Esc 按层级关闭浮层。
        </p>
      </DialogContent>
    </Dialog>
  )
}
