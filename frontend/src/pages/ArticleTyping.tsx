import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useArticleStore } from '@/stores/articleStore'
import { useWordStore } from '@/stores/wordStore'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { showToast } from '@/components/feedback'
import { Speaker, ArrowLeft, Pencil, Eye, Check, Volume2 } from 'lucide-react'
import WordHoverCard from '@/components/WordHoverCard'
import WordLookupModal from '@/components/WordLookupModal'
import { speak } from '@/lib/tts'

const CDN_BASE = 'https://files.typewords.cc'

const AUTO_SKIP_CHARS = new Set([
  '\n',
  ' ',
  '.',
  ',',
  '!',
  '?',
  ';',
  ':',
  '"',
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  '—',
  '–',
  '…',
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
])

function isAutoSkipChar(char: string): boolean {
  return AUTO_SKIP_CHARS.has(char)
}

type Mode = 'follow' | 'dictation'

interface CharState {
  char: string
  status: 'pending' | 'current' | 'correct' | 'wrong'
}

function sameChar(a: string | undefined, b: string | undefined): boolean {
  return a !== undefined && b !== undefined && a.toLowerCase() === b.toLowerCase()
}

// 按行切分原文，返回每行在原文中的起止下标（译文与其逐行一一对应）
function splitLines(text: string): { start: number; end: number; text: string }[] {
  const lines: { start: number; end: number; text: string }[] = []
  let offset = 0
  for (const line of text.split('\n')) {
    lines.push({ start: offset, end: offset + line.length, text: line })
    offset += line.length + 1
  }
  return lines
}

// 取 text 中 index 所在的句子（以换行和句末标点为界），作为查词的上下文例句
function sentenceAt(text: string, index: number): string {
  let start = Math.min(index, text.length)
  while (start > 0 && !/[\n.!?;]/.test(text[start - 1])) start--
  let end = start
  while (end < text.length && !/[\n.!?;]/.test(text[end])) end++
  return text.slice(start, end).trim()
}

export default function ArticleTypingPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const {
    currentArticle,
    typingProgress,
    loadArticle,
    loadTypingProgress,
    saveTypingProgress,
    saveTypingRecord,
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
  const [dictationResults, setDictationResults] = useState<
    { word: string; typed: string; correct: boolean }[]
  >([])
  // 悬停查词 / 完整查词弹窗状态（模式照抄 Player 页）
  const [hover, setHover] = useState<{ word: string; sentence: string; anchor: DOMRect } | null>(
    null,
  )
  const [showLookup, setShowLookup] = useState(false)
  const [selectedWord, setSelectedWord] = useState('')
  const [selectedSentence, setSelectedSentence] = useState('')
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoverHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const cursorRef = useRef<HTMLSpanElement>(null)
  const abortedRef = useRef(false)
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
    if (
      typingProgress &&
      typingProgress.position > 0 &&
      !started &&
      typingProgress.articleId === articleId &&
      typingProgress.mode === mode
    ) {
      const source =
        mode === 'dictation'
          ? (currentArticle?.text || '').replace(/[0-9]/g, '')
          : currentArticle?.text || ''
      setTyped(source.slice(0, typingProgress.position))
    }
  }, [typingProgress, currentArticle, articleId, mode])

  useEffect(() => {
    if (!started || finished) return
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [started, startTime, finished])

  useEffect(() => {
    if (!started || finished) return
    cursorRef.current?.scrollIntoView({ block: 'nearest' })
  }, [typed.length, started, finished])

  const text = currentArticle?.text || ''
  // 默写模式不要求输入数字，统一使用去掉数字后的文本作为比对基准
  const sourceText = mode === 'dictation' ? text.replace(/[0-9]/g, '') : text
  const totalChars = sourceText.length
  const typedChars = typed.length

  // 逐行切分原文，译文中每行与原文逐行对应，显示在该行英文下方
  const lines = useMemo(() => splitLines(text), [text])
  const translations = useMemo(
    () => (currentArticle?.textTranslate || '').split('\n'),
    [currentArticle?.textTranslate],
  )

  // 生词库词表：已收藏的词在正文中高亮显示（与 Player 页一致）
  const savedWordList = useWordStore((s) => s.words)
  const loadWords = useWordStore((s) => s.loadWords)
  const savedWords = useMemo(
    () => new Set(savedWordList.map((w) => w.word.toLowerCase())),
    [savedWordList],
  )
  useEffect(() => {
    void loadWords()
  }, [])

  const isSavedWord = (part: string) => {
    let clean = part.toLowerCase().replace(/[^a-z0-9\-']/g, '')
    if (clean.endsWith("'s")) clean = clean.slice(0, -2)
    return clean.length > 1 && savedWords.has(clean)
  }
  const savedWordMark = 'text-amber-500 underline decoration-dotted underline-offset-2'

  // 悬停 300ms 后弹出释义卡片，避免扫过正文时闪烁
  const scheduleHover = (word: string, sentence: string, el: HTMLElement) => {
    const clean = word.replace(/[^a-zA-Z0-9\-']/g, '')
    if (clean.length < 2) return
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    if (hoverHideTimer.current) clearTimeout(hoverHideTimer.current)
    const anchor = el.getBoundingClientRect()
    hoverTimer.current = setTimeout(() => {
      setHover({ word: clean, sentence, anchor })
    }, 300)
  }

  // 移出单词后延迟收起，留出时间把鼠标移进浮层
  const scheduleHideHover = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    if (hoverHideTimer.current) clearTimeout(hoverHideTimer.current)
    hoverHideTimer.current = setTimeout(() => {
      setHover(null)
    }, 250)
  }

  const keepHover = () => {
    if (hoverHideTimer.current) clearTimeout(hoverHideTimer.current)
  }

  const cancelHover = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    if (hoverHideTimer.current) clearTimeout(hoverHideTimer.current)
    hoverTimer.current = null
    hoverHideTimer.current = null
    setHover(null)
  }

  useEffect(() => {
    return () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current)
      if (hoverHideTimer.current) clearTimeout(hoverHideTimer.current)
    }
  }, [])

  const handleWordClick = (word: string, sentence: string) => {
    const clean = word.replace(/[^a-zA-Z0-9\-']/g, '')
    if (!clean) return
    cancelHover()
    speak(clean)
    setSelectedWord(clean)
    setSelectedSentence(sentence)
    setShowLookup(true)
  }

  const handleWordAdded = () => {
    showToast('已加入生词库')
    void loadWords()
  }

  // 当前打字位置所在的行，用于「朗读当前句」
  const currentLineText = useMemo(() => {
    if (!lines.length) return ''
    const pos = Math.min(typed.length, Math.max(text.length - 1, 0))
    const line = lines.find((l) => pos < l.end) || lines[lines.length - 1]
    return line.text.trim()
  }, [lines, typed.length, text.length])

  const charStates: CharState[] = useMemo(() => {
    return text.split('').map((char, i) => {
      if (i < typed.length) {
        const isCorrect = sameChar(typed[i], char)
        return { char, status: isCorrect ? 'correct' : 'wrong' }
      }
      if (i === typed.length) return { char, status: 'current' }
      return { char, status: 'pending' }
    })
  }, [text, typed])

  const correctCount = useMemo(() => {
    let count = 0
    for (let i = 0; i < typed.length; i++) {
      if (sameChar(typed[i], sourceText[i])) count++
    }
    return count
  }, [typed, sourceText])

  const accuracy = typed.length > 0 ? correctCount / typed.length : 1
  const wpm = elapsed > 0 ? Math.round(typedChars / 5 / (elapsed / 60)) : 0

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // 查词弹窗打开时不响应打字，避免误输入
      if (finished || showResult || showLookup) return
      if (e.isComposing) return

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        // 跟打模式下空格与标点会自动跳过，忽略这些按键，避免重复追加导致错位
        if (mode === 'follow' && isAutoSkipChar(e.key)) return
        if (!started) {
          setStarted(true)
          setStartTime(Date.now())
        }
        if (typed.length < sourceText.length) {
          if (mode === 'follow') {
            setTyped((prev) => {
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
            setTyped((prev) => prev + e.key)
            if (typed.length + 1 >= sourceText.length) {
              setFinished(true)
              setShowResult(true)
            }
          }
        }
        return
      }

      if (e.key === 'Enter' && mode === 'dictation') {
        e.preventDefault()
        if (!started) {
          setStarted(true)
          setStartTime(Date.now())
        }
        setTyped((prev) => {
          const nextTyped = prev + '\n'
          if (nextTyped.length >= sourceText.length) {
            setFinished(true)
            setShowResult(true)
          }
          return nextTyped
        })
        return
      }

      if (e.key === 'Backspace') {
        e.preventDefault()
        setTyped((prev) => prev.slice(0, -1))
        return
      }

      if (e.key === 'Tab' && mode === 'dictation') {
        e.preventDefault()
        const remaining = sourceText.slice(typed.length)
        const nextWord = remaining.match(/^\S+/)?.[0] || ''
        setHintWord(nextWord)
        setShowHint(true)
        clearTimeout(hideHintTimer.current)
        hideHintTimer.current = setTimeout(() => setShowHint(false), 3000)
        return
      }
    },
    [finished, showResult, showLookup, started, text, typed, mode],
  )

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
    abortedRef.current = false
  }

  const handleComplete = async () => {
    const aborted = abortedRef.current
    const mistakeWords: { word: string; typed: string; position: number }[] = []
    const words = sourceText.split(/\s+/)
    let pos = 0
    for (const word of words) {
      const startPos = sourceText.indexOf(word, pos)
      if (startPos < 0) break
      const typedSegment = typed.slice(startPos, startPos + word.length)
      if (typedSegment.toLowerCase() !== word.toLowerCase() && typedSegment.length > 0) {
        mistakeWords.push({ word, typed: typedSegment, position: startPos })
      }
      pos = startPos + word.length
    }

    const record = {
      articleId,
      mode,
      accuracy,
      wpm,
      duration: elapsed,
      mistakes: JSON.stringify(mistakeWords),
    }
    if (!aborted) {
      await saveTypingRecord(record)
    }

    const currentBestAccuracy = typingProgress?.bestAccuracy || 0
    const currentBestWpm = typingProgress?.bestWpm || 0
    await saveTypingProgress({
      articleId,
      mode,
      position: typedChars,
      completed: !aborted,
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

  // 渲染单个字符，保留原有的逐字对错着色；saved 时未输入字符用琥珀色标示
  const renderChar = (cs: CharState, key: number, saved = false) => (
    <span
      key={key}
      ref={cs.status === 'current' ? cursorRef : undefined}
      className={
        cs.status === 'wrong'
          ? 'bg-red-200 dark:bg-red-800 text-red-800 dark:text-red-200 rounded'
          : cs.status === 'correct'
            ? 'text-muted-foreground'
            : cs.status === 'current'
              ? `border-b-2 border-blue-500 ${saved ? 'text-amber-500' : 'text-foreground'}`
              : saved
                ? 'text-amber-500'
                : 'text-foreground'
      }
    >
      {cs.char === ' ' && cs.status === 'current' ? '␣' : cs.char}
    </span>
  )

  // Render character display for follow mode
  const renderFollowText = () => (
    <div className="font-mono text-2xl select-none">
      {lines.map((line, li) => {
        const translation = translations[li]?.trim()
        if (!line.text.trim()) return <div key={li} className="h-3" />
        // 把行内字符按空格聚成单词 token，单词整体可悬停查词，字符仍独立着色
        const slice = charStates.slice(line.start, line.end)
        const tokens: { word: boolean; start: number; chars: CharState[] }[] = []
        slice.forEach((cs, i) => {
          const isWordChar = !/\s/.test(cs.char)
          const last = tokens[tokens.length - 1]
          if (isWordChar && last && last.word) {
            last.chars.push(cs)
          } else {
            tokens.push({ word: isWordChar, start: line.start + i, chars: [cs] })
          }
        })
        return (
          <div key={li} className="mb-1">
            <div
              className="whitespace-pre-wrap break-words leading-normal"
              style={{ letterSpacing: '0.05em' }}
            >
              {tokens.map((tok, ti) => {
                if (!tok.word) {
                  return tok.chars.map((cs, i) => renderChar(cs, tok.start + i))
                }
                const raw = tok.chars.map((c) => c.char).join('')
                const clean = raw.replace(/[^a-zA-Z0-9\-']/g, '')
                const saved = clean.length > 1 && isSavedWord(raw)
                if (clean.length < 2) {
                  return (
                    <span key={ti}>
                      {tok.chars.map((cs, i) => renderChar(cs, tok.start + i, saved))}
                    </span>
                  )
                }
                return (
                  <span
                    key={ti}
                    className={`${saved ? savedWordMark + ' ' : ''}cursor-pointer rounded hover:bg-muted`}
                    onMouseEnter={(e) => scheduleHover(raw, line.text, e.currentTarget)}
                    onMouseLeave={scheduleHideHover}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleWordClick(raw, line.text)
                    }}
                  >
                    {tok.chars.map((cs, i) => renderChar(cs, tok.start + i, saved))}
                  </span>
                )
              })}
            </div>
            {translation && (
              <div className="font-sans text-[17px] leading-snug text-muted-foreground whitespace-pre-wrap">
                {translation}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )

  // Render dictation mode: typed words with reveal
  const renderDictationText = () => {
    const originalWords = sourceText.split(/(\s+)/)
    let typedPos = 0
    const typedWords = typed.split(/(\s+)/)

    return (
      <div className="font-mono text-xl leading-relaxed whitespace-pre-wrap break-words select-none">
        {/* Show already typed words */}
        {typedWords.map((tw, i) => {
          const startPos = typedPos
          typedPos += tw.length
          const ow = originalWords[i]
          const isSpace = /^\s+$/.test(tw)
          if (isSpace) return <span key={i}>{tw}</span>
          const lookupSource = ow || tw
          const clean = lookupSource.replace(/[^a-zA-Z0-9\-']/g, '')
          const saved = clean.length > 1 && isSavedWord(lookupSource)
          const sentence = sentenceAt(sourceText, startPos)
          if (!ow)
            return (
              <span key={i} className="text-muted-foreground">
                {tw}
              </span>
            )
          const matched = ow.toLowerCase() === tw.toLowerCase()
          // 默写模式保留对错配色，收藏词用点状下划线标示
          const interactive =
            clean.length > 1
              ? {
                  onMouseEnter: (e: React.MouseEvent<HTMLElement>) =>
                    scheduleHover(lookupSource, sentence, e.currentTarget),
                  onMouseLeave: scheduleHideHover,
                  onClick: (e: React.MouseEvent<HTMLElement>) => {
                    e.stopPropagation()
                    handleWordClick(lookupSource, sentence)
                  },
                }
              : {}
          return (
            <span
              key={i}
              className={`${
                matched ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'
              } ${saved ? 'underline decoration-dotted underline-offset-2 ' : ''}${
                clean.length > 1 ? 'cursor-pointer hover:underline' : ''
              }`}
              {...interactive}
            >
              {matched ? tw : <span className="line-through mr-1">{tw}</span>}
              {!matched && <span className="text-green-600 text-xs align-super">{ow}</span>}
            </span>
          )
        })}
        {/* Show cursor for remaining */}
        {typed.length < sourceText.length && (
          <span ref={cursorRef} className="border-b-2 border-blue-500 animate-pulse">
            &nbsp;
          </span>
        )}
        {/* Show remaining as hidden */}
        {mode === 'dictation' && (
          <span className="text-muted-foreground/20">
            {'█'.repeat(Math.min(200, sourceText.length - typed.length))}
          </span>
        )}
      </div>
    )
  }

  const mistakesFromErrors = (() => {
    const words = sourceText.split(/\s+/)
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
    const uniqueWords = [...new Set(mistakesFromErrors.map((m) => m.word))]
    const wordsToAdd = uniqueWords.map((word) => ({
      word,
      definition: '',
      phonetic: '',
    }))
    const count = await window.api.addWordsBatch(JSON.stringify(wordsToAdd))
    showToast(`已添加 ${count} 个生词`)
  }

  if (!currentArticle) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">加载中...</div>
    )
  }

  return (
    <div className="w-full max-w-6xl xl:max-w-7xl mx-auto space-y-6 pt-4">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="icon" onClick={() => navigate('/articles')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold truncate">{currentArticle.title}</h2>
          <p className="text-sm text-muted-foreground truncate">{currentArticle.titleTranslate}</p>
        </div>
        <div className="flex gap-1 bg-muted rounded-lg p-0.5">
          <button
            onClick={() => {
              setMode('follow')
              handleRestart()
            }}
            className={`px-3 py-1 text-xs rounded-md transition-colors ${
              mode === 'follow'
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground'
            }`}
          >
            跟打
          </button>
          <button
            onClick={() => {
              setMode('dictation')
              handleRestart()
            }}
            className={`px-3 py-1 text-xs rounded-md transition-colors ${
              mode === 'dictation'
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground'
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
        <Button
          variant="ghost"
          size="icon"
          title="朗读当前句"
          disabled={!currentLineText}
          onClick={() => currentLineText && speak(currentLineText)}
        >
          <Volume2 className="h-4 w-4" />
        </Button>
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
          <span>
            {typedChars} / {totalChars} 字符
          </span>
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
        <div className="max-h-[60vh] overflow-y-auto pr-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {mode === 'follow' ? renderFollowText() : renderDictationText()}
        </div>
      </Card>

      {/* Stats */}
      <div className="flex gap-6 justify-center text-sm text-muted-foreground">
        <div>
          正确率 <span className="text-foreground font-medium">{Math.round(accuracy * 100)}%</span>
        </div>
        <div>
          速度 <span className="text-foreground font-medium">{wpm}</span> WPM
        </div>
        <div>
          耗时 <span className="text-foreground font-medium">{elapsed}s</span>
        </div>
      </div>

      {started && !finished && (
        <div className="flex justify-center">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              abortedRef.current = true
              setFinished(true)
              setShowResult(true)
            }}
          >
            完成本次练习
          </Button>
        </div>
      )}

      {/* Mode hint */}
      <p className="text-xs text-muted-foreground text-center">
        {mode === 'follow'
          ? '逐字输入，换行、空格和标点自动跳过 · Backspace 回退'
          : '凭记忆输入全文，Enter 换行 · Tab 查看提示'}
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
            <Button variant="outline" onClick={() => navigate('/articles')}>
              返回列表
            </Button>
          </div>
        </Card>
      )}

      {hover && (
        <WordHoverCard
          word={hover.word}
          sentence={hover.sentence}
          anchor={hover.anchor}
          onMouseEnter={keepHover}
          onMouseLeave={scheduleHideHover}
          onAdded={handleWordAdded}
        />
      )}

      {showLookup && selectedWord && (
        <WordLookupModal
          word={selectedWord}
          sentence={selectedSentence}
          onClose={() => {
            setShowLookup(false)
            void loadWords()
          }}
          onAdded={handleWordAdded}
        />
      )}
    </div>
  )
}
