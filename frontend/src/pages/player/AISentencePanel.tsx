import { BookOpen, Languages, Loader2, Sparkles, X as XIcon } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { AIExplainState, AITarget, AITranslateState } from './useAIPanel'

interface AISentencePanelProps {
  aiTarget: AITarget | null
  aiTranslate: AITranslateState | null
  aiExplain: AIExplainState | null
  onTranslate: () => void
  onExplain: () => void
  onCloseTarget: () => void
  onDismissExplain: () => void
}

/** AI 当前句翻译面板与详解抽屉 */
export default function AISentencePanel({
  aiTarget,
  aiTranslate,
  aiExplain,
  onTranslate,
  onExplain,
  onCloseTarget,
  onDismissExplain,
}: AISentencePanelProps) {
  return (
    <>
      {aiTarget && (
        <div className="fixed bottom-24 left-1/2 z-40 -translate-x-1/2">
          <div className="pp-ai-card">
            <p className="pp-ai-sentence line-clamp-2">{aiTarget.text}</p>
            <div className="pp-ai-actions">
              <button type="button" className="pp-ai-btn" onClick={onTranslate}>
                <Languages className="h-3.5 w-3.5" /> 翻译
              </button>
              <button type="button" className="pp-ai-btn is-primary" onClick={onExplain}>
                <BookOpen className="h-3.5 w-3.5" /> 详解
              </button>
              <button
                type="button"
                className="pp-ai-btn"
                style={{ marginLeft: 'auto' }}
                onClick={onCloseTarget}
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </div>
            {(aiTranslate || aiExplain?.loading) && (
              <div className="mt-2">
                {aiTranslate && (
                  <>
                    {aiTranslate.loading && !aiTranslate.text && (
                      <span className="flex items-center gap-1 text-xs text-[var(--pp-muted)]">
                        <Loader2 className="h-3 w-3 animate-spin" /> 翻译中...
                      </span>
                    )}
                    {aiTranslate.text && <p className="pp-ai-result">{aiTranslate.text}</p>}
                    {aiTranslate.error && (
                      <p className="mt-1 text-xs text-red-400">{aiTranslate.error}</p>
                    )}
                  </>
                )}
                {aiExplain?.loading && (
                  <span className="flex items-center gap-1 text-xs text-[var(--pp-muted)]">
                    <Loader2 className="h-3 w-3 animate-spin" /> 生成详解...
                  </span>
                )}
                {aiExplain?.error && <p className="mt-1 text-xs text-red-400">{aiExplain.error}</p>}
              </div>
            )}
          </div>
        </div>
      )}

      {aiExplain?.data && (
        <Dialog open onOpenChange={(open) => !open && onDismissExplain()}>
          <DialogContent className="left-auto right-0 top-0 block h-full w-[420px] max-w-[92vw] translate-x-0 translate-y-0 gap-0 overflow-y-auto rounded-none border-0 border-l p-5 shadow-xl sm:rounded-none data-[state=open]:animate-none data-[state=closed]:animate-none">
            <DialogHeader className="mb-3">
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" /> AI 详解
              </DialogTitle>
            </DialogHeader>
            {aiExplain.text && (
              <p className="text-sm text-muted-foreground mb-4 leading-relaxed">{aiExplain.text}</p>
            )}
            <div className="space-y-4">
              <section>
                <h4 className="text-xs font-medium text-muted-foreground mb-1">译文</h4>
                <p className="text-base leading-relaxed">{aiExplain.data.translation}</p>
              </section>
              {aiExplain.data.grammar && (
                <section>
                  <h4 className="text-xs font-medium text-muted-foreground mb-1">语法结构</h4>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">
                    {aiExplain.data.grammar}
                  </p>
                </section>
              )}
              {Array.isArray(aiExplain.data.keywords) && aiExplain.data.keywords.length > 0 && (
                <section>
                  <h4 className="text-xs font-medium text-muted-foreground mb-1.5">关键词</h4>
                  <div className="space-y-2">
                    {aiExplain.data.keywords.map((k: any, i: number) => (
                      <div key={i} className="rounded border p-2">
                        <p className="text-sm font-medium">
                          {k.word}
                          <span className="text-muted-foreground font-normal"> — {k.meaning}</span>
                        </p>
                        {k.note && <p className="text-xs text-muted-foreground mt-0.5">{k.note}</p>}
                      </div>
                    ))}
                  </div>
                </section>
              )}
              {aiExplain.data.context && (
                <section>
                  <h4 className="text-xs font-medium text-muted-foreground mb-1">语境</h4>
                  <p className="text-sm leading-relaxed">{aiExplain.data.context}</p>
                </section>
              )}
              {aiExplain.data.pitfalls && (
                <section>
                  <h4 className="text-xs font-medium text-muted-foreground mb-1">易错点</h4>
                  <p className="text-sm leading-relaxed">{aiExplain.data.pitfalls}</p>
                </section>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
