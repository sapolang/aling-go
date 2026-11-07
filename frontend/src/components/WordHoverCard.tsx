import { useEffect, useState, type CSSProperties } from 'react'
import { Badge } from '@/components/ui/badge'
import { Loader2, Star } from 'lucide-react'

interface DictEntry {
  word: string
  phonetic: string
  translation: string
  definition: string
  pos: string
  tag: string
}

interface Props {
  word: string
  sentence: string
  anchor: DOMRect
  onMouseEnter: () => void
  onMouseLeave: () => void
  onAdded?: () => void
}

// ECDICT 标签码 → 中文考试标签
const TAG_LABELS: Record<string, string> = {
  zk: '中考',
  gk: '高考',
  cet4: '四级',
  cet6: '六级',
  ky: '考研',
  toefl: '托福',
  ielts: '雅思',
}

const tagLabels = (tag: string) =>
  tag
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((t) => TAG_LABELS[t.toLowerCase()] || t)

// 把 "n. 个性，人格" 拆成词性 + 释义两部分
const splitPos = (line: string) => {
  const match = line.match(/^([a-z]+\.)\s*(.*)$/i)
  return match ? { pos: match[1], text: match[2] } : { pos: '', text: line }
}

/** 悬停查词浮层：可交互，移入浮层时保持显示；点击单词仍走完整查词弹窗 */
export default function WordHoverCard({
  word,
  sentence,
  anchor,
  onMouseEnter,
  onMouseLeave,
  onAdded,
}: Props) {
  const [loading, setLoading] = useState(true)
  const [entry, setEntry] = useState<DictEntry | null>(null)
  const [exists, setExists] = useState(false)
  const [added, setAdded] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setEntry(null)
    window.api
      .dbDictLookup(word)
      .then((e: DictEntry | null) => {
        if (!cancelled) setEntry(e)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    window.api
      .dbWordsSearch(word)
      .then((res: any) => {
        const list = typeof res === 'string' ? JSON.parse(res || '[]') : res
        if (
          !cancelled &&
          Array.isArray(list) &&
          list.some((x: any) => x.word?.toLowerCase() === word.toLowerCase())
        ) {
          setExists(true)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [word])

  const handleAdd = async () => {
    if (!entry) return
    const today = new Date().toISOString().split('T')[0]
    const id = await window.api.dbWordsAdd({
      word: entry.word,
      definition: entry.translation + (entry.definition ? '\n' + entry.definition : ''),
      phonetic: entry.phonetic,
      example: sentence,
      tags: entry.tag,
      level: 1,
      next_review: today,
      repetitions: 0,
      efactor: 2.5,
      interval: 0,
    })
    if (id) {
      setAdded(true)
      onAdded?.()
    }
  }

  const width = 320
  const left = Math.min(
    Math.max(anchor.left + anchor.width / 2 - width / 2, 8),
    window.innerWidth - width - 8,
  )
  const showBelow = anchor.top < 200
  const style: CSSProperties = {
    position: 'fixed',
    left,
    width,
    zIndex: 70,
    ...(showBelow ? { top: anchor.bottom + 8 } : { bottom: window.innerHeight - anchor.top + 8 }),
  }

  const tags = entry ? tagLabels(entry.tag || '') : []
  const lines = (entry?.translation || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const marked = added || exists

  return (
    <div
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="relative rounded-lg border bg-popover text-popover-foreground shadow-lg px-4 py-3">
        <button
          className={`absolute top-2 right-2 p-1 rounded text-muted-foreground hover:bg-muted hover:text-yellow-400 disabled:cursor-not-allowed ${marked ? '' : 'disabled:opacity-40'}`}
          title={marked ? '已在生词库' : entry ? '收藏到生词库' : '词典未收录，无法收藏'}
          disabled={marked || !entry}
          onClick={handleAdd}
        >
          <Star className={`h-4 w-4 ${marked ? 'fill-current text-yellow-400' : ''}`} />
        </button>

        {loading ? (
          <div className="flex items-center justify-center py-3 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : entry ? (
          <>
            <div className="flex items-baseline gap-2 pr-7">
              <span className="text-lg font-semibold leading-tight">{entry.word}</span>
              {entry.phonetic && (
                <span className="text-xs text-muted-foreground">{entry.phonetic}</span>
              )}
            </div>

            {(tags.length > 0 || entry.pos) && (
              <div className="flex flex-wrap items-center gap-1 mt-2">
                {entry.pos && <Badge variant="outline">{entry.pos}</Badge>}
                {tags.map((t) => (
                  <Badge key={t} variant="secondary" className="text-[11px] font-normal">
                    {t}
                  </Badge>
                ))}
              </div>
            )}

            <div className="mt-2.5 space-y-1">
              {lines.map((line, i) => {
                const { pos, text } = splitPos(line)
                return (
                  <p key={i} className="text-sm leading-6">
                    {pos && <span className="text-primary font-medium mr-1.5">{pos}</span>}
                    {text}
                  </p>
                )
              })}
            </div>

            {entry.definition && (
              <p className="mt-2.5 pt-2 border-t text-xs leading-5 text-muted-foreground line-clamp-4 whitespace-pre-line">
                {entry.definition}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground py-1 pr-7">词典未收录该词</p>
        )}
      </div>
    </div>
  )
}
