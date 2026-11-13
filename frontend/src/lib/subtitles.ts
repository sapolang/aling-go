// 字幕按开始时间有序时的定位工具：供播放进度、字幕跟随、跳句等路径复用。

export interface TimedCue {
  startTime: number
  endTime: number
}

/**
 * 保证字幕按开始时间升序。已有序时原样返回，避免无意义的新数组导致下游重渲染。
 * 相同开始时间保留原有顺序（Array.prototype.sort 为稳定排序）。
 */
export function sortByStartTime<T extends TimedCue>(cues: T[]): T[] {
  for (let i = 1; i < cues.length; i++) {
    if (cues[i].startTime < cues[i - 1].startTime) {
      return [...cues].sort((a, b) => a.startTime - b.startTime)
    }
  }
  return cues
}

// 前缀最大结束时间：缓存按数组引用失效，字幕数组在状态更新时整体替换
const prefixMaxCache = new WeakMap<TimedCue[], number[]>()

function prefixMaxEnd(cues: TimedCue[]): number[] {
  const cached = prefixMaxCache.get(cues)
  if (cached) return cached
  const result = new Array<number>(cues.length)
  let max = Number.NEGATIVE_INFINITY
  for (let i = 0; i < cues.length; i++) {
    if (cues[i].endTime > max) max = cues[i].endTime
    result[i] = max
  }
  prefixMaxCache.set(cues, result)
  return result
}

interface FindCueOptions {
  /** 匹配开始时间时允许的提前量，默认 0.08s */
  tolerance?: number
  /** 是否把「当前时间等于句尾」视为命中，默认 true */
  inclusiveEnd?: boolean
}

/**
 * 在按开始时间有序的字幕中定位当前时间对应的条目。
 * 与线性查找语义一致：返回顺序上最早命中的一条；字幕区间重叠时也能命中正确条目。
 * 未命中返回 -1。
 */
export function findCueIndexAt<T extends TimedCue>(
  cues: T[],
  t: number,
  options: FindCueOptions = {},
): number {
  const { tolerance = 0.08, inclusiveEnd = true } = options
  if (cues.length === 0) return -1

  // 1. 找到最后一个开始时间不晚于 t + tolerance 的条目
  const limit = t + tolerance
  let lo = 0
  let hi = cues.length - 1
  let last = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (cues[mid].startTime <= limit) {
      last = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  if (last === -1) return -1

  // 2. 在 [0, last] 里找最早覆盖 t 的条目；前缀最大值单调，可二分
  const covers = (endTime: number) => (inclusiveEnd ? endTime >= t : endTime > t)
  const maxEnd = prefixMaxEnd(cues)
  if (!covers(maxEnd[last])) return -1

  let idx = last
  lo = 0
  hi = last
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (covers(maxEnd[mid])) {
      idx = mid
      hi = mid - 1
    } else {
      lo = mid + 1
    }
  }
  return idx
}

/** 把秒格式化为 m:ss，与播放器时间码保持一致 */
export function formatClockTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  return `${m}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`
}
