import { useEffect, useRef, useState } from 'react'

/**
 * 舞台控制条的自动淡出与固定逻辑，视频舞台和音频舞台共用。
 * 指针停在控制条上时保持显示，播放中静止 2 秒后淡出。
 */
export default function useStageControls(playing: boolean) {
  const [pinned, setPinned] = useState(false)
  const [visible, setVisible] = useState(true)
  const pinnedRef = useRef(false)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }

  const showControls = () => {
    setVisible(true)
    clearTimer()
    if (!pinnedRef.current) {
      hideTimerRef.current = setTimeout(() => setVisible(false), 2000)
    }
  }

  const holdControls = () => {
    setVisible(true)
    clearTimer()
  }

  const scheduleHide = () => {
    clearTimer()
    if (!pinnedRef.current && playing) {
      hideTimerRef.current = setTimeout(() => setVisible(false), 2000)
    }
  }

  const togglePin = () => {
    const next = !pinnedRef.current
    pinnedRef.current = next
    setPinned(next)
    if (next) {
      clearTimer()
      setVisible(true)
    } else {
      showControls()
    }
  }

  useEffect(() => clearTimer, [])

  return {
    pinned,
    controlsShown: pinned || !playing || visible,
    showControls,
    holdControls,
    scheduleHide,
    togglePin,
  }
}
