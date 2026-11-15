import { useEffect, useRef, useState, type RefObject } from 'react'
import { usePlayerStore } from '@/stores/playerStore'
import { findCueIndexAt } from '@/lib/subtitles'
import { showPlayerHud } from '@/components/PlayerHud'

interface UseMediaElementOptions {
  /** 当前播放源；变化时重新绑定媒体事件 */
  filePath: string | null
  /** 播完后由页面决定是否自动下一集 */
  onEnded: () => void
}

export interface MediaElementHandle {
  mediaRef: RefObject<HTMLVideoElement>
  playError: string | null
  converting: boolean
  fallbackPath: string | null
  activeMediaPath: string | null
  clearPlayError: () => void
}

/**
 * 原生媒体元素的完整生命周期：事件绑定、续播定位、A-B/单句循环、播完暂停、
 * 不可播容器的一次性转码兜底。播放进度只写入播放历史，不再回写 media library。
 */
export function useMediaElement({ filePath, onEnded }: UseMediaElementOptions): MediaElementHandle {
  const mediaRef = useRef<HTMLVideoElement>(null)
  const [playError, setPlayError] = useState<string | null>(null)
  // 原生媒体实际进入 playing 的文件，用于让声纹与真实出声状态一致
  const [activeMediaPath, setActiveMediaPath] = useState<string | null>(null)
  // 格式兜底：内置播放器解不了的容器转成可播文件后，只替换媒体源，filePath 仍是原文件
  const [fallback, setFallback] = useState<{ file: string; path: string } | null>(null)
  const [convertingFile, setConvertingFile] = useState<string | null>(null)
  const fallbackPath = fallback && fallback.file === filePath ? fallback.path : null
  const converting = convertingFile !== null && convertingFile === filePath

  // 同一个文件只尝试转码一次，避免转码结果也播不了时反复重试
  const fallbackTriedRef = useRef<string | null>(null)
  // 转码期间丢失的播放位置，转码完成后从这里续播
  const fallbackResumeRef = useRef<{ file: string; time: number } | null>(null)
  const resumedForRef = useRef('')
  // 自动暂停：记录上一帧所在句和播放时间，用于判断是否刚刚越过句尾
  const prevSubIdxRef = useRef(-1)
  const lastTickTimeRef = useRef(0)
  // 事件处理器通过 ref 转发，避免 effect 只依赖 filePath 时读到过期状态
  const onTimeUpdateRef = useRef<() => void>(() => {})
  const onMetaRef = useRef<() => void>(() => {})
  const onEndedRef = useRef(onEnded)

  useEffect(() => {
    onEndedRef.current = onEnded
  })

  const playing = usePlayerStore((s) => s.playing)
  const playbackRate = usePlayerStore((s) => s.playbackRate)
  const volume = usePlayerStore((s) => s.volume)
  const muted = usePlayerStore((s) => s.muted)
  const seekTo = usePlayerStore((s) => s.seekTo)

  const handleTimeUpdate = () => {
    const el = mediaRef.current
    if (!el) return
    const st = usePlayerStore.getState()
    // 时长兜底同步：loadedmetadata 未触发或时长后到时，保证波形等组件能拿到 duration
    if (!st.duration && el.duration) st.setDuration(el.duration)
    st.setPlayed(el.currentTime)
    st.setPlaying(!el.paused)
    // 字幕匹配使用偏移后的时间：offset>0 表示字幕整体延后
    const t = el.currentTime - st.subtitleOffset
    const idx = findCueIndexAt(st.subtitles, t)
    if (idx !== -1) st.setCurrentSubtitleIndex(idx)

    // 播完本句自动暂停：本帧越过上一句句尾时停在边界处（循环模式优先级更高）
    const prevIdx = prevSubIdxRef.current
    const prevTick = lastTickTimeRef.current
    lastTickTimeRef.current = el.currentTime
    // 拖动进度/跳句会造成时间突跳，此时不做自动暂停判定，避免刚跳过去就被拉回
    const jumped = prevTick > 0 && Math.abs(el.currentTime - prevTick) > 1
    if (st.autoPause && !el.paused && prevIdx >= 0 && !st.loopEnd && !jumped) {
      const prevSub = st.subtitles[prevIdx]
      const boundary = prevSub ? prevSub.endTime + st.subtitleOffset : -1
      if (prevSub && prevTick < boundary && el.currentTime >= boundary) {
        el.pause()
        el.currentTime = boundary
        st.setPlayed(boundary)
        st.setPlaying(false)
        prevSubIdxRef.current = -1
        return
      }
    }
    prevSubIdxRef.current = idx
    if (st.loopEnd && el.currentTime >= st.loopEnd) {
      el.currentTime = st.loopStart || 0
    }
  }

  const handleLoadedMetadata = () => {
    const el = mediaRef.current
    if (!el) return
    const st = usePlayerStore.getState()
    st.setDuration(el.duration)
    // 转码完成后接着原来的位置播，不再走「续播上次位置」的判定
    const resume = fallbackResumeRef.current
    if (resume && resume.file === st.filePath && fallbackPath) {
      fallbackResumeRef.current = null
      el.currentTime = resume.time
      st.setPlayed(resume.time)
      if (st.playing) el.play().catch(() => {})
      return
    }
    const fp = st.filePath
    if (!fp) return
    // 收藏片段跳转：定位到片段起点并循环，优先于续播位置
    const pc = st.playClip
    if (pc && pc.filePath === fp) {
      resumedForRef.current = fp
      el.currentTime = pc.startTime
      st.setPlayed(pc.startTime)
      st.setLoop(pc.startTime, pc.endTime)
      st.setPlaying(true)
      st.setPlayClip(null)
      return
    }
    // 打开文件后续播上次位置：历史优先，媒体库里的 LastPosition 兜底
    if (resumedForRef.current === fp) return
    resumedForRef.current = fp
    const resumeKey = st.historyKey || fp
    const applyResume = (pos: number) => {
      if (!pos || pos <= 0) return
      const dur = el.duration || 0
      const remaining = dur - pos
      // 已接近结尾则从头开始，避免刚打开就立刻播完
      if (dur > 0 && (remaining < 15 || remaining / dur < 0.05)) {
        window.api.historyUpdatePosition(resumeKey, 0, dur)
        return
      }
      el.currentTime = pos
      // 立即同步 played，不等 timeupdate，避免波形/进度条停留在开头
      st.setPlayed(pos)
    }
    window.api
      .historyGet(resumeKey)
      .then((h: { position?: number } | null) =>
        h && h.position && h.position > 0 ? h.position : window.api.recentGetPosition(fp),
      )
      .then(applyResume)
      .catch(() => applyResume(0))
  }

  useEffect(() => {
    onTimeUpdateRef.current = handleTimeUpdate
    onMetaRef.current = handleLoadedMetadata
  })

  // 切换文件时重置自动暂停判据，避免沿用上一个文件的句尾与时间点
  useEffect(() => {
    prevSubIdxRef.current = -1
    lastTickTimeRef.current = 0
  }, [filePath])

  // --- Media element event wiring ---
  useEffect(() => {
    const el = mediaRef.current
    if (!el) return
    const onTime = () => onTimeUpdateRef.current()
    const onMeta = () => onMetaRef.current()
    const onPlaying = () => {
      setActiveMediaPath(usePlayerStore.getState().filePath)
      setPlayError(null)
      usePlayerStore.getState().setPlaying(true)
    }
    const onPlaybackHalted = () => setActiveMediaPath(null)
    const onEndedEvent = () => {
      setActiveMediaPath(null)
      usePlayerStore.getState().setPlaying(false)
      onEndedRef.current()
    }
    const onError = () => {
      setActiveMediaPath(null)
      const st = usePlayerStore.getState()
      const failedPath = st.filePath
      const el = mediaRef.current
      const isLocalFile =
        !!failedPath && st.sourceKind === 'html5' && !/^https?:\/\//i.test(failedPath)
      // code 4 = MEDIA_ERR_SRC_NOT_SUPPORTED，说明是容器/编码解不了，试一次转码兜底
      if (isLocalFile && el?.error?.code === 4 && fallbackTriedRef.current !== failedPath) {
        fallbackTriedRef.current = failedPath
        fallbackResumeRef.current = { file: failedPath, time: el?.currentTime ?? 0 }
        setPlayError(null)
        setConvertingFile(failedPath)
        window.api
          .transcodeForPlayback(failedPath)
          .then((out: string) => {
            if (usePlayerStore.getState().filePath !== failedPath) return
            setFallback({ file: failedPath, path: out })
            showPlayerHud('已转换为可播格式')
          })
          .catch((e: unknown) => {
            if (usePlayerStore.getState().filePath !== failedPath) return
            fallbackResumeRef.current = null
            setPlayError(e instanceof Error ? e.message : String(e))
          })
          .finally(() => setConvertingFile(null))
        return
      }
      setPlayError('媒体加载失败')
    }
    el.addEventListener('timeupdate', onTime)
    el.addEventListener('loadedmetadata', onMeta)
    el.addEventListener('playing', onPlaying)
    el.addEventListener('pause', onPlaybackHalted)
    el.addEventListener('waiting', onPlaybackHalted)
    el.addEventListener('ended', onEndedEvent)
    el.addEventListener('error', onError)
    if (el.duration) onMetaRef.current()
    if (!el.paused && el.readyState >= 3) onPlaying()
    return () => {
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('loadedmetadata', onMeta)
      el.removeEventListener('playing', onPlaying)
      el.removeEventListener('pause', onPlaybackHalted)
      el.removeEventListener('waiting', onPlaybackHalted)
      el.removeEventListener('ended', onEndedEvent)
      el.removeEventListener('error', onError)
    }
  }, [filePath])

  // 打开文件后立即请求播放，实际出声由 playing 事件驱动
  useEffect(() => {
    if (!filePath || !mediaRef.current) return
    usePlayerStore.getState().setPlaying(true)
  }, [filePath])

  // 同步播放状态与倍速
  useEffect(() => {
    const el = mediaRef.current
    if (!el) return
    if (playing) el.play().catch((e) => console.warn('play() 被拒绝:', e))
    else el.pause()
    el.playbackRate = playbackRate
  }, [playing, playbackRate])

  // 音量与静音偏好
  useEffect(() => {
    const el = mediaRef.current
    if (!el) return
    el.volume = volume
    el.muted = muted
  }, [volume, muted, filePath])

  // 消费一次性的跳转指令
  useEffect(() => {
    const el = mediaRef.current
    if (el && seekTo !== null && seekTo >= 0) {
      el.currentTime = seekTo
      usePlayerStore.getState().requestSeek(-1)
    }
  }, [seekTo])

  return {
    mediaRef,
    playError,
    converting,
    fallbackPath,
    activeMediaPath,
    clearPlayError: () => setPlayError(null),
  }
}
