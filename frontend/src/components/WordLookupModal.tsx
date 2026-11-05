import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { BookmarkPlus, Volume2, Check, Loader2 } from 'lucide-react'
import { speak } from '@/lib/tts'

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
  onClose: () => void
}

export default function WordLookupModal({ word, sentence, onClose }: Props) {
  const [loading, setLoading] = useState(true)
  const [entry, setEntry] = useState<DictEntry | null>(null)
  const [exists, setExists] = useState(false)
  const [manualDef, setManualDef] = useState('')
  const [manualPhonetic, setManualPhonetic] = useState('')
  const [added, setAdded] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
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
    const today = new Date().toISOString().split('T')[0]
    const definition = entry
      ? entry.translation + (entry.definition ? '\n' + entry.definition : '')
      : manualDef
    const id = await window.api.dbWordsAdd({
      word: entry?.word || word,
      definition,
      phonetic: entry?.phonetic || manualPhonetic,
      example: sentence,
      tags: entry?.tag || '',
      level: 1,
      next_review: today,
      repetitions: 0,
      efactor: 2.5,
      interval: 0,
    })
    if (id) setAdded(true)
  }

  const tags = entry?.tag?.split(/\s+/).filter(Boolean) || []

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <Card className="w-96 p-5 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-xl font-semibold">{entry?.word || word}</h3>
              <button
                className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-primary"
                title="发音"
                onClick={() => speak(entry?.word || word)}
              >
                <Volume2 className="h-4 w-4" />
              </button>
              {exists && !added && (
                <Badge variant="secondary" className="ml-auto text-xs">
                  已在生词库
                </Badge>
              )}
            </div>
            {(entry?.phonetic || !entry) && (
              <p className="text-sm text-muted-foreground mb-2">{entry?.phonetic || ''}</p>
            )}
            {entry ? (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1">
                  {entry.pos && <Badge variant="outline">{entry.pos}</Badge>}
                  {tags.map((t) => (
                    <Badge key={t} variant="secondary">
                      {t}
                    </Badge>
                  ))}
                </div>
                {entry.translation && (
                  <p className="text-sm whitespace-pre-line">{entry.translation}</p>
                )}
                {entry.definition && (
                  <p className="text-xs text-muted-foreground whitespace-pre-line max-h-32 overflow-y-auto">
                    {entry.definition}
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">词典未收录该词，可手动补充释义</p>
                <div>
                  <label className="text-sm font-medium">释义</label>
                  <Input
                    value={manualDef}
                    onChange={(e) => setManualDef(e.target.value)}
                    placeholder="输入释义"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">音标</label>
                  <Input
                    value={manualPhonetic}
                    onChange={(e) => setManualPhonetic(e.target.value)}
                    placeholder="/ˈeksəmpəl/"
                  />
                </div>
              </div>
            )}
            {sentence && (
              <p className="text-xs text-muted-foreground mt-3 border-l-2 pl-2 line-clamp-3">
                {sentence}
              </p>
            )}
            <div className="flex gap-2 justify-end mt-4">
              <Button variant="outline" size="sm" onClick={onClose}>
                关闭
              </Button>
              {added ? (
                <Button size="sm" disabled>
                  <Check className="h-4 w-4 mr-1" /> 已加入
                </Button>
              ) : (
                <Button size="sm" onClick={handleAdd} disabled={exists}>
                  <BookmarkPlus className="h-4 w-4 mr-1" /> 加入生词库
                </Button>
              )}
            </div>
          </>
        )}
      </Card>
    </div>
  )
}
