import type { SubtitleDisplayMode } from '@/stores/playerStore'
import { isAudioPath } from '@/lib/mediaFormats'

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]

// 长按时允许连续触发的动作；切换类动作忽略系统按键重复，避免反复开关
export const REPEATABLE_SHORTCUTS = new Set<string>([
  'seekBack',
  'seekForward',
  'seekBackFine',
  'seekForwardFine',
  'volumeUp',
  'volumeDown',
  'offsetMinus',
  'offsetPlus',
  'offsetMinusCoarse',
  'offsetPlusCoarse',
  'fontSizeUp',
  'fontSizeDown',
])

export const SUBTITLE_MODE_LABELS: Record<SubtitleDisplayMode, string> = {
  all: '全部',
  en: '仅英文',
  zh: '仅中文',
  off: '隐藏',
}

export const SUBTITLE_MODES: SubtitleDisplayMode[] = ['all', 'en', 'zh', 'off']

// 播放页来源页面名称，用于返回按钮的可读提示
export const ROUTE_LABELS: Record<string, string> = {
  '/': '文件库',
  '/podcast': '播客订阅',
  '/favorites': '收藏片段',
  '/words': '生词库',
  '/dict': '词库浏览',
  '/card': '今日复习',
  '/stats': '学习统计',
  '/articles': '文章打字',
  '/settings': '设置',
}

// 匹配 CJK 表意文字、假名、谚文及全角标点，用于区分中/英字幕行
const CJK_RE = /[\u2e80-\u9fff\uf900-\ufaff\u3000-\u303f\u3040-\u30ff\uac00-\ud7af]/

// 按显示模式过滤字幕文本行；off 模式在悬浮层隐藏，列表仍显示全文
export function filterSubtitleText(text: string, mode: SubtitleDisplayMode): string {
  if (mode === 'all' || mode === 'off') return text
  return text
    .split('\n')
    .filter((line) => (mode === 'zh' ? CJK_RE.test(line) : !CJK_RE.test(line)))
    .join('\n')
    .trim()
}

// 播放历史的来源类型：由播放源与是否关联播客节目推导
export function historyKindOf(sourceKind: string, episodeID: number): string {
  if (sourceKind === 'youtube') return 'youtube'
  if (sourceKind === 'bilibili') return 'bilibili'
  return episodeID > 0 ? 'podcast' : 'local'
}

// B站代理播放地址每次会话都会变，历史 key 优先用调用方传入的稳定标识
export function historyKeyOf(state: { filePath: string | null; historyKey: string }): string {
  return state.historyKey || state.filePath || ''
}

/** 媒体形态：入口显式声明优先，其次按远程地址/扩展名推断 */
export function resolveIsAudio(
  filePath: string | null,
  mediaKind: 'audio' | 'video' | null,
): boolean {
  if (mediaKind !== null) return mediaKind === 'audio'
  if (!filePath) return false
  if (/^https?:\/\//i.test(filePath)) return true
  return isAudioPath(filePath)
}
