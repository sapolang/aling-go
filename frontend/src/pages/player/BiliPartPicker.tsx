import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ListVideo } from 'lucide-react'
import type { BiliPartItem } from '@/stores/playerStore'
import { formatClockTime } from '@/lib/subtitles'

interface Props {
  parts: BiliPartItem[]
  currentCID: number
  loading: boolean
  onSelect: (part: BiliPartItem) => void
}

// B站多 P 视频的分 P 选择器：顶栏显示当前 P，点开列出全部分 P。
// 单 P 或没有分 P 信息时调用方不渲染该组件。
export default function BiliPartPicker({ parts, currentCID, loading, onSelect }: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const current = parts.find((p) => p.cid === currentCID) || parts[0]

  return (
    <div className="pp-part-picker" ref={rootRef}>
      <button
        type="button"
        className="pp-ghost-btn"
        onClick={() => setOpen((v) => !v)}
        disabled={loading}
        title="切换分 P"
        aria-expanded={open}
      >
        <ListVideo />
        <span>
          P{current?.page || 1} / {parts.length}
        </span>
        <ChevronDown className="pp-part-chevron" />
      </button>
      {open && (
        <div className="pp-part-menu" role="menu">
          <div className="pp-part-menu-title">分 P 列表</div>
          {parts.map((part) => {
            const active = part.cid === currentCID
            return (
              <button
                type="button"
                role="menuitem"
                key={part.cid}
                className={`pp-part-item${active ? ' pp-part-item--active' : ''}`}
                onClick={() => {
                  setOpen(false)
                  if (!active) onSelect(part)
                }}
              >
                <span className="pp-part-index">{part.page}</span>
                <span className="pp-part-name" title={part.title}>
                  {part.title || `P${part.page}`}
                </span>
                <span className="pp-part-dur">
                  {part.duration > 0 ? formatClockTime(part.duration) : ''}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
