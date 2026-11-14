import type { NavigateFunction } from 'react-router-dom'
import { usePlayerStore } from '@/stores/playerStore'
import type { PlatformSubtitleCue, PlatformSubtitleResult, ResolvedMedia } from '@/types/electron'

// 只对 YouTube / B站 链接响应，避免普通文本粘贴触发解析
export function looksLikeMediaLink(text: string): boolean {
  return /(youtube\.com|youtu\.be|bilibili\.com|b23\.tv|bili2233\.cn)/i.test(text)
}

// 平台字幕后台加载：用户切走或换了媒体后不再写入
function loadSourceSubtitles(
  sourceKind: 'youtube' | 'bilibili',
  videoId: string,
  key: string,
): void {
  window.api
    .platformGetSubtitlesBySource(sourceKind, videoId)
    .then((r: PlatformSubtitleResult) => {
      if (!r?.ok || !r.cues || r.cues.length === 0) return
      const st = usePlayerStore.getState()
      if ((st.historyKey || st.filePath) !== key) return
      st.setSubtitles(
        r.cues.map((c: PlatformSubtitleCue, i: number) => ({
          id: i,
          startTime: c.start,
          endTime: c.end,
          text: c.text,
        })),
      )
    })
    .catch(() => {
      // 字幕失败不影响播放，用户可在播放页手动转录
    })
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
      sourceUrl: res.mediaKey,
    })
    navigate('/player', { state: { from } })
    loadSourceSubtitles('youtube', res.videoId, res.mediaKey)
    return true
  }

  if (res.kind === 'bilibili') {
    player.setFilePath(res.playUrl, res.title || 'B站 视频', 0, {
      sourceKind: 'bilibili',
      mediaKind: 'video',
      historyKey: res.mediaKey,
      cover: res.cover,
      sourceUrl: res.videoId,
    })
    if (res.duration > 0) player.setDuration(res.duration)
    navigate('/player', { state: { from } })
    loadSourceSubtitles('bilibili', res.videoId, res.mediaKey)
    return true
  }

  return false
}
