import { useRef, useEffect, useCallback, useState } from 'react'

interface SubtitleSegment {
  startTime: number
  endTime: number
}

interface WaveformProps {
  data: number[]
  duration: number
  currentTime: number
  subtitles?: SubtitleSegment[]
  loading?: boolean
  onSeek: (time: number) => void
}

export default function Waveform({ data, duration, currentTime, subtitles, loading, onSeek }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const offsetRef = useRef(0)
  const dragStartRef = useRef<{ x: number; offset: number }>({ x: 0, offset: 0 })
  const [viewOffset, setViewOffset] = useState(0)
  const [containerWidth, setContainerWidth] = useState(0)

  const barW = 3
  const gapPx = 3
  const pxPerSample = barW + gapPx
  const zoom = containerWidth > 0 ? Math.round(containerWidth / pxPerSample) : 200

  const minOffset = -zoom
  const maxOffset = data.length
  offsetRef.current = viewOffset

  const sampleIndex = duration > 0
    ? Math.round((currentTime / duration) * data.length)
    : 0

  useEffect(() => {
    if (draggingRef.current) return
    setViewOffset(Math.max(minOffset, Math.min(maxOffset, sampleIndex - zoom)))
  }, [sampleIndex, minOffset, maxOffset, zoom])

  const clampedOffset = Math.max(minOffset, Math.min(maxOffset, viewOffset))
  const centerSample = clampedOffset + zoom

  const drawBars = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    const logicalW = rect.width
    const logicalH = rect.height
    canvas.width = logicalW * dpr
    canvas.height = logicalH * dpr
    ctx.scale(dpr, dpr)

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, logicalW, logicalH)

    if (!data || data.length === 0) return

    const pxPerSampleLocal = logicalW / zoom
    const gap = (pxPerSampleLocal / pxPerSample) * gapPx
    const barW2 = pxPerSampleLocal - gap
    const radius = Math.min(barW2 / 2, 2)
    const midY = logicalH / 2
    const maxBarH = midY - 4
    const centerX = logicalW / 2

    if (subtitles && subtitles.length > 0) {
      for (const sub of subtitles) {
        const startSample = (sub.startTime / duration) * data.length
        const endSample = (sub.endTime / duration) * data.length
        const x1 = centerX + (startSample - centerSample) * pxPerSample - 2
        const x2 = centerX + (endSample - centerSample) * pxPerSample + 2
        if (x2 < 0 || x1 > logicalW) continue
        const boxX = Math.max(0, x1)
        const boxW = Math.min(logicalW, x2) - boxX

        ctx.fillStyle = 'rgba(0, 0, 0, 0.03)'
        ctx.fillRect(boxX, 0, boxW, logicalH)

        ctx.strokeStyle = 'rgba(156, 163, 175, 0.4)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(boxX + 0.5, 0)
        ctx.lineTo(boxX + 0.5, logicalH)
        ctx.stroke()
      }
    }

    ctx.fillStyle = '#22c55e'

    for (let i = 0; i < data.length; i++) {
      const x = centerX + (i - centerSample) * pxPerSample + gap / 2
      if (x + barW2 < 0 || x > logicalW) continue
      const barH = data[i] * maxBarH
      if (barH < 1) continue

      roundRect(ctx, x, midY - barH, barW2, barH, radius)
      ctx.fill()

      roundRect(ctx, x, midY, barW2, barH, radius)
      ctx.fill()
    }
  }, [data, clampedOffset, centerSample, duration, subtitles, zoom, pxPerSample, gapPx])

  useEffect(() => { drawBars() }, [drawBars])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const updateWidth = () => {
      setContainerWidth(el.getBoundingClientRect().width)
      drawBars()
    }
    updateWidth()
    const ro = new ResizeObserver(updateWidth)
    ro.observe(el)
    return () => ro.disconnect()
  }, [drawBars])

  const handleMouseDown = (e: React.MouseEvent) => {
    draggingRef.current = true
    const startClientX = e.clientX
    const startOffset = clampedOffset
    dragStartRef.current = { x: startClientX, offset: startOffset }

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - dragStartRef.current.x
      const el = containerRef.current
      if (!el) return
      const pxPerSample = el.getBoundingClientRect().width / zoom
      setViewOffset(Math.max(minOffset, Math.min(maxOffset, startOffset - dx / pxPerSample)))
    }
    const onUp = () => {
      draggingRef.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      const cs = Math.max(minOffset, Math.min(maxOffset, offsetRef.current)) + zoom
      const newOffset = cs - zoom
      setViewOffset(newOffset)
      if (duration <= 0) return
      const time = (cs / data.length) * duration
      onSeek(Math.max(0, Math.min(duration, time)))
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  useEffect(() => {
    const onUp = () => { draggingRef.current = false }
    document.addEventListener('mouseup', onUp)
    return () => document.removeEventListener('mouseup', onUp)
  }, [])

  if (loading) {
    return (
      <div className="w-full h-full bg-white rounded flex items-center justify-center">
        <div className="h-2 bg-gray-200 rounded w-3/4 animate-pulse" />
      </div>
    )
  }

  if (!data || data.length === 0) return null

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative bg-white rounded overflow-hidden cursor-grab active:cursor-grabbing select-none"
      onMouseDown={handleMouseDown}
    >
      <canvas ref={canvasRef} className="w-full h-full block" />

      <div className="absolute top-0 bottom-0 left-1/2 z-10 pointer-events-none flex flex-col items-center">
        <div className="w-2 h-2 bg-gray-700 rounded-full shrink-0" />
        <div className="w-[2px] flex-1 bg-gray-700" />
      </div>
    </div>
  )
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}
