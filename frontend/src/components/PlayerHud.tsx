import { create } from 'zustand'

type PlayerHudVariant = 'default' | 'warning'

interface PlayerHudStore {
  message: string
  variant: PlayerHudVariant
  visible: boolean
  show: (message: string, variant?: PlayerHudVariant) => void
}

let hudTimer: ReturnType<typeof setTimeout> | null = null

// 播放器内单实例 HUD：连续调用覆盖同一条提示并刷新淡出计时
const usePlayerHudStore = create<PlayerHudStore>((set) => ({
  message: '',
  variant: 'default',
  visible: false,
  show: (message, variant = 'default') => {
    set({ message, variant, visible: true })
    if (hudTimer) clearTimeout(hudTimer)
    hudTimer = setTimeout(() => set({ visible: false }), 1100)
  },
}))

export function showPlayerHud(message: string, variant: PlayerHudVariant = 'default') {
  usePlayerHudStore.getState().show(message, variant)
}

// warning 用琥珀色气泡，深浅色主题下都靠自身底色保证对比度
const VARIANT_STYLES: Record<PlayerHudVariant, string> = {
  default: 'bg-black/70 text-white',
  warning: 'bg-amber-500/90 text-amber-950 dark:bg-amber-400/90',
}

export function PlayerHud() {
  const message = usePlayerHudStore((s) => s.message)
  const variant = usePlayerHudStore((s) => s.variant)
  const visible = usePlayerHudStore((s) => s.visible)

  if (!message) return null

  return (
    <div
      className={`pointer-events-none absolute left-1/2 top-3 z-30 -translate-x-1/2 transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}
      role="status"
      aria-live="polite"
    >
      <div className={`rounded-full px-3 py-1.5 text-sm shadow-lg ${VARIANT_STYLES[variant]}`}>
        {message}
      </div>
    </div>
  )
}
