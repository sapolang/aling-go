import { create } from 'zustand'

export type ThemeMode = 'light' | 'dark' | 'system'

interface ThemeStore {
  mode: ThemeMode
  dark: boolean
  setMode: (mode: ThemeMode) => void
  toggle: () => void
}

const STORAGE_KEY = 'aling-theme'

const prefersDarkQuery = () => window.matchMedia?.('(prefers-color-scheme: dark)')

function loadMode(): ThemeMode {
  if (typeof localStorage === 'undefined') return 'system'
  const raw = localStorage.getItem(STORAGE_KEY)
  // 兼容已保存的 light / dark，不做强制迁移；缺省或非法值按跟随系统处理
  if (raw === 'light' || raw === 'dark' || raw === 'system') return raw
  return 'system'
}

function resolveDark(mode: ThemeMode): boolean {
  if (mode === 'system') return prefersDarkQuery()?.matches ?? false
  return mode === 'dark'
}

export const useThemeStore = create<ThemeStore>((set, get) => {
  // 跟随系统模式下，监听系统主题变化
  prefersDarkQuery()?.addEventListener?.('change', (e) => {
    if (get().mode === 'system') set({ dark: e.matches })
  })

  const mode = loadMode()
  return {
    mode,
    dark: resolveDark(mode),
    setMode: (mode) => {
      if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, mode)
      set({ mode, dark: resolveDark(mode) })
    },
    toggle: () => get().setMode(get().dark ? 'light' : 'dark'),
  }
})
