import { useEffect, useRef } from 'react'
import { findActionForEvent, useShortcutStore, type ShortcutActionId } from '@/stores/shortcutStore'
import { usePlayerStore } from '@/stores/playerStore'
import { REPEATABLE_SHORTCUTS } from './constants'

interface UsePlaybackShortcutsOptions {
  /** 仅播放页处于激活路由时响应 */
  active: boolean
  /** 有浮层/弹窗打开时屏蔽业务按键 */
  isBlocked: () => boolean
  /** Esc 按层级关闭浮层，返回是否消费了本次按键 */
  closeTopLayer: () => boolean
  run: (action: ShortcutActionId) => void
  openHelp: () => void
}

/**
 * 播放页全局快捷键：只负责按键到动作的解析与拦截规则，
 * 具体动作由 actions.ts 的动作表执行，与控制栏按钮共用同一实现。
 */
export function usePlaybackShortcuts(options: UsePlaybackShortcutsOptions): void {
  const optionsRef = useRef(options)

  useEffect(() => {
    optionsRef.current = options
  })

  useEffect(() => {
    if (!options.active) return

    const handleKey = (e: KeyboardEvent) => {
      // 屏蔽 Cmd/Ctrl 组合与输入法候选期间的按键
      if (e.metaKey || e.ctrlKey || e.isComposing) return
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }

      const action = findActionForEvent(useShortcutStore.getState().bindings, e)
      if (!action) return

      // 系统按键重复只允许用于连续型动作
      if (e.repeat && !REPEATABLE_SHORTCUTS.has(action)) {
        e.preventDefault()
        return
      }

      // Esc 始终按层级关闭浮层，不受弹窗拦截影响
      if (action === 'exit') {
        e.preventDefault()
        optionsRef.current.closeTopLayer()
        return
      }
      if (optionsRef.current.isBlocked()) return

      e.preventDefault()

      if (action === 'help') {
        optionsRef.current.openHelp()
        return
      }

      if (!usePlayerStore.getState().filePath) return

      // 焦点在按钮/链接上时，Space 交给原生 click，避免重复触发
      if ((target?.tagName === 'BUTTON' || target?.tagName === 'A') && action === 'playPause') {
        return
      }

      optionsRef.current.run(action)
    }

    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [options.active])
}
