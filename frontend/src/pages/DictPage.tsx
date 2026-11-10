import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDictStore, DictWord } from '@/stores/dictStore'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { BookOpen, Plus, Search, X } from 'lucide-react'

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
  const addToWordList = useDictStore((s) => s.addToWordList)
  const [progress, setProgress] = useState<Record<string, number>>({})

  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [results, setResults] = useState<DictWord[]>([])
  const [searching, setSearching] = useState(false)
  const [addedSet, setAddedSet] = useState<Set<string>>(new Set())
  const searchSeq = useRef(0)

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

  // 输入防抖 300ms
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 300)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    if (!debounced) return
    const seq = ++searchSeq.current
    window.api
      .dbDictSearch(debounced)
      .then((words: DictWord[] | null) => {
        if (searchSeq.current !== seq) return
        setResults(words || [])
        setSearching(false)
      })
      .catch(() => {
        if (searchSeq.current !== seq) return
        setResults([])
        setSearching(false)
      })
  }, [debounced])

  const handleAdd = async (word: DictWord) => {
    await addToWordList(word)
    setAddedSet((prev) => new Set(prev).add(word.word))
  }

  const isSearching = debounced.length > 0

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">词库浏览</h1>

      <div className="relative max-w-md">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-8 pr-8"
          placeholder="搜索单词..."
          value={query}
          onChange={(e) => {
            const v = e.target.value
            setQuery(v)
            if (v.trim()) {
              setSearching(true)
            } else {
              setResults([])
              setSearching(false)
            }
          }}
        />
        {query && (
          <button
            className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground"
            onClick={() => {
              setQuery('')
              setResults([])
              setSearching(false)
            }}
            aria-label="清空搜索"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {isSearching ? (
        <div className="space-y-2">
          {searching ? (
            <Card className="py-12 text-center text-muted-foreground">
              <p>搜索中...</p>
            </Card>
          ) : results.length === 0 ? (
            <Card className="py-12 text-center text-muted-foreground">
              <p>没有匹配「{debounced}」的词条</p>
            </Card>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                找到 {results.length} 条{results.length >= 50 ? '（仅显示前 50 条）' : ''}
              </p>
              {results.map((w) => (
                <Card key={w.word} className="p-3">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{w.word}</span>
                        {w.phonetic && (
                          <span className="text-xs text-muted-foreground">/{w.phonetic}/</span>
                        )}
                        {w.tag
                          .split(' ')
                          .filter(Boolean)
                          .map((t) => (
                            <Badge key={t} variant="secondary" className="text-xs">
                              {tagLabels[t] || t}
                            </Badge>
                          ))}
                      </div>
                      <p className="text-sm text-muted-foreground truncate">{w.translation}</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => handleAdd(w)}
                      disabled={addedSet.has(w.word)}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      {addedSet.has(w.word) ? '已入库' : '加入生词本'}
                    </Button>
                  </div>
                </Card>
              ))}
            </>
          )}
        </div>
      ) : (
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
                  <div className="font-semibold">
                    {tagLabels[book.tag] || book.tag.toUpperCase()}
                  </div>
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
      )}
    </div>
  )
}
