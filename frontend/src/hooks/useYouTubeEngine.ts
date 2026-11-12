import { useCallback, useEffect, useRef } from 'react'
import { usePlayerStore } from '@/stores/playerStore'

// /yt-embed 中转页每 250ms 回传一次播放状态
interface YouTubeStatusMessage {
  source: 'yt-embed'
  event: 'status'
  currentTime?: number
  duration?: number
  // YouTube 播放器状态：-1 未开始 / 0 结束 / 1 播放 / 2 暂停 / 3 缓冲 / 5 已就绪
  state?: number
}

/**
 * 把 YouTube iframe 伪装成一个普通的播放引擎：
 * 时间轴回写 store，store 的播放/跳转/倍速/音量再转发给中转页。
 * 这样播放页的其余逻辑只依赖 store，无需感知 iframe 的存在。
 */
export function useYouTubeEngine(active: boolean, videoId: string, mediaPort: number) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const playing = usePlayerStore((s) => s.playing)
  const playbackRate = usePlayerStore((s) => s.playbackRate)
  const volume = usePlayerStore((s) => s.volume)
  const muted = usePlayerStore((s) => s.muted)
  const seekTo = usePlayerStore((s) => s.seekTo)

  const post = useCallback((payload: Record<string, unknown>) => {
    iframeRef.current?.contentWindow?.postMessage({ source: 'aling', ...payload }, '*')
  }, [])

  // 进度回写：未开始和已就绪状态下 getCurrentTime 恒为 0，不能拿来更新字幕
  useEffect(() => {
    if (!active) return
    const onMessage = (event: MessageEvent) => {
      const data = event.data as YouTubeStatusMessage | undefined
      if (!data || data.source !== 'yt-embed' || data.event !== 'status') return
      const st = usePlayerStore.getState()
      if (data.state !== -1 && data.state !== 5 && typeof data.currentTime === 'number') {
        st.setPlayed(data.currentTime)
      }
      if (typeof data.duration === 'number' && data.duration > 0) {
        st.setDuration(data.duration)
      }
      // 视频播完时同步播放状态，避免按钮一直停留在「播放中」
      if (data.state === 0 && st.playing) st.setPlaying(false)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [active])

  useEffect(() => {
    if (!active) return
    post({ command: playing ? 'play' : 'pause' })
  }, [active, playing, post])

  useEffect(() => {
    if (!active || seekTo === null || seekTo < 0) return
    post({ command: 'seek', time: seekTo, playing })
    usePlayerStore.getState().requestSeek(-1)
  }, [active, seekTo, playing, post])

  useEffect(() => {
    if (!active) return
    post({ command: 'rate', rate: playbackRate })
  }, [active, playbackRate, post])

  useEffect(() => {
    if (!active) return
    post({ command: 'volume', volume, muted })
  }, [active, volume, muted, post])

  const embedUrl =
    active && videoId && mediaPort
      ? `http://127.0.0.1:${mediaPort}/yt-embed?v=${encodeURIComponent(videoId)}`
      : ''

  return { iframeRef, embedUrl }
}
