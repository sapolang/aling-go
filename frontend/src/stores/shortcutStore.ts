import { create } from 'zustand'

export type ShortcutActionId =
  | 'playPause'
  | 'seekBack'
  | 'seekForward'
  | 'seekBackFine'
  | 'seekForwardFine'
  | 'rateCycle'
  | 'volumeUp'
  | 'volumeDown'
  | 'mute'
  | 'prevSentence'
  | 'replaySentence'
  | 'nextSentence'
  | 'toggleSentenceLoop'
  | 'clearLoop'
  | 'autoPause'
  | 'subtitleMode'
  | 'translationToggle'
  | 'offsetMinus'
  | 'offsetPlus'
  | 'offsetMinusCoarse'
  | 'offsetPlusCoarse'
  | 'fontSizeUp'
  | 'fontSizeDown'
  | 'favoriteSentence'
  | 'aiSentence'
  | 'speakSentence'
  | 'podcastMode'
  | 'autoNextEpisode'
  | 'hoverPause'
  | 'toggleFullscreen'
  | 'help'
  | 'exit'

export type ShortcutGroupId = 'playback' | 'sentence' | 'subtitle' | 'learning' | 'general'

export interface ShortcutBinding {
  /** 使用 KeyboardEvent.code，避免输入法、大写状态与非 QWERTY 布局干扰 */
  code: string
  shift: boolean
  alt: boolean
}

export interface ShortcutAction {
  id: ShortcutActionId
  label: string
  group: ShortcutGroupId
  defaultBinding: ShortcutBinding
}

export type ShortcutBindings = Record<ShortcutActionId, ShortcutBinding | null>

const STORAGE_KEY = 'aling.playerShortcuts.v1'

const binding = (code: string, shift = false, alt = false): ShortcutBinding => ({
  code,
  shift,
  alt,
})

export const SHORTCUT_GROUP_ORDER: ShortcutGroupId[] = [
  'playback',
  'sentence',
  'subtitle',
  'learning',
  'general',
]

export const SHORTCUT_GROUP_LABELS: Record<ShortcutGroupId, string> = {
  playback: '播放控制',
  sentence: '句子控制',
  subtitle: '字幕',
  learning: '学习与辅助',
  general: '通用',
}

// 默认键位对齐 learn.trancy.org：A 上一句 / S 重播 / D 下一句 / Q 播完暂停 / R 单句循环
export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  { id: 'playPause', label: '播放 / 暂停', group: 'playback', defaultBinding: binding('Space') },
  { id: 'seekBack', label: '后退 5 秒', group: 'playback', defaultBinding: binding('ArrowLeft') },
  {
    id: 'seekForward',
    label: '前进 5 秒',
    group: 'playback',
    defaultBinding: binding('ArrowRight'),
  },
  {
    id: 'seekBackFine',
    label: '后退 1 秒',
    group: 'playback',
    defaultBinding: binding('ArrowLeft', true),
  },
  {
    id: 'seekForwardFine',
    label: '前进 1 秒',
    group: 'playback',
    defaultBinding: binding('ArrowRight', true),
  },
  { id: 'rateCycle', label: '切换倍速', group: 'playback', defaultBinding: binding('KeyP') },
  { id: 'volumeUp', label: '音量增大', group: 'playback', defaultBinding: binding('ArrowUp') },
  {
    id: 'volumeDown',
    label: '音量减小',
    group: 'playback',
    defaultBinding: binding('ArrowDown'),
  },
  { id: 'mute', label: '静音切换', group: 'playback', defaultBinding: binding('KeyM') },

  { id: 'prevSentence', label: '上一句', group: 'sentence', defaultBinding: binding('KeyA') },
  { id: 'replaySentence', label: '重播当前句', group: 'sentence', defaultBinding: binding('KeyS') },
  { id: 'nextSentence', label: '下一句', group: 'sentence', defaultBinding: binding('KeyD') },
  {
    id: 'toggleSentenceLoop',
    label: '单句循环',
    group: 'sentence',
    defaultBinding: binding('KeyR'),
  },
  { id: 'clearLoop', label: '清除循环', group: 'sentence', defaultBinding: binding('KeyR', true) },
  { id: 'autoPause', label: '播完本句暂停', group: 'sentence', defaultBinding: binding('KeyQ') },

  {
    id: 'subtitleMode',
    label: '切换字幕模式',
    group: 'subtitle',
    defaultBinding: binding('KeyE'),
  },
  {
    id: 'translationToggle',
    label: '显示 / 隐藏翻译',
    group: 'subtitle',
    defaultBinding: binding('KeyZ'),
  },
  {
    id: 'offsetMinus',
    label: '字幕提前 0.1s',
    group: 'subtitle',
    defaultBinding: binding('Comma'),
  },
  {
    id: 'offsetPlus',
    label: '字幕延后 0.1s',
    group: 'subtitle',
    defaultBinding: binding('Period'),
  },
  {
    id: 'offsetMinusCoarse',
    label: '字幕提前 1s',
    group: 'subtitle',
    defaultBinding: binding('Comma', true),
  },
  {
    id: 'offsetPlusCoarse',
    label: '字幕延后 1s',
    group: 'subtitle',
    defaultBinding: binding('Period', true),
  },
  {
    id: 'fontSizeUp',
    label: '增大字幕字号',
    group: 'subtitle',
    defaultBinding: binding('Equal'),
  },
  {
    id: 'fontSizeDown',
    label: '减小字幕字号',
    group: 'subtitle',
    defaultBinding: binding('Minus'),
  },

  {
    id: 'favoriteSentence',
    label: '收藏当前句',
    group: 'learning',
    defaultBinding: binding('KeyF'),
  },
  { id: 'aiSentence', label: 'AI 翻译 / 详解', group: 'learning', defaultBinding: binding('KeyT') },
  {
    id: 'speakSentence',
    label: '朗读当前句',
    group: 'learning',
    defaultBinding: binding('KeyS', true),
  },
  { id: 'podcastMode', label: '播客模式', group: 'learning', defaultBinding: binding('KeyV') },
  {
    id: 'autoNextEpisode',
    label: '自动下一集',
    group: 'learning',
    defaultBinding: binding('KeyN'),
  },
  { id: 'hoverPause', label: '悬停查词暂停', group: 'learning', defaultBinding: binding('KeyH') },

  {
    id: 'toggleFullscreen',
    label: '全屏切换',
    group: 'general',
    defaultBinding: binding('KeyW', false, true),
  },
  { id: 'help', label: '快捷键帮助', group: 'general', defaultBinding: binding('Slash', true) },
  { id: 'exit', label: '关闭当前浮层', group: 'general', defaultBinding: binding('Escape') },
]

const buildDefaultBindings = (): ShortcutBindings =>
  Object.fromEntries(
    SHORTCUT_ACTIONS.map((action) => [action.id, action.defaultBinding]),
  ) as ShortcutBindings

const isShortcutBinding = (value: unknown): value is ShortcutBinding => {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.code === 'string' &&
    typeof record.shift === 'boolean' &&
    typeof record.alt === 'boolean'
  )
}

const loadBindings = (): ShortcutBindings => {
  const defaults = buildDefaultBindings()
  if (typeof localStorage === 'undefined') return defaults
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaults
    const parsed = JSON.parse(raw) as Partial<Record<ShortcutActionId, unknown>>
    for (const action of SHORTCUT_ACTIONS) {
      const value = parsed[action.id]
      if (value === null) defaults[action.id] = null
      else if (isShortcutBinding(value)) defaults[action.id] = value
    }
  } catch {
    // 忽略损坏的本地数据，回退默认键位
  }
  return defaults
}

const saveBindings = (bindings: ShortcutBindings) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings))
  } catch {
    // 忽略持久化失败（如隐私模式）
  }
}

export const sameBinding = (a: ShortcutBinding, b: ShortcutBinding): boolean =>
  a.code === b.code && a.shift === b.shift && a.alt === b.alt

export const bindingKey = (b: ShortcutBinding): string =>
  `${b.alt ? 'Alt+' : ''}${b.shift ? 'Shift+' : ''}${b.code}`

export const eventToBinding = (
  e: Pick<KeyboardEvent, 'code' | 'shiftKey' | 'altKey'>,
): ShortcutBinding => ({ code: e.code, shift: e.shiftKey, alt: e.altKey })

const CODE_LABELS: Record<string, string> = {
  Space: 'Space',
  Escape: 'Esc',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Comma: ',',
  Period: '.',
  Slash: '/',
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  Semicolon: ';',
  Quote: "'",
  Backslash: '\\',
}

const baseLabel = (code: string): string => {
  if (CODE_LABELS[code]) return CODE_LABELS[code]
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  return code
}

export const formatBinding = (b: ShortcutBinding): string => {
  // Shift+/ 直接显示为 ?，与帮助面板里的写法一致
  if (!b.alt && b.shift && b.code === 'Slash') return '?'
  return `${b.alt ? 'Alt+' : ''}${b.shift ? 'Shift+' : ''}${baseLabel(b.code)}`
}

export const findActionForEvent = (
  bindings: ShortcutBindings,
  e: Pick<KeyboardEvent, 'code' | 'shiftKey' | 'altKey'>,
): ShortcutActionId | null => {
  const candidate = eventToBinding(e)
  for (const action of SHORTCUT_ACTIONS) {
    const current = bindings[action.id]
    if (current && sameBinding(current, candidate)) return action.id
  }
  return null
}

interface ShortcutStore {
  bindings: ShortcutBindings
  /** 绑定成功返回 null；键位冲突时返回冲突的动作 id，且不写入 */
  setBinding: (id: ShortcutActionId, value: ShortcutBinding | null) => ShortcutActionId | null
  resetBinding: (id: ShortcutActionId) => void
  resetAll: () => void
}

export const useShortcutStore = create<ShortcutStore>((set, get) => ({
  bindings: loadBindings(),

  setBinding: (id, value) => {
    if (value) {
      const conflict = SHORTCUT_ACTIONS.find((action) => {
        if (action.id === id) return false
        const current = get().bindings[action.id]
        return current !== null && sameBinding(current, value)
      })
      if (conflict) return conflict.id
    }
    const next = { ...get().bindings, [id]: value }
    saveBindings(next)
    set({ bindings: next })
    return null
  },

  resetBinding: (id) => {
    const action = SHORTCUT_ACTIONS.find((item) => item.id === id)
    if (!action) return
    const next = { ...get().bindings, [id]: action.defaultBinding }
    saveBindings(next)
    set({ bindings: next })
  },

  resetAll: () => {
    const next = buildDefaultBindings()
    saveBindings(next)
    set({ bindings: next })
  },
}))
