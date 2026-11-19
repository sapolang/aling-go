import { usePlayerStore } from '@/stores/playerStore'
import type { LibraryFile } from '@/stores/libraryStore'
import type {
  PlatformSubtitleCue,
  PlatformSubtitleResult,
  SubtitleItem,
  WhisperSegmentsEvent,
} from '@/types/api'
import { showToast } from '@/components/feedback'

/** 媒体库同文件夹内按名称自然排序，取当前文件的下一个（自动下一集） */
export async function findNextEpisode(current: string): Promise<string | null> {
  try {
    const lib = await window.api.libraryList()
    const files = ((lib?.files || []) as LibraryFile[]).filter((f) => f.type !== 'pdf')
    const cur = files.find((f) => f.path === current)
    if (!cur) return null
    const siblings = files
      .filter((f) => f.folderId === cur.folderId)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    const idx = siblings.findIndex((f) => f.path === current)
    return idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1].path : null
  } catch {
    return null
  }
}

interface TranscriptionCallbacks {
  /** 更新进度文案，如「下载音频」「转录中」 */
  setLabel: (label: string) => void
}

/**
 * 启动字幕转录：
 * - YouTube/B站 走平台接口（官方字幕优先，抓不到再下载音轨转录）；
 * - 已订阅播客按 episodeID 转录；
 * - 本地文件直接调 Whisper。
 */
export async function startTranscription(
  filePath: string,
  { setLabel }: TranscriptionCallbacks,
): Promise<void> {
  const st = usePlayerStore.getState()
  // 在线视频走平台接口：已订阅节目按 episodeID 取，粘贴链接播放的按平台视频 ID 取
  const platformVideo = st.sourceKind === 'youtube' || st.sourceKind === 'bilibili'
  const isPodcast = !platformVideo && st.mediaEpisodeID > 0 && /^https?:\/\//i.test(filePath)
  const force = st.subtitles.length > 0
  const status = await window.api.whisperStatus()
  if (!status.loaded) {
    st.setTranscribing(true)
    st.setTranscriptionProgress(0)
    setLabel('下载模型')
    const dlCleanup = window.api.onDownloadProgress((pct: number) =>
      st.setTranscriptionProgress(pct),
    )
    try {
      await window.api.downloadWhisperModel('tiny')
      await window.api.setWhisperModel('tiny')
    } catch (err: any) {
      dlCleanup()
      st.setTranscribing(false)
      setLabel('')
      showToast('模型下载失败: ' + (err?.message || String(err)), 'error')
      return
    }
    dlCleanup()
  }
  st.setTranscribing(true)
  st.setTranscriptionProgress(0)
  setLabel(isPodcast || platformVideo ? '下载音频' : '转录中')

  // 增量字幕：后端 Whisper stdout 逐段吐出来，边转边显示。
  // 平台视频用 historyKey（yt:<id> / bili:<bvid>），播客用 episodeID，本地文件用播放路径，
  // 分别对应后端的 platformSubtitleEventKey / podcastSubtitleEventKey / 文件路径。
  const eventKey = platformVideo
    ? st.historyKey || filePath
    : isPodcast
      ? `podcast:${st.mediaEpisodeID}`
      : filePath
  const session = st.playSession
  const previousSubtitles = st.subtitles
  const isCurrent = () => {
    const cur = usePlayerStore.getState()
    return cur.playSession === session && cur.filePath === filePath
  }
  // 重新转录时先清空旧字幕，避免流式结果和旧字幕混排；失败时在 catch 里恢复
  if (previousSubtitles.length > 0) st.setSubtitles([])

  const cleanup = window.api.onWhisperProgress((d: { progress: number; status: string }) => {
    st.setTranscriptionProgress(d.progress)
    if (d.status === 'downloading') setLabel('下载音频')
    if (d.status === 'transcribing') setLabel('转录中')
  })
  // 收尾后忽略迟到的增量/重置事件，避免 reset 覆盖刚写入的最终结果
  let finished = false
  const incCleanup = window.api.onWhisperSegments((d: WhisperSegmentsEvent) => {
    if (finished || d.key !== eventKey || !isCurrent()) return
    if (d.reset) {
      usePlayerStore.getState().setSubtitles([])
      return
    }
    if (d.items.length === 0) return
    usePlayerStore.getState().appendSubtitles(d.items)
  })
  try {
    let subs: SubtitleItem[]
    if (platformVideo) {
      // 平台接口会先抓官方字幕，抓不到再下载音轨做本地转录
      const sourceKey = (st.historyKey || st.filePath || '').replace(/^(yt:|bili:)/, '')
      const result = (
        st.mediaEpisodeID > 0
          ? await window.api.platformGetSubtitles(st.mediaEpisodeID)
          : await window.api.platformGetSubtitlesBySource(st.sourceKind, sourceKey)
      ) as PlatformSubtitleResult
      if (!result.ok) throw new Error(result.error || '转录失败')
      subs = (result.cues || []).map((c: PlatformSubtitleCue, i: number) => ({
        id: i,
        startTime: c.start,
        endTime: c.end,
        text: c.text,
      }))
    } else if (isPodcast) {
      const result = await window.api.platformTranscribePodcast(st.mediaEpisodeID, force)
      if (!result.ok) throw new Error(result.error || '转录失败')
      subs = result.subtitles || []
    } else {
      subs = await window.api.whisperTranscribe(filePath)
      window.api.cacheSubtitles(filePath, subs)
    }
    finished = true
    // 用户已切到别的文件时丢弃旧任务的结果，避免写进当前字幕
    if (!isCurrent()) return
    if (subs.length === 0) {
      showToast('转录完成，但未识别到语音。请在设置页检查模型和语言设置是否正确', 'warning')
    }
    st.setSubtitles(subs)
  } catch (err: any) {
    finished = true
    if (!isCurrent()) return
    st.setSubtitles(previousSubtitles)
    const msg = err?.message || String(err)
    st.setTranscriptionProgress(-1)
    if (msg.includes('fetch'))
      showToast('模型下载失败，请检查网络或代理后在设置页重新下载模型', 'error')
    else showToast(`转录失败: ${msg}`, 'error')
  } finally {
    cleanup()
    incCleanup()
    st.setTranscribing(false)
    setLabel('')
  }
}

/** 导出当前字幕为 SRT 文件 */
export async function exportSubtitles(): Promise<void> {
  const subs = usePlayerStore.getState().subtitles
  if (subs.length === 0) return
  const toSrtTime = (s: number) => {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    const ms = Math.round((sec % 1) * 1000)
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${Math.floor(sec).toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`
  }
  const srt = subs
    .map((s, i) => `${i + 1}\n${toSrtTime(s.startTime)} --> ${toSrtTime(s.endTime)}\n${s.text}\n`)
    .join('\n')
  const filePath = await window.api.saveFile('subtitle.srt')
  if (filePath) await window.api.writeTextFile(filePath, srt)
}
