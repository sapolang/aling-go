import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePlayerStore } from '@/stores/playerStore'
import type { SubtitleItem } from '@/types/api'
import { showToast } from '@/components/feedback'
import { filterSubtitleText } from './constants'

export interface AITarget {
  text: string
  context: string
}

export interface AITranslateState {
  reqId: string
  text: string
  loading: boolean
  error?: string
}

export interface AIExplainState {
  loading: boolean
  error?: string
  data?: any
  text?: string
}

export interface AIPanelHandle {
  aiTarget: AITarget | null
  aiTranslate: AITranslateState | null
  aiExplain: AIExplainState | null
  /** 当前句触发：已有目标则关闭，否则打开操作面板 */
  toggleForSubtitle: (sub: SubtitleItem | null) => void
  translate: () => Promise<void>
  explain: () => Promise<void>
  closeAll: () => void
  closeTarget: () => void
  dismissTranslate: () => void
  dismissExplain: () => void
}

/** 播放页 AI 当前句翻译/详解的请求与流式状态 */
export function useAIPanel(): AIPanelHandle {
  const navigate = useNavigate()
  const [aiTarget, setAiTarget] = useState<AITarget | null>(null)
  const [aiTranslate, setAiTranslate] = useState<AITranslateState | null>(null)
  const [aiExplain, setAiExplain] = useState<AIExplainState | null>(null)
  const aiReqRef = useRef(0)
  const aiActiveReq = useRef('')
  const filePath = usePlayerStore((s) => s.filePath)

  // 切换播放源时清掉上一份素材的 AI 上下文，避免把旧句子带到新视频
  useEffect(() => {
    setAiTarget(null)
    setAiTranslate(null)
    setAiExplain(null)
    aiActiveReq.current = ''
  }, [filePath])

  useEffect(() => {
    const offChunk = window.api.aiOnChunk(({ reqId, delta }: any) => {
      if (reqId !== aiActiveReq.current) return
      setAiTranslate((s) => (s ? { ...s, text: s.text + delta, loading: true } : s))
    })
    const offDone = window.api.aiOnDone(({ reqId, text, error }: any) => {
      if (reqId !== aiActiveReq.current) return
      setAiTranslate({ reqId, text: text || '', loading: false, error })
    })
    return () => {
      offChunk()
      offDone()
    }
  }, [])

  const closeAll = () => {
    setAiTarget(null)
    setAiTranslate(null)
    setAiExplain(null)
  }

  const toggleForSubtitle = (sub: SubtitleItem | null) => {
    if (aiTarget) {
      closeAll()
      return
    }
    if (!sub) return
    // 详解/翻译对象为当前句英文部分，上下文保留完整句
    const en = filterSubtitleText(sub.text, 'en') || sub.text
    setAiTarget({ text: en, context: sub.text })
    setAiTranslate(null)
    setAiExplain(null)
  }

  const ensureAIConfig = async () => {
    const cfg = await window.api.aiGetConfig()
    if (!cfg.hasKey) {
      setAiTarget(null)
      showToast('请先在「设置 → AI 翻译」中填写 API Key', 'warning')
      navigate('/settings')
      return false
    }
    return true
  }

  const translate = async () => {
    if (!aiTarget || !(await ensureAIConfig())) return
    const id = `t${++aiReqRef.current}`
    aiActiveReq.current = id
    setAiExplain(null)
    setAiTranslate({ reqId: id, text: '', loading: true })
    const r = await window.api.aiTranslateStream(aiTarget.text, aiTarget.context, id)
    if (r.error) {
      setAiTranslate((s) => (s ? { ...s, loading: false, error: r.error } : s))
      return
    }
    if (r.cached) setAiTranslate({ reqId: id, text: r.text, loading: false })
  }

  const explain = async () => {
    if (!aiTarget || !(await ensureAIConfig())) return
    const target = aiTarget
    setAiTranslate(null)
    setAiExplain({ loading: true, text: target.text })
    const r = await window.api.aiExplain(target.text, target.context)
    if (!r.ok) {
      setAiExplain({ loading: false, error: r.error, text: target.text })
      return
    }
    setAiExplain({ loading: false, data: r.data, text: target.text })
    // 详解抽屉已展示完整内容，收起操作面板避免两者同时悬浮
    setAiTarget(null)
  }

  return {
    aiTarget,
    aiTranslate,
    aiExplain,
    toggleForSubtitle,
    translate,
    explain,
    closeAll,
    closeTarget: () => setAiTarget(null),
    dismissTranslate: () => setAiTranslate(null),
    dismissExplain: () => setAiExplain(null),
  }
}
