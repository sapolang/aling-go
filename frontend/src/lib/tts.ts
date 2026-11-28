/** 与精听页共用同一份发音偏好，保证各页面音色一致。 */
export const TTS_VOICE_STORAGE_KEY = 'aling-pdf-tts-voice'

const DEFAULT_VOICE = 'en-US-AriaNeural'
// 后端离线时会依次尝试 Edge（约 8s）与本地引擎（约 20s），单词点击等场景等不了那么久。
// 超过该时长先用浏览器语音出声，后端迟到的结果直接丢弃。
const ENGINE_TIMEOUT_MS = 3000
// 已合成过的词/句保留在内存中，重复朗读直接播放，不再请求后端。
const CACHE_LIMIT = 64

interface CachedAudio {
  url: string
}

const cache = new Map<string, CachedAudio>()

type SpeakingListener = () => void

let seq = 0
let audio: HTMLAudioElement | null = null
let playingKey = ''
let browserUtterance: SpeechSynthesisUtterance | null = null
let speakingText = ''
const speakingListeners = new Set<SpeakingListener>()

/** 当前正在朗读的文本（空字符串表示没有朗读），供按钮显示播放动效。 */
export function getSpeakingText(): string {
  return speakingText
}

/** 订阅朗读状态变化，返回取消订阅函数。 */
export function subscribeSpeaking(listener: SpeakingListener): () => void {
  speakingListeners.add(listener)
  return () => {
    speakingListeners.delete(listener)
  }
}

function setSpeakingText(text: string): void {
  if (speakingText === text) return
  speakingText = text
  for (const listener of speakingListeners) listener()
}

function cacheKey(text: string, voice: string): string {
  return `${voice}\u0000${text}`
}

function getCached(key: string): CachedAudio | null {
  const hit = cache.get(key)
  if (!hit) return null
  // 刷新插入顺序，淘汰时优先丢弃最久未用的
  cache.delete(key)
  cache.set(key, hit)
  return hit
}

function remember(key: string, url: string): void {
  cache.set(key, { url })
  while (cache.size > CACHE_LIMIT) {
    let evicted = false
    for (const candidate of cache.keys()) {
      if (candidate === playingKey) continue
      const old = cache.get(candidate)
      if (old) URL.revokeObjectURL(old.url)
      cache.delete(candidate)
      evicted = true
      break
    }
    if (!evicted) break
  }
}

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function stopPlayback(): void {
  if (audio) {
    const el = audio
    audio = null
    el.onended = null
    el.onerror = null
    el.pause()
    el.removeAttribute('src')
    el.load()
  }
  playingKey = ''
  browserUtterance = null
  window.speechSynthesis?.cancel()
  setSpeakingText('')
}

function preferredVoice(): string {
  return localStorage.getItem(TTS_VOICE_STORAGE_KEY) || DEFAULT_VOICE
}

function speakWithBrowser(text: string, lang: string): void {
  if (!window.speechSynthesis) {
    setSpeakingText('')
    return
  }
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = lang
  utterance.rate = 0.9
  utterance.pitch = 1
  const finish = () => {
    if (browserUtterance !== utterance) return
    browserUtterance = null
    setSpeakingText('')
  }
  utterance.onend = finish
  utterance.onerror = finish
  browserUtterance = utterance
  setSpeakingText(text)
  window.speechSynthesis.speak(utterance)
}

/**
 * 朗读一段文本：优先走后端 TTS（Edge 在线音色，失败降级本地 Piper），
 * 后端不可用或超时才回落到浏览器原生语音。每次调用会打断上一句。
 * 已合成过的词/句命中内存缓存，直接播放。
 */
export function speak(text: string, lang: string = 'en-US'): void {
  const value = text?.trim()
  if (!value) return
  const id = ++seq
  stopPlayback()

  if (!lang.toLowerCase().startsWith('en')) {
    // 后端音色目前只有英文，其它语言直接交给浏览器
    speakWithBrowser(value, lang)
    return
  }

  // 点击后立即进入「朗读中」状态：合成期间按钮也保持播放动效。
  setSpeakingText(value)
  const voice = preferredVoice()
  const key = cacheKey(value, voice)
  const cached = getCached(key)
  if (cached) {
    playUrl(key, cached.url, id, value, lang)
    return
  }
  void speakWithEngine(value, lang, voice, key, id)
}

async function speakWithEngine(
  text: string,
  lang: string,
  voice: string,
  key: string,
  id: number,
): Promise<void> {
  let result: Awaited<ReturnType<typeof window.api.ttsSynthesize>> | null = null
  try {
    result = await Promise.race([
      window.api.ttsSynthesize(text, voice),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), ENGINE_TIMEOUT_MS)),
    ])
  } catch {
    result = null
  }
  // 已被后续朗读请求取代
  if (id !== seq) return
  if (!result || !result.audioBase64 || result.engine === 'fallback') {
    speakWithBrowser(text, lang)
    return
  }

  const bytes = decodeBase64(result.audioBase64)
  const url = URL.createObjectURL(
    new Blob([bytes.buffer as ArrayBuffer], { type: result.mimeType || 'audio/mpeg' }),
  )
  remember(key, url)
  playUrl(key, url, id, text, lang)
}

function playUrl(key: string, url: string, id: number, text: string, lang: string): void {
  const el = new Audio(url)
  audio = el
  playingKey = key
  el.onended = () => {
    if (audio === el) {
      audio = null
      playingKey = ''
      setSpeakingText('')
    }
  }
  el.onerror = () => {
    if (audio === el) {
      audio = null
      playingKey = ''
    }
    if (id !== seq) return
    speakWithBrowser(text, lang)
  }
  void el.play().catch(() => {
    if (audio === el) {
      audio = null
      playingKey = ''
    }
    if (id !== seq) return
    speakWithBrowser(text, lang)
  })
}
