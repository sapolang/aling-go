import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useArticleStore } from '@/stores/articleStore'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Speaker, ArrowLeft, Pencil, Eye, Check } from 'lucide-react'

const CDN_BASE = 'https://files.typewords.cc'

const AUTO_SKIP_CHARS = new Set([
  '\n', ' ', '.', ',', '!', '?', ';', ':', '"', '(', ')', '[', ']', '{', '}',
  '—', '–', '…',
])

function isAutoSkipChar(char: string): boolean {
  return AUTO_SKIP_CHARS.has(char)
}

type Mode = 'follow' | 'dictation'

interface CharState {
  char: string
  status: 'pending' | 'current' | 'correct' | 'wrong'
}

export default function ArticleTypingPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const {
    currentArticle, typingProgress,
    loadArticle, loadTypingProgress, saveTypingProgress, saveTypingRecord,
  } = useArticleStore()

  const [mode, setMode] = useState<Mode>('follow')
  const [typed, setTyped] = useState('')
  const [started, setStarted] = useState(false)
  const [startTime, setStartTime] = useState(0)
  const [finished, setFinished] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [showHint, setShowHint] = useState(false)
  const [hintWord, setHintWord] = useState('')
  const [showResult, setShowResult] = useState(false)
  const [dictationResults, setDictationResults] = useState<{ word: string; typed: string; correct: boolean }[]>([])
  const audioRef = useRef<HTMLAudioElement>(null)
  const hideHintTimer = useRef<ReturnType<typeof setTimeout>>()

  const articleId = Number(id)

  useEffect(() => {
    loadArticle(articleId)
  }, [articleId])

  useEffect(() => {
    if (currentArticle) {
      loadTypingProgress(articleId, mode)
    }
  }, [currentArticle, mode, articleId])

  useEffect(() => {
    if (typingProgress && typingProgress.position > 0 && !started
      && typingProgress.articleId === articleId && typingProgress.mode === mode) {
      setTyped(currentArticle?.text.slice(0, typingProgress.position) || '')
    }
  }, [typingProgress, currentArticle, articleId, mode])

  useEffect(() => {
    if (!started || finished) return
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [started, startTime, finished])

  const text = currentArticle?.text || ''
  const totalChars = text.length
  const typedChars = typed.length

  const charStates: CharState[] = useMemo(() => {
    return text.split('').map((char, i) => {
      if (i < typed.length) {
        const isCorrect = typed[i] === char
        return { char, status: isCorrect ? 'correct' : 'wrong' }
      }
      if (i === typed.length) return { char, status: 'current' }
      return { char, status: 'pending' }
    })
  }, [text, typed])

  const correctCount = useMemo(() => {
    let count = 0
    for (let i = 0; i < typed.length; i++) {
      if (typed[i] === text[i]) count++
    }
    return count
  }, [typed, text])

  const accuracy = typed.length > 0 ? correctCount / typed.length : 1
  const wpm = elapsed > 0 ? Math.round((typedChars / 5) / (elapsed / 60)) : 0

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (finished || showResult) return

    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
      if (!started) {
        setStarted(true)
        setStartTime(Date.now())
      }
      if (typed.length < text.length) {
        if (mode === 'follow') {
          setTyped(prev => {
            let newTyped = prev
            while (newTyped.length < text.length && isAutoSkipChar(text[newTyped.length])) {
              newTyped += text[newTyped.length]
            }
            if (newTyped.length < text.length) {
              newTyped += e.key
            }
            while (newTyped.length < text.length && isAutoSkipChar(text[newTyped.length])) {
              newTyped += text[newTyped.length]
            }
            if (newTyped.length >= text.length) {
              setFinished(true)
              setShowResult(true)
            }
            return newTyped
          })
        } else {
          setTyped(prev => prev + e.key)
          if (typed.length + 1 >= text.length) {
            setFinished(true)
            setShowResult(true)
          }
        }
      }
      return
    }

    if (e.key === 'Backspace') {
      e.preventDefault()
      setTyped(prev => prev.slice(0, -1))
      return
    }

    if (e.key === 'Tab' && mode === 'dictation') {
      e.preventDefault()
      const remaining = text.slice(typed.length)
      const nextWord = remaining.match(/^\S+/)?.[0] || ''
      setHintWord(nextWord)
      setShowHint(true)
      clearTimeout(hideHintTimer.current)
      hideHintTimer.current = setTimeout(() => setShowHint(false), 3000)
      return
    }
  }, [finished, showResult, started, text, typed, mode])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  useEffect(() => {
    return () => clearTimeout(hideHintTimer.current)
  }, [])

  const progress = totalChars > 0 ? (typedChars / totalChars) * 100 : 0

  const getAudioURL = () => {
    if (!currentArticle?.audioSrc) return ''
    return CDN_BASE + currentArticle.audioSrc
  }

  const handleRestart = () => {
    setTyped('')
    setStarted(false)
    setFinished(false)
    setElapsed(0)
    setShowResult(false)
    setDictationResults([])
  }

  const handleComplete = async () => {
    const mistakeWords: { word: string; typed: string; position: number }[] = []
    const words = text.split(/\s+/)
    let pos = 0
    for (const word of words) {
      const endPos = pos + word.length
      const typedSegment = typed.slice(pos, endPos)
      if (typedSegment.toLowerCase() !== word.toLowerCase() && typedSegment.length > 0) {
        mistakeWords.push({ word, typed: typedSegment, position: pos })
      }
      pos = endPos + 1
    }

    const record = {
      articleId,
      mode,
      accuracy,
      wpm,
      duration: elapsed,
      mistakes: JSON.stringify(mistakeWords),
    }
    await saveTypingRecord(record)

    const currentBestAccuracy = typingProgress?.bestAccuracy || 0
    const currentBestWpm = typingProgress?.bestWpm || 0
    await saveTypingProgress({
      articleId,
      mode,
      position: typedChars,
      completed: true,
      bestAccuracy: Math.max(accuracy, currentBestAccuracy),
      bestWpm: Math.max(wpm, currentBestWpm),
    })
  }

  // Auto-save on finish
  useEffect(() => {
    if (finished) {
      handleComplete()
    }
  }, [finished])

  // Save current position on unmount (using refs to avoid stale closure)
  const saveOnUnmountRef = useRef(() => {})
  saveOnUnmountRef.current = () => {
    if (started && !finished && typed.length > 0) {
      saveTypingProgress({
        articleId,
        mode,
        position: typed.length,
        completed: false,
        bestAccuracy: typingProgress?.bestAccuracy || accuracy,
        bestWpm: typingProgress?.bestWpm || wpm,
      })
    }
  }

  useEffect(() => {
    return () => saveOnUnmountRef.current()
  }, [])

  // Render character display for follow mode
  const renderFollowText = () => (
    <div className="font-mono text-xl leading-relaxed whitespace-pre-wrap break-words select-none"
      style={{ letterSpacing: '0.05em' }}>
      {charStates.map((cs, i) => (
        <span
          key={i}
          className={
            cs.status === 'correct' ? 'text-green-600 dark:text-green-400' :
            cs.status === 'wrong' ? 'bg-red-200 dark:bg-red-800 text-red-800 dark:text-red-200 rounded' :
            cs.status === 'current' ? 'border-b-2 border-blue-500 text-muted-foreground' :
            'text-muted-foreground'
          }
        >
          {cs.char === '\n' ? '↵\n' : cs.char === ' ' && cs.status === 'current' ? '␣' : cs.char}
        </span>
      ))}
    </div>
  )

  // Render dictation mode: typed words with reveal
  const renderDictationText = () => {
    const originalWords = text.split(/(\s+)/)
    let typedPos = 0
    const typedWords = typed.split(/(\s+)/)

    return (
      <div className="font-mono text-xl leading-relaxed whitespace-pre-wrap break-words select-none">
        {/* Show already typed words */}
        {typedWords.map((tw, i) => {
          typedPos += tw.length
          const ow = originalWords[i]
          const isSpace = /^\s+$/.test(tw)
          if (isSpace) return <span key={i}>{tw}</span>
          if (!ow) return <span key={i} className="text-muted-foreground">{tw}</span>
          const matched = ow.toLowerCase() === tw.toLowerCase()
          return (
            <span key={i} className={matched ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}>
              {matched ? tw : <span className="line-through mr-1">{tw}</span>}
              {!matched && <span className="text-green-600 text-xs align-super">{ow}</span>}
            </span>
          )
        })}
        {/* Show cursor for remaining */}
        {typed.length < text.length && (
          <span className="border-b-2 border-blue-500 animate-pulse">&nbsp;</span>
        )}
        {/* Show remaining as hidden */}
        {mode === 'dictation' && (
          <span className="text-muted-foreground/20">
            {'█'.repeat(Math.min(50, text.length - typed.length))}
          </span>
        )}
      </div>
    )
  }

  const mistakesFromErrors = (() => {
    const words = text.split(/\s+/)
    const typedWords = typed.split(/\s+/)
    const result: { word: string; typed: string }[] = []
    for (let i = 0; i < Math.min(words.length, typedWords.length); i++) {
      if (words[i].toLowerCase() !== typedWords[i].toLowerCase()) {
        result.push({ word: words[i], typed: typedWords[i] })
      }
    }
    return result
  })()

  const handleAddMistakesToWords = async () => {
    const uniqueWords = [...new Set(mistakesFromErrors.map(m => m.word))]
    const wordsToAdd = uniqueWords.map(word => ({
      word,
      definition: '',
      phonetic: '',
    }))
    const count = await window.api.addWordsBatch(JSON.stringify(wordsToAdd))
    alert(`已添加 ${count} 个生词`)
  }

  if (!currentArticle) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        加载中...
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 pt-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/articles')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h2 className="font-semibold">{currentArticle.title}</h2>
          <p className="text-sm text-muted-foreground">{currentArticle.titleTranslate}</p>
        </div>
        <div className="flex gap-1 bg-muted rounded-lg p-0.5">
          <button
            onClick={() => { setMode('follow'); handleRestart() }}
            className={`px-3 py-1 text-xs rounded-md transition-colors ${
              mode === 'follow' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'
            }`}
          >
            跟打
          </button>
          <button
            onClick={() => { setMode('dictation'); handleRestart() }}
            className={`px-3 py-1 text-xs rounded-md transition-colors ${
              mode === 'dictation' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'
            }`}
          >
            默写
          </button>
        </div>
        {currentArticle.audioSrc && (
          <Button variant="ghost" size="icon" onClick={() => audioRef.current?.play()}>
            <Speaker className="h-4 w-4" />
          </Button>
        )}
      </div>

      {currentArticle.audioSrc && (
        <audio ref={audioRef} src={getAudioURL()} preload="none" className="hidden" />
      )}

      {/* Progress bar */}
      <div className="space-y-1">
        <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-150 rounded-full"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{typedChars} / {totalChars} 字符</span>
          <span>{Math.round(progress)}%</span>
        </div>
      </div>

      {/* Tip for dictation mode */}
      {mode === 'dictation' && showHint && (
        <div className="text-center text-sm text-primary font-medium animate-pulse">
          提示: {hintWord}
        </div>
      )}

      {/* Text display */}
      <Card className="p-6">
        {mode === 'follow' ? renderFollowText() : renderDictationText()}
      </Card>

      {/* Stats */}
      <div className="flex gap-6 justify-center text-sm text-muted-foreground">
        <div>正确率 <span className="text-foreground font-medium">{Math.round(accuracy * 100)}%</span></div>
        <div>速度 <span className="text-foreground font-medium">{wpm}</span> WPM</div>
        <div>耗时 <span className="text-foreground font-medium">{elapsed}s</span></div>
      </div>

      {/* Mode hint */}
      <p className="text-xs text-muted-foreground text-center">
        {mode === 'follow' ? '逐字输入，换行、空格和标点自动跳过 · Backspace 回退' : '凭记忆输入每个词，空格确认 · Tab 查看提示'}
      </p>

      {/* Result modal */}
      {showResult && (
        <Card className="p-6 space-y-4">
          <h3 className="text-lg font-semibold text-center">练习完成</h3>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold text-primary">{Math.round(accuracy * 100)}%</div>
              <div className="text-xs text-muted-foreground">正确率</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-primary">{wpm}</div>
              <div className="text-xs text-muted-foreground">WPM</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-primary">{elapsed}s</div>
              <div className="text-xs text-muted-foreground">耗时</div>
            </div>
          </div>

          {mistakesFromErrors.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium">错词 ({mistakesFromErrors.length}个)</h4>
              <div className="max-h-32 overflow-y-auto space-y-1 text-sm">
                {mistakesFromErrors.map((m, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="text-red-500 line-through">{m.typed}</span>
                    <span className="text-muted-foreground">→</span>
                    <span className="text-green-600">{m.word}</span>
                  </div>
                ))}
              </div>
              <Button size="sm" variant="outline" onClick={handleAddMistakesToWords}>
                将错词加入生词库
              </Button>
            </div>
          )}

          <div className="flex gap-3 justify-center">
            <Button onClick={handleRestart}>再来一次</Button>
            <Button variant="outline" onClick={() => navigate('/articles')}>返回列表</Button>
          </div>
        </Card>
      )}
    </div>
  )
}
