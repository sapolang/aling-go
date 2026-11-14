import { create } from 'zustand'

export type UpdateStep = 'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'ready'

interface UpdateStore {
  // 更新流程状态放在全局 store 中：设置页卸载重建后仍能保持「下载中 / 已就绪」，
  // 避免切走再回来又被当成未下载而重复触发下载。
  step: UpdateStep
  latestVersion: string
  progress: number
  error: string
  hasUpdate: boolean
  init: () => () => void
  sync: () => Promise<void>
  check: (silent?: boolean) => Promise<void>
  download: () => Promise<void>
  apply: () => Promise<void>
  setAvailable: (version: string) => void
  clear: () => void
}

export const useUpdateStore = create<UpdateStore>((set, get) => ({
  step: 'idle',
  latestVersion: '',
  progress: 0,
  error: '',
  hasUpdate: false,

  // 下载进度订阅只需一次，且不随设置页卸载而丢失
  init: () => {
    return window.api.updateOnProgress((pct: number) => {
      if (get().step === 'downloading') set({ progress: pct })
    })
  },

  // 页面重建（如渲染进程刷新）后，用后端真实阶段纠正前端状态
  sync: async () => {
    if (get().step === 'downloading') return
    try {
      const st = await window.api.getUpdateState()
      switch (st?.state) {
        case 'downloading':
        case 'verifying':
        case 'installing':
          set({ step: 'downloading' })
          break
        case 'ready':
          set({ step: 'ready' })
          break
        case 'available':
          set({
            step: 'available',
            hasUpdate: true,
            latestVersion: st.latestVersion || get().latestVersion,
          })
          break
        case 'up-to-date':
          set({ step: 'latest', hasUpdate: false })
          break
        default:
          break
      }
    } catch {
      // 同步失败不影响正常操作
    }
  },

  check: async (silent = false) => {
    const { step } = get()
    if (step === 'checking' || step === 'downloading' || step === 'ready') return
    set({ step: 'checking', error: '' })
    try {
      const info = await window.api.checkUpdate()
      if (info?.error) {
        set(silent ? { step: 'idle' } : { step: 'idle', error: info.error })
      } else if (!info?.hasUpdate) {
        set({ hasUpdate: false, latestVersion: '', step: 'latest' })
      } else {
        set({ hasUpdate: true, latestVersion: info.latestVersion || '', step: 'available' })
      }
    } catch (err) {
      set(silent ? { step: 'idle' } : { step: 'idle', error: '检查更新失败: ' + err })
    }
  },

  download: async () => {
    const { step } = get()
    if (step === 'downloading' || step === 'ready') return
    set({ step: 'downloading', progress: 0, error: '' })
    try {
      const r = await window.api.downloadUpdate()
      if (r?.ok) {
        set({ step: 'ready' })
      } else {
        set({ step: 'available', error: r?.error || '下载失败' })
      }
    } catch (err) {
      set({ step: 'available', error: '下载失败: ' + err })
    }
  },

  apply: async () => {
    try {
      const r = await window.api.applyUpdate()
      if (!r?.ok) set({ error: r?.error || '安装失败，请稍后重试' })
    } catch (err) {
      set({ error: '安装失败: ' + err })
    }
  },

  // 后台检查到新版本：下载 / 就绪阶段不允许回退到「发现新版本」
  setAvailable: (version) => {
    const { step } = get()
    if (step === 'downloading' || step === 'ready') return
    set({ hasUpdate: true, latestVersion: version, step: 'available', error: '' })
  },

  clear: () => set({ hasUpdate: false, latestVersion: '', step: 'idle', error: '' }),
}))
