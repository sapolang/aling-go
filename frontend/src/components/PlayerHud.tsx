import { create } from 'zustand'

interface PlayerHudStore {
  message: string
  visible: boolean
  show: (message: string) => void
}

let hudTimer: ReturnType<typeof setTimeout> | null = null

// 播放器内单实例 HUD：连续调用覆盖同一条提示并刷新淡出计时
const usePlayerHudStore = create<PlayerHudStore>((set) => ({
  message: '',
  visible: false,
  show: (message) => {
    set({ message, visible: true })
    if (hudTimer) clearTimeout(hudTimer)
    hudTimer = setTimeout(() => set({ visible: false }), 1100)
  },
}))

export function showPlayerHud(message: string) {
  usePlayerHudStore.getState().show(message)
}

export function PlayerHud() {
  const message = usePlayerHudStore((s) => s.message)
  const visible = usePlayerHudStore((s) => s.visible)

  if (!message) return null

  return (
    <div
      className={`pointer-events-none absolute left-1/2 top-3 z-30 -translate-x-1/2 transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}
      role="status"
      aria-live="polite"
    >
      <div className="rounded-full bg-black/70 px-3 py-1.5 text-sm text-white shadow-lg">
        {message}
      </div>
    </div>
  )
}
