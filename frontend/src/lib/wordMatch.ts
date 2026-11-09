// 生词匹配与句子切分的共享逻辑，供文章列表（密度）与打字页（高亮/导航）复用

// 与打字页 isSavedWord 一致的清洗规则：小写、去标点、去掉所有格 's
export function cleanWordToken(part: string): string {
  let clean = part.toLowerCase().replace(/[^a-z0-9\-']/g, '')
  if (clean.endsWith("'s")) clean = clean.slice(0, -2)
  return clean
}

export function isSavedWord(part: string, savedWords: ReadonlySet<string>): boolean {
  const clean = cleanWordToken(part)
  return clean.length > 1 && savedWords.has(clean)
}

// 生词密度：文中已入库生词 token 数 / 总词 token 数（词间按空白切分）
export function savedWordDensity(text: string, savedWords: ReadonlySet<string>): number {
  if (!text || savedWords.size === 0) return 0
  let total = 0
  let saved = 0
  for (const part of text.split(/\s+/)) {
    const clean = cleanWordToken(part)
    if (clean.length <= 1) continue
    total++
    if (savedWords.has(clean)) saved++
  }
  return total > 0 ? saved / total : 0
}

export interface SentenceRange {
  start: number
  end: number
  text: string
}

// 句子切分，边界规则与打字页 sentenceAt 一致：换行与 .!?; 为句界
export function splitSentences(text: string): SentenceRange[] {
  const ranges: SentenceRange[] = []
  let start = 0
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || /[\n.!?;]/.test(text[i])) {
      const s = text.slice(start, i).trim()
      if (s) ranges.push({ start, end: i, text: s })
      start = i + 1
    }
  }
  return ranges
}

// 含已入库生词的句子下标列表
export function wordSentenceIndexes(
  sentences: SentenceRange[],
  savedWords: ReadonlySet<string>,
): number[] {
  if (savedWords.size === 0) return []
  const idxs: number[] = []
  sentences.forEach((s, i) => {
    if (s.text.split(/\s+/).some((w) => isSavedWord(w, savedWords))) idxs.push(i)
  })
  return idxs
}
