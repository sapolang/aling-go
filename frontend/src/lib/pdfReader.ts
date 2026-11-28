import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { ReadAloudParagraph } from '@/hooks/usePdfReadAloud'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

/** 页面坐标矩形，基于 scale=1 的 viewport，渲染时再乘缩放系数。 */
export interface PdfTextRect {
  x: number
  y: number
  width: number
  height: number
}

export interface PdfTextItem {
  text: string
  page: number
  rect: PdfTextRect
}

export interface PdfSentencePart {
  itemIndex: number
  /** 在对应 PdfTextItem.text 内的字符范围，end 不含 */
  start: number
  end: number
}

/** 一句在原 PDF 中的位置，parts 指向 items 内的字符范围，用于画高亮。 */
export interface PdfSentenceSpan {
  index: number
  page: number
  paragraph: number
  text: string
  parts: PdfSentencePart[]
}

export interface PdfReadParagraph extends ReadAloudParagraph {
  /** 该段首句在整个文档中的下标，用于把段内句号换算成全局句号 */
  firstSentence: number
}

export interface PdfDocumentData {
  pdf: pdfjsLib.PDFDocumentProxy
  /** 释放 pdf.js worker 与页面资源 */
  dispose: () => Promise<void>
  pageCount: number
  paragraphs: PdfReadParagraph[]
  sentences: PdfSentenceSpan[]
  items: PdfTextItem[]
}

/** TextItem 未从 pdfjs-dist 主入口导出，这里只声明用到的字段。 */
interface JsTextItem {
  str: string
  width: number
  transform: number[]
  hasEOL?: boolean
}

// 常见缩写：缩写后的点不是句末标点
const ABBREVIATIONS = new Set([
  'Mr',
  'Mrs',
  'Ms',
  'Dr',
  'Prof',
  'Sr',
  'Jr',
  'St',
  'vs',
  'etc',
  'e.g',
  'i.e',
  'U.S',
  'U.K',
  'a.m',
  'p.m',
  'No',
  'Fig',
  'Inc',
  'Ltd',
])

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** 把 pdf.js 的文本项变换矩阵换算成页面左上原点、scale=1 下的矩形。 */
function textItemRect(
  viewport: pdfjsLib.PageViewport,
  transform: number[],
  width: number,
): PdfTextRect {
  const tx = pdfjsLib.Util.transform(viewport.transform, transform)
  const pdfFontSize = Math.hypot(transform[2], transform[3]) || 1
  const scaleX = Math.hypot(tx[0], tx[1]) / pdfFontSize
  const height = Math.max(6, Math.hypot(tx[2], tx[3]) * 1.25)
  return {
    x: tx[4],
    y: tx[5] - height * 0.88,
    width: Math.max(1, width * scaleX),
    height,
  }
}

/** 找出句末标点的结束位置（含收尾引号/括号），跳过缩写、小数和省略号。 */
function findSentenceEnds(text: string): number[] {
  const ends: number[] = []
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch !== '.' && ch !== '?' && ch !== '!') continue
    if (ch === '.') {
      if (text[i + 1] === '.') continue
      if (/\d/.test(text[i - 1] ?? '') && /\d/.test(text[i + 1] ?? '')) continue
      const prefix = text.slice(Math.max(0, i - 12), i + 1)
      const word = prefix.match(/([A-Za-z]+(?:\.[A-Za-z]+)*\.)$/)?.[1]?.slice(0, -1)
      if (word && ABBREVIATIONS.has(word)) continue
    }
    let end = i + 1
    while (end < text.length && /["')\]]/.test(text[end])) end++
    if (end === text.length || /\s/.test(text[end])) ends.push(end)
  }
  return ends
}

/** 把一段文本切成连续的句范围。 */
function sentenceRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  let start = 0
  for (const end of findSentenceEnds(text)) {
    if (end > start) ranges.push({ start, end })
    start = end
  }
  if (start < text.length) ranges.push({ start, end: text.length })
  return ranges
}

interface PageText {
  text: string
  /** 与 text 等长；分隔符位置为 -1，其余是该字符所属 item 的全局索引 */
  charItems: number[]
  /** 与 text 等长；分隔符位置为 -1，其余是该字符在所属 item 内的下标 */
  charOffsets: number[]
}

/** 把一页的文本项拼成可切句的文本，同时记录每个字符来自哪个 item。 */
function collectPageText(
  items: JsTextItem[],
  startItemIndex: number,
  page: number,
  viewport: pdfjsLib.PageViewport,
  out: PdfTextItem[],
): PageText {
  let text = ''
  const charItems: number[] = []
  const charOffsets: number[] = []
  let lastBaseline: number | null = null
  let lastSize = 1
  let lastHadEOL = false

  items.forEach((item, localIndex) => {
    const baseline = item.transform[5]
    const size = Math.hypot(item.transform[2], item.transform[3]) || 1
    if (lastBaseline !== null) {
      const gap = lastBaseline - baseline
      if (gap > lastSize * 1.75) {
        text += '\n\n'
        charItems.push(-1, -1)
        charOffsets.push(-1, -1)
      } else if (lastHadEOL || gap > lastSize * 0.6) {
        text += '\n'
        charItems.push(-1)
        charOffsets.push(-1)
      } else {
        text += ' '
        charItems.push(-1)
        charOffsets.push(-1)
      }
    }
    const globalIndex = startItemIndex + localIndex
    out.push({
      text: item.str,
      page,
      rect: textItemRect(viewport, item.transform, item.width),
    })
    text += item.str
    for (let offset = 0; offset < item.str.length; offset++) {
      charItems.push(globalIndex)
      charOffsets.push(offset)
    }
    lastBaseline = baseline
    lastSize = size
    lastHadEOL = !!item.hasEOL
  })

  return { text, charItems, charOffsets }
}

/**
 * 加载原 PDF 并建立朗读段落与句子高亮映射。
 * 文本完全来自 pdf.js，保证高亮框与页面上的文字逐字对应。
 */
export async function loadPdfDocument(base64: string): Promise<PdfDocumentData> {
  const bytes = decodeBase64(base64)
  const loadingTask = pdfjsLib.getDocument({ data: bytes })
  const pdf = await loadingTask.promise

  const items: PdfTextItem[] = []
  const sentences: PdfSentenceSpan[] = []
  const paragraphs: PdfReadParagraph[] = []

  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const page = await pdf.getPage(pageNo)
    const viewport = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    const textItems: JsTextItem[] = []
    for (const item of content.items) {
      if ('str' in item && typeof item.str === 'string' && item.str.trim()) {
        textItems.push(item as JsTextItem)
      }
    }
    const startItemIndex = items.length

    const { text, charItems, charOffsets } = collectPageText(
      textItems,
      startItemIndex,
      pageNo,
      viewport,
      items,
    )

    // 段落之间用双换行分隔；段内换行在朗读文本里压成空格。
    let segmentStart = 0
    while (segmentStart <= text.length) {
      const separator = text.indexOf('\n\n', segmentStart)
      const segmentEnd = separator < 0 ? text.length : separator
      const raw = text.slice(segmentStart, segmentEnd)
      const normalized = raw.trim()

      if (normalized) {
        const leading = raw.length - raw.trimStart().length
        const pieceTexts: string[] = []
        const paragraphNo = paragraphs.length + 1
        const firstSentence = sentences.length

        for (const range of sentenceRanges(normalized)) {
          const part = normalized.slice(range.start, range.end)
          const piece = part.trim()
          if (!piece) continue
          const lead = part.length - part.trimStart().length
          const from = segmentStart + leading + range.start + lead
          const to = from + piece.length
          const used = new Map<number, PdfSentencePart>()
          for (let k = from; k < to && k < charItems.length; k++) {
            const itemIndex = charItems[k]
            const offset = charOffsets[k]
            if (itemIndex < 0 || offset < 0) continue
            const existing = used.get(itemIndex)
            if (existing) existing.end = offset + 1
            else used.set(itemIndex, { itemIndex, start: offset, end: offset + 1 })
          }
          sentences.push({
            index: sentences.length,
            page: pageNo,
            paragraph: paragraphNo,
            text: piece,
            parts: [...used.values()],
          })
          pieceTexts.push(piece)
        }

        if (pieceTexts.length > 0) {
          const joined = pieceTexts.map((piece, i) =>
            i === pieceTexts.length - 1 ? piece : `${piece} `,
          )
          let cursor = 0
          const ends = joined.map((part) => (cursor += part.length))
          paragraphs.push({
            number: paragraphNo,
            page: pageNo,
            sentences: pieceTexts,
            text: joined.join(''),
            ends,
            firstSentence,
          })
        }
      }
      if (separator < 0) break
      segmentStart = separator + 2
    }
  }

  return {
    pdf,
    dispose: () => loadingTask.destroy(),
    pageCount: pdf.numPages,
    paragraphs,
    sentences,
    items,
  }
}
