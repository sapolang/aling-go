import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDictStore } from '@/stores/dictStore'
import { BookOpen } from 'lucide-react'

const tagLabels: Record<string, string> = {
  zk: '中考',
  gk: '高考',
  cet4: 'CET-4',
  cet6: 'CET-6',
  ky: '考研',
  toefl: 'TOEFL',
  ielts: 'IELTS',
  gre: 'GRE',
}

export default function DictPage() {
  const navigate = useNavigate()
  const books = useDictStore((s) => s.books)
  const loadBooks = useDictStore((s) => s.loadBooks)
  const [progress, setProgress] = useState<Record<string, number>>({})

  useEffect(() => {
    loadBooks()
  }, [loadBooks])

  useEffect(() => {
    if (books.length === 0) return
    let cancelled = false
    Promise.all(
      books.map(async (book) => [book.tag, await window.api.dbDictGetProgress(book.tag)] as const),
    )
      .then((entries) => {
        if (!cancelled) setProgress(Object.fromEntries(entries))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [books])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">词库浏览</h1>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {books.map((book) => {
          const learned = progress[book.tag] || 0
          const pct = book.count > 0 ? Math.min(100, (learned / book.count) * 100) : 0
          return (
            <button
              key={book.tag}
              onClick={() => navigate(`/dict/${book.tag}`)}
              className="flex flex-col items-center gap-3 p-6 rounded-xl border bg-card hover:bg-accent hover:border-primary/50 transition-colors cursor-pointer"
            >
              <BookOpen className="h-8 w-8 text-primary" />
              <div className="w-full text-center space-y-1">
                <div className="font-semibold">{tagLabels[book.tag] || book.tag.toUpperCase()}</div>
                {learned > 0 ? (
                  <>
                    <div className="text-sm text-muted-foreground">
                      上次学到 {Math.min(learned, book.count)} / {book.count}
                    </div>
                    <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground">{book.count} 词</div>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
