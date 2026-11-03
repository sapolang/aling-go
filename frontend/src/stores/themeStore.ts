import { create } from 'zustand'

interface ThemeStore {
  dark: boolean
  toggle: () => void
}

export const useThemeStore = create<ThemeStore>((set) => ({
  dark: window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
  toggle: () => set((state) => {
    const newDark = !state.dark
    document.documentElement.classList.toggle('dark', newDark)
    return { dark: newDark }
  })
}))
