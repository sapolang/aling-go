import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, ChevronUp, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { confirmDialog, showToast } from '@/components/feedback'
import { cn } from '@/lib/utils'
import {
  SHORTCUT_ACTIONS,
  SHORTCUT_GROUP_LABELS,
  SHORTCUT_GROUP_ORDER,
  formatBinding,
  sameBinding,
  useShortcutStore,
} from '@/stores/shortcutStore'
import type { ShortcutActionId, ShortcutGroupId } from '@/stores/shortcutStore'

export default function SettingsShortcuts() {
  const shortcutBindings = useShortcutStore((s) => s.bindings)
  const setBinding = useShortcutStore((s) => s.setBinding)
  const resetBinding = useShortcutStore((s) => s.resetBinding)
  const resetAll = useShortcutStore((s) => s.resetAll)
  const [recordingId, setRecordingId] = useState<ShortcutActionId | null>(null)
  const [shortcutConflict, setShortcutConflict] = useState<{
    actionId: ShortcutActionId
    conflictId: ShortcutActionId
  } | null>(null)
  // 默认展开第一组，避免整页看起来是空的
  const [expandedShortcutGroups, setExpandedShortcutGroups] = useState<Set<ShortcutGroupId>>(
    () => new Set<ShortcutGroupId>(['playback']),
  )

  // --- 快捷键录制：捕获阶段拦截，避免触发按钮原生行为与页面滚动 ---
  useEffect(() => {
    if (!recordingId) return
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.repeat) return
      if (e.key === 'Escape') {
        setShortcutConflict(null)
        setRecordingId(null)
        return
      }
      if (e.metaKey || e.ctrlKey) {
        showToast('不支持 Cmd / Ctrl 组合', 'warning')
        return
      }
      if (e.isComposing) return
      if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Fn'].includes(e.key)) return
      if (e.code === 'Tab') {
        showToast('Tab 键不可用', 'warning')
        return
      }
      if (e.code === 'Backspace') {
        setBinding(recordingId, null)
        setShortcutConflict(null)
        setRecordingId(null)
        showToast('已清除绑定')
        return
      }

      const binding = { code: e.code, shift: e.shiftKey, alt: e.altKey }
      const conflict = setBinding(recordingId, binding)
      if (conflict) {
        setShortcutConflict({ actionId: recordingId, conflictId: conflict })
        const label = SHORTCUT_ACTIONS.find((action) => action.id === conflict)?.label ?? conflict
        showToast(`已被「${label}」占用`, 'warning')
        return
      }
      setShortcutConflict(null)
      setRecordingId(null)
      showToast(`已设为 ${formatBinding(binding)}`)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [recordingId, setBinding])

  const handleResetAllShortcuts = async () => {
    // 先退出录制，避免确认框打开后按键仍被录制器捕获
    setRecordingId(null)
    setShortcutConflict(null)
    const ok = await confirmDialog({
      title: '恢复默认快捷键',
      description: '将播放器所有快捷键恢复为默认键位，自定义设置会丢失。',
      confirmText: '恢复默认',
    })
    if (!ok) return
    resetAll()
    showToast('已恢复默认快捷键')
  }

  const handleResetShortcut = (id: ShortcutActionId) => {
    setRecordingId((current) => (current === id ? null : current))
    setShortcutConflict(null)
    resetBinding(id)
    showToast('已恢复默认键位')
  }

  const modifiedShortcutCount = SHORTCUT_ACTIONS.filter((action) => {
    const binding = shortcutBindings[action.id]
    return binding ? !sameBinding(binding, action.defaultBinding) : true
  }).length

  const toggleShortcutGroup = (group: ShortcutGroupId) => {
    setRecordingId(null)
    setShortcutConflict(null)
    setExpandedShortcutGroups((current) => {
      const next = new Set(current)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  const allShortcutGroupsExpanded = expandedShortcutGroups.size === SHORTCUT_GROUP_ORDER.length
  const toggleAllShortcutGroups = () => {
    setRecordingId(null)
    setShortcutConflict(null)
    setExpandedShortcutGroups(
      allShortcutGroupsExpanded ? new Set<ShortcutGroupId>() : new Set(SHORTCUT_GROUP_ORDER),
    )
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        {modifiedShortcutCount > 0 && (
          <span className="mr-auto text-xs text-muted-foreground">
            已修改 {modifiedShortcutCount} 项
          </span>
        )}
        <Button variant="ghost" size="sm" onClick={toggleAllShortcutGroups}>
          {allShortcutGroupsExpanded ? (
            <ChevronUp className="h-3.5 w-3.5 mr-1" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 mr-1" />
          )}
          {allShortcutGroupsExpanded ? '全部收起' : '全部展开'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={modifiedShortcutCount === 0}
          onClick={handleResetAllShortcuts}
        >
          <RotateCcw className="h-3.5 w-3.5 mr-1" /> 恢复默认
        </Button>
      </div>

      <div className="space-y-2">
        {SHORTCUT_GROUP_ORDER.map((group) => {
          const actions = SHORTCUT_ACTIONS.filter((action) => action.group === group)
          if (actions.length === 0) return null
          const expanded = expandedShortcutGroups.has(group)
          const modified = actions.filter((action) => {
            const binding = shortcutBindings[action.id]
            return binding ? !sameBinding(binding, action.defaultBinding) : true
          }).length
          return (
            <div key={group} className="overflow-hidden rounded-lg border border-border/70">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/40"
                onClick={() => toggleShortcutGroup(group)}
              >
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  {expanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  {SHORTCUT_GROUP_LABELS[group]}
                </span>
                <span className="text-xs text-muted-foreground">
                  {modified > 0 && <span className="text-primary">{modified} 项已修改 · </span>}
                  {actions.length} 项
                </span>
              </button>
              {expanded && (
                <div className="grid gap-x-6 gap-y-0.5 border-t border-border/60 px-3 py-3 sm:grid-cols-2">
                  {actions.map((action) => {
                    const binding = shortcutBindings[action.id]
                    const recording = recordingId === action.id
                    const isDefault = binding ? sameBinding(binding, action.defaultBinding) : false
                    const conflictId =
                      shortcutConflict?.actionId === action.id ? shortcutConflict.conflictId : null
                    const conflictLabel = conflictId
                      ? (SHORTCUT_ACTIONS.find((item) => item.id === conflictId)?.label ??
                        '其他动作')
                      : null
                    return (
                      <div key={action.id} className="rounded px-2 py-1.5 hover:bg-muted/40">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm">{action.label}</span>
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              variant={
                                recording ? (conflictId ? 'destructive' : 'default') : 'outline'
                              }
                              size="sm"
                              className={cn(
                                'min-w-[6.5rem] font-mono',
                                recording && !conflictId && 'animate-pulse',
                              )}
                              title="点击后按新键；Backspace 清除，Esc 取消"
                              onClick={() => {
                                setShortcutConflict(null)
                                setRecordingId(recording ? null : action.id)
                              }}
                            >
                              {recording
                                ? '按下新键…'
                                : binding
                                  ? formatBinding(binding)
                                  : '未设置'}
                            </Button>
                            {!isDefault && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                title="恢复默认键位"
                                onClick={() => handleResetShortcut(action.id)}
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </div>
                        {conflictLabel && (
                          <p className="mt-1 text-right text-xs text-destructive">
                            与「{conflictLabel}」冲突，请换一个键位
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}
