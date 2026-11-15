import { useEffect, useRef } from 'react'
import { usePlayerStore } from '@/stores/playerStore'
import { basename } from '@/utils/path'
import { historyKindOf } from './constants'

/**
 * 播放进度只写入 history 表（唯一事实来源）：
 * - 每次进入播放（含同媒体重播）写一条历史；
 * - 播放中每 5 秒落一次进度；
 * - 暂停/播完立即补落一次，避免最后几秒丢失。
 * 不再同步重写 library.json，避免同一份进度落盘两次。
 */
export function usePlaybackHistory(
  historyKey: string,
  playSession: number,
  playing: boolean,
): void {
  useEffect(() => {
    if (!historyKey) return
    const st = usePlayerStore.getState()
    window.api.historyUpsert({
      mediaKey: historyKey,
      kind: historyKindOf(st.sourceKind, st.mediaEpisodeID),
      title: st.mediaTitle || basename(st.filePath || ''),
      cover: st.historyCover,
      sourceUrl: st.historySourceUrl,
      episodeId: st.mediaEpisodeID,
      position: 0,
      duration: 0,
    })
  }, [historyKey, playSession])

  // 播放中每 5 秒落一次进度：YouTube/B站 没有原生 timeupdate，统一读 store
  useEffect(() => {
    if (!historyKey) return
    const timer = window.setInterval(() => {
      const st = usePlayerStore.getState()
      if (!st.playing) return
      window.api.historyUpdatePosition(historyKey, st.played, st.duration)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [historyKey])

  // 暂停或播完时立即落一次，避免最后几秒进度丢失
  const wasPlayingRef = useRef(false)
  useEffect(() => {
    const was = wasPlayingRef.current
    wasPlayingRef.current = playing
    if (!was || playing || !historyKey) return
    const st = usePlayerStore.getState()
    // 切换文件时 store 已重置，duration 为 0，不能把新文件的进度写成 0
    if (st.duration <= 0 || st.played <= 0) return
    window.api.historyUpdatePosition(historyKey, st.played, st.duration)
  }, [playing, historyKey])
}
