import SrtParser from 'srt-parser-2'
import { usePlayerStore } from '@/stores/playerStore'
import { timeToSeconds } from '@/lib/srt'
import type { SubtitleItem } from '@/types/api'

/** 读取并解析 SRT，写入播放器 store 与字幕缓存 */
export async function loadSrtFile(path: string): Promise<void> {
  const st = usePlayerStore.getState()
  try {
    const content = await window.api.readTextFile(path)
    const parsed = new SrtParser().fromSrt(content)
    const subs: SubtitleItem[] = parsed.map((s: any) => ({
      id: parseInt(s.id),
      startTime: timeToSeconds(s.startTime),
      endTime: timeToSeconds(s.endTime),
      text: s.text,
    }))
    st.setSubtitles(subs)
    st.setSubtitlePath(path)
    if (st.filePath) window.api.cacheSubtitles(st.filePath, subs)
  } catch (err) {
    console.error('Failed to load SRT:', err)
  }
}

/**
 * 打开本地媒体文件：设置播放源、加载波形，并按「字幕缓存 → 同名 SRT」的顺序加载字幕。
 * 文件库与播放页共用这一入口，避免两处各自实现导致行为漂移。
 */
export async function openLocalMedia(filePath: string): Promise<void> {
  const st = usePlayerStore.getState()
  st.setFilePath(filePath)
  void window.api.recentAdd(filePath)
  st.setWaveformLoading(true)
  window.api
    .getWaveformData(filePath)
    .then((data: number[]) => {
      if (data && data.length > 0) st.setWaveformData(data)
      else st.setWaveformLoading(false)
    })
    .catch(() => st.setWaveformLoading(false))

  try {
    const cached = await window.api.getCachedSubtitles(filePath)
    if (cached && cached.length > 0) {
      st.setSubtitles(cached)
      return
    }
    const srtPath = filePath.replace(/\.[^.]+$/, '.srt')
    try {
      await window.api.readTextFile(srtPath)
      await loadSrtFile(srtPath)
    } catch (err) {
      console.error('Failed to load SRT:', err)
    }
  } catch (err) {
    console.error('Failed to load cached subtitles:', err)
  }
}
