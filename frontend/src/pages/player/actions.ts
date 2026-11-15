import { Window } from '@wailsio/runtime'
import { usePlayerStore } from '@/stores/playerStore'
import type { ShortcutActionId } from '@/stores/shortcutStore'
import type { SubtitleItem } from '@/types/api'
import { findCueIndexAt, formatClockTime as formatClock } from '@/lib/subtitles'
import { showToast } from '@/components/feedback'
import { showPlayerHud } from '@/components/PlayerHud'
import { speak } from '@/lib/tts'
import {
  PLAYBACK_RATES,
  SUBTITLE_MODE_LABELS,
  SUBTITLE_MODES,
  filterSubtitleText,
} from './constants'

/** 时间读写依赖原生媒体元素；YouTube 等无原生元素的来源由调用方回退到 store */
export interface PlayerActionContext {
  getTime: () => number
  getDuration: () => number
  seekTo: (time: number) => void
  resetHoverPause: () => void
  hasAITarget: () => boolean
}

/** 需要页面级 UI 状态配合的动作，统一由调用方实现 */
export interface PlayerActionUI {
  openFavorite: (sub: SubtitleItem) => void
  openShortcutHelp: () => void
  /** 传入 null 表示关闭已打开的 AI 目标，传入当前句表示新开 */
  toggleAIPanel: (sub: SubtitleItem | null) => void
}

/**
 * 播放动作表：键盘快捷键与控制栏按钮共用同一实现，
 * 避免 HUD 文案、开关判断等逻辑出现两份并逐渐漂移。
 * 返回 true 表示动作已被处理。
 */
export function runPlayerAction(
  action: ShortcutActionId,
  ctx: PlayerActionContext,
  ui: PlayerActionUI,
): boolean {
  const st = usePlayerStore.getState()
  const subs = st.subtitles
  const off = st.subtitleOffset
  const readTime = ctx.getTime
  const applySeek = (time: number) => ctx.seekTo(time)

  // 当前句：优先使用精确命中，其次退回到「最后一个开始时间不晚于当前时间」的句子
  const t = readTime() - off
  const curIdx = findCueIndexAt(subs, t)
  const lastBefore = (time: number) => {
    let idx = -1
    for (let i = 0; i < subs.length; i++) {
      if (subs[i].startTime + off <= time + 0.3) idx = i
      else break
    }
    return idx
  }
  const seekToSub = (i: number) => {
    if (i < 0 || i >= subs.length) return
    applySeek(subs[i].startTime + off)
    st.setPlaying(true)
  }
  const currentSubIndex = () => {
    const idx = curIdx >= 0 ? curIdx : lastBefore(t)
    return idx >= 0 && idx < subs.length ? idx : -1
  }
  // 单句循环对应的区间在切句后自动清除，避免用户被拉回原句
  const clearSentenceLoop = () => {
    const idx = currentSubIndex()
    const cur = subs[idx]
    if (cur && st.loopStart === cur.startTime + off && st.loopEnd === cur.endTime + off) {
      st.setLoop(null, null)
    }
  }

  switch (action) {
    case 'playPause':
      ctx.resetHoverPause()
      st.setPlaying(!st.playing)
      return true

    case 'seekBack':
    case 'seekBackFine': {
      clearSentenceLoop()
      const delta = action === 'seekBack' ? 5 : 1
      applySeek(Math.max(0, readTime() - delta))
      return true
    }

    case 'seekForward':
    case 'seekForwardFine': {
      clearSentenceLoop()
      const delta = action === 'seekForward' ? 5 : 1
      applySeek(Math.min(ctx.getDuration(), readTime() + delta))
      return true
    }

    case 'rateCycle': {
      const next =
        PLAYBACK_RATES[(PLAYBACK_RATES.indexOf(st.playbackRate) + 1) % PLAYBACK_RATES.length]
      st.setPlaybackRate(next)
      showPlayerHud(`播放速度 ${next}x`)
      return true
    }

    case 'volumeUp':
    case 'volumeDown': {
      st.adjustVolume(action === 'volumeUp' ? 0.1 : -0.1)
      const next = usePlayerStore.getState()
      showPlayerHud(next.muted ? '已静音' : `音量 ${Math.round(next.volume * 100)}%`)
      return true
    }

    case 'mute': {
      st.toggleMuted()
      showPlayerHud(usePlayerStore.getState().muted ? '已静音' : '已取消静音')
      return true
    }

    case 'prevSentence': {
      const idx = currentSubIndex()
      if (idx <= 0) return true
      clearSentenceLoop()
      seekToSub(idx - 1)
      return true
    }

    case 'replaySentence': {
      const idx = currentSubIndex()
      if (idx >= 0) seekToSub(idx)
      return true
    }

    case 'nextSentence': {
      const next = curIdx >= 0 ? curIdx + 1 : subs.findIndex((s) => s.startTime + off > t + 0.3)
      if (next >= 0 && next < subs.length) {
        clearSentenceLoop()
        seekToSub(next)
      }
      return true
    }

    case 'toggleSentenceLoop': {
      const idx = currentSubIndex()
      if (idx < 0) return true
      const start = subs[idx].startTime + off
      const end = subs[idx].endTime + off
      if (st.loopStart === start && st.loopEnd === end) {
        st.setLoop(null, null)
        showPlayerHud('已关闭单句循环')
      } else {
        st.setLoop(start, end)
        showPlayerHud('单句循环：开')
      }
      return true
    }

    case 'clearLoop':
      st.setLoop(null, null)
      showPlayerHud('已清除循环区间')
      return true

    case 'toggleLoopAB':
      toggleLoopAB(readTime())
      return true

    case 'autoPause': {
      const next = !st.autoPause
      st.setAutoPause(next)
      showPlayerHud(next ? '已开启自动暂停' : '已关闭自动暂停')
      return true
    }

    case 'subtitleMode': {
      const next =
        SUBTITLE_MODES[(SUBTITLE_MODES.indexOf(st.subtitleDisplayMode) + 1) % SUBTITLE_MODES.length]
      st.setSubtitleDisplayMode(next)
      showPlayerHud(`字幕显示：${SUBTITLE_MODE_LABELS[next]}`)
      return true
    }

    case 'translationToggle': {
      const next = st.subtitleDisplayMode === 'all' ? 'en' : 'all'
      st.setSubtitleDisplayMode(next)
      showPlayerHud(next === 'en' ? '已隐藏翻译' : '已显示翻译')
      return true
    }

    case 'offsetMinus':
    case 'offsetPlus':
    case 'offsetMinusCoarse':
    case 'offsetPlusCoarse': {
      const delta =
        action === 'offsetMinus'
          ? -0.1
          : action === 'offsetPlus'
            ? 0.1
            : action === 'offsetMinusCoarse'
              ? -1
              : 1
      st.adjustSubtitleOffset(delta)
      showPlayerHud(`字幕偏移 ${usePlayerStore.getState().subtitleOffset.toFixed(1)}s`)
      return true
    }

    case 'fontSizeUp':
    case 'fontSizeDown': {
      st.adjustSubtitleFontScale(action === 'fontSizeUp' ? 0.1 : -0.1)
      const scale = usePlayerStore.getState().subtitleFontScale
      showPlayerHud(`字幕字号 ${Math.round(scale * 100)}%`)
      return true
    }

    case 'favoriteSentence': {
      const idx = currentSubIndex()
      if (idx < 0) {
        showPlayerHud('当前没有可收藏的字幕句', 'warning')
        return true
      }
      ui.openFavorite(subs[idx])
      return true
    }

    case 'aiSentence': {
      if (ctx.hasAITarget()) {
        ui.toggleAIPanel(null)
        return true
      }
      const idx = currentSubIndex()
      if (idx < 0) {
        showPlayerHud('当前没有可操作的字幕句', 'warning')
        return true
      }
      ui.toggleAIPanel(subs[idx])
      return true
    }

    case 'speakSentence': {
      const idx = currentSubIndex()
      if (idx < 0) {
        showPlayerHud('当前没有可朗读的字幕句')
        return true
      }
      speak(filterSubtitleText(subs[idx].text, 'en') || subs[idx].text)
      showPlayerHud('正在朗读当前句')
      return true
    }

    case 'toggleFullscreen':
      void Window.IsFullscreen()
        .then(async (is) => {
          await Window.ToggleFullscreen()
          showPlayerHud(is ? '已退出全屏' : '已进入全屏')
        })
        .catch(() => showToast('全屏切换失败', 'warning'))
      return true

    case 'focusMode': {
      const next = !st.focusMode
      st.setFocusMode(next)
      showPlayerHud(next ? '已进入专注模式' : '已退出专注模式')
      return true
    }

    case 'autoNextEpisode': {
      const next = !st.autoNextEpisode
      st.setAutoNextEpisode(next)
      showPlayerHud(next ? '已开启自动下一集' : '已关闭自动下一集')
      return true
    }

    case 'hoverPause': {
      const next = !st.hoverPause
      st.setHoverPause(next)
      showPlayerHud(next ? '已开启悬停暂停' : '已关闭悬停暂停')
      return true
    }

    case 'help':
      ui.openShortcutHelp()
      return true

    default:
      return false
  }
}

// A/B 循环设点三态切换：未设点 → 设 A 点 → 设 B 点开始循环 → 清除
export function toggleLoopAB(now: number): void {
  const st = usePlayerStore.getState()
  if (st.loopStart === null) {
    st.setLoop(now, null)
    showPlayerHud(`已设 A 点 ${formatClock(now)}`)
  } else if (st.loopEnd === null) {
    if (now <= st.loopStart + 0.05) {
      showPlayerHud('B 点需在 A 点之后', 'warning')
      return
    }
    st.setLoop(st.loopStart, now)
    showPlayerHud(`A-B 循环 ${formatClock(st.loopStart)} - ${formatClock(now)}`)
  } else {
    st.setLoop(null, null)
    showPlayerHud('已清除循环')
  }
}
