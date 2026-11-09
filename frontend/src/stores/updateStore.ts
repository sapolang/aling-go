import { create } from 'zustand'

interface UpdateStore {
  hasUpdate: boolean
  latestVersion: string
  setAvailable: (version: string) => void
  clear: () => void
}

export const useUpdateStore = create<UpdateStore>((set) => ({
  hasUpdate: false,
  latestVersion: '',
  setAvailable: (version) => set({ hasUpdate: true, latestVersion: version }),
  clear: () => set({ hasUpdate: false, latestVersion: '' }),
}))
