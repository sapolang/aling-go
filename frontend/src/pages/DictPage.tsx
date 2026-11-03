import { useEffect } from 'react'
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

  useEffect(() => {
    loadBooks()
  }, [loadBooks])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">单词书</h1>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {books.map((book) => (
          <button
            key={book.tag}
            onClick={() => navigate(`/dict/${book.tag}`)}
            className="flex flex-col items-center gap-3 p-6 rounded-xl border bg-card hover:bg-accent hover:border-primary/50 transition-colors cursor-pointer"
          >
            <BookOpen className="h-8 w-8 text-primary" />
            <div className="text-center">
              <div className="font-semibold">{tagLabels[book.tag] || book.tag.toUpperCase()}</div>
              <div className="text-sm text-muted-foreground">{book.count} 词</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}