import type { NavigateFunction } from 'react-router-dom'
import { usePlayerStore } from '@/stores/playerStore'
import type { ResolvedMedia } from '@/types/api'

// 只对 YouTube / B站 链接响应，避免普通文本粘贴触发解析
export function looksLikeMediaLink(text: string): boolean {
  return /(youtube\.com|youtu\.be|bilibili\.com|b23\.tv|bili2233\.cn)/i.test(text)
}

// 打开解析后的视频链接，返回是否已进入播放器；频道链接由调用方单独处理
export function openResolvedMedia(
  res: ResolvedMedia,
  navigate: NavigateFunction,
  from: string,
): boolean {
  const player = usePlayerStore.getState()
  if (!res.ok) return false

  if (res.kind === 'youtube') {
    player.setFilePath(res.playUrl || res.mediaKey, res.title || 'YouTube', 0, {
      sourceKind: 'youtube',
      mediaKind: 'video',
      historyKey: res.mediaKey,
      cover: res.cover,
      // sourceUrl 统一为可打开的原始页面地址，mediaKey 只做内部标识
      sourceUrl: `https://www.youtube.com/watch?v=${res.videoId}`,
    })
    navigate('/player', { state: { from } })
    return true
  }

  if (res.kind === 'bilibili') {
    player.setFilePath(res.playUrl, res.title || 'B站 视频', 0, {
      sourceKind: 'bilibili',
      mediaKind: 'video',
      historyKey: res.mediaKey,
      cover: res.cover,
      sourceUrl: `https://www.bilibili.com/video/${res.videoId}`,
      biliParts: (res.parts || []).map((p) => ({
        cid: p.cid,
        page: p.page,
        title: p.title,
        duration: p.duration,
      })),
      biliCID: res.cid || 0,
    })
    if (res.duration > 0) player.setDuration(res.duration)
    navigate('/player', { state: { from } })
    return true
  }

  return false
}
