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
 * 打开本地媒体文件：设置播放源、加载波形，并从字幕缓存恢复字幕。
 * 字幕只有「缓存」一个自动来源：转录结果和手动导入的 SRT 都会写入缓存，
 * 因此清理字幕缓存后重新打开不会自动出现字幕，需要重新转录或再次导入。
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
    if (cached && cached.length > 0) st.setSubtitles(cached)
  } catch (err) {
    console.error('Failed to load cached subtitles:', err)
  }
}
