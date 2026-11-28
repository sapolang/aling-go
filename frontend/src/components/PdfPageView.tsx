import { useEffect, useMemo, useRef, useState } from 'react'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import type { PdfSentencePart, PdfSentenceSpan, PdfTextItem, PdfTextRect } from '@/lib/pdfReader'

interface PdfPageViewProps {
  pdf: PDFDocumentProxy
  pageNumber: number
  scale: number
  sentences: PdfSentenceSpan[]
  items: PdfTextItem[]
  activeSentenceIndex: number
  onSentenceClick: (sentence: PdfSentenceSpan) => void
}

interface ScreenRect {
  x: number
  y: number
  width: number
  height: number
}

/** 只保留当前句在文本块内覆盖的水平范围。 */
function sentencePartRect(item: PdfTextItem, part: PdfSentencePart): PdfTextRect {
  if (part.start === 0 && part.end === item.text.length) return item.rect
  return {
    ...item.rect,
    x: item.rect.x + (item.rect.width * part.start) / item.text.length,
    width: (item.rect.width * (part.end - part.start)) / item.text.length,
  }
}

/** 同一行的相邻文本片段合并，得到接近 Edge 的整句高亮块。 */
function mergeRects(rects: PdfTextRect[], scale: number): ScreenRect[] {
  const scaled = rects
    .map((r) => ({
      x: r.x * scale,
      y: r.y * scale,
      width: r.width * scale,
      height: r.height * scale,
    }))
    .sort((a, b) => a.y - b.y || a.x - b.x)
  const merged: ScreenRect[] = []
  for (const rect of scaled) {
    const last = merged[merged.length - 1]
    if (
      last &&
      Math.abs(last.y - rect.y) < Math.max(3, rect.height * 0.35) &&
      rect.x <= last.x + last.width + 10
    ) {
      const right = Math.max(last.x + last.width, rect.x + rect.width)
      last.width = right - last.x
      last.height = Math.max(last.height, rect.height)
    } else {
      merged.push({ ...rect })
    }
  }
  return merged
}

export function PdfPageView({
  pdf,
  pageNumber,
  scale,
  sentences,
  items,
  activeSentenceIndex,
  onSentenceClick,
}: PdfPageViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [page, setPage] = useState<PDFPageProxy | null>(null)
  const [visible, setVisible] = useState(false)
  const [rendered, setRendered] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    void pdf.getPage(pageNumber).then((loaded) => {
      if (!cancelled) setPage(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [pdf, pageNumber])

  // 尺寸随 page/scale 直接派生，缩放时渲染 effect 会用新 scale 重画 canvas 与高亮。
  const size = useMemo(() => {
    if (!page) return { width: 0, height: 0 }
    const base = page.getViewport({ scale: 1 })
    return { width: base.width * scale, height: base.height * scale }
  }, [page, scale])

  // 只渲染进入视口附近的页面，长文档不会一次性占满内存。
  useEffect(() => {
    const element = containerRef.current
    if (!element || size.width === 0) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '800px 0px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [size.width])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!visible || !canvas || !page) return
    let cancelled = false
    setRendered(false)
    setError('')
    const viewport = page.getViewport({ scale })
    const context = canvas.getContext('2d')
    if (!context) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.floor(viewport.width * dpr)
    canvas.height = Math.floor(viewport.height * dpr)
    canvas.style.width = `${viewport.width}px`
    canvas.style.height = `${viewport.height}px`
    const task = page.render({
      canvas,
      viewport,
      transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
    })
    void task.promise
      .then(() => {
        if (!cancelled) setRendered(true)
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        console.error('PDF page render failed', err)
        if (!cancelled) setError(`这一页渲染失败：${message}`)
      })
    return () => {
      cancelled = true
      task.cancel()
    }
  }, [visible, scale, page])

  return (
    <div
      ref={containerRef}
      className="pdf-page"
      style={{ width: size.width || '100%', height: size.height || 400 }}
      data-page={pageNumber}
    >
      <canvas ref={canvasRef} className="pdf-page-canvas" />
      {error && <p className="pdf-page-error">{error}</p>}
      {rendered && (
        <div className="pdf-page-highlights">
          {sentences.map((sentence) => {
            const rects = mergeRects(
              sentence.parts
                .map((part) => {
                  const item = items[part.itemIndex]
                  return item && item.page === pageNumber ? sentencePartRect(item, part) : null
                })
                .filter((rect): rect is PdfTextRect => !!rect),
              scale,
            )
            return rects.map((rect, rectIndex) => (
              <button
                type="button"
                key={`${sentence.index}-${rectIndex}`}
                className={`pdf-page-highlight ${
                  sentence.index === activeSentenceIndex ? 'is-active' : ''
                }`}
                style={{
                  left: rect.x,
                  top: rect.y,
                  width: rect.width,
                  height: rect.height,
                }}
                title={`朗读第 ${sentence.paragraph} 段的这一句`}
                onClick={() => onSentenceClick(sentence)}
              />
            ))
          })}
        </div>
      )}
      <span className="pdf-page-number">{pageNumber}</span>
    </div>
  )
}
