import { useEffect, useState } from 'react'
import { getSpeakingText, subscribeSpeaking } from '@/lib/tts'

/** 当前正在朗读的文本（空字符串表示没有朗读）。 */
export function useSpeakingText(): string {
  const [text, setText] = useState(getSpeakingText)
  useEffect(() => subscribeSpeaking(() => setText(getSpeakingText())), [])
  return text
}

/** 给定文本是否正在朗读，用于给发音按钮加播放动效。 */
export function useIsSpeaking(text?: string | null): boolean {
  const speaking = useSpeakingText()
  const value = text?.trim().toLowerCase()
  // 大小写不敏感：点选 "Hello" 时词典条目可能是 "hello"
  return !!value && value === speaking.toLowerCase()
}
