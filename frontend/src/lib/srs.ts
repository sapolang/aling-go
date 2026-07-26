export const gradeOptions = [
  { grade: 1, label: '忘记', key: '1', className: 'bg-red-500 hover:bg-red-600' },
  { grade: 3, label: '困难', key: '2', className: 'bg-orange-500 hover:bg-orange-600' },
  { grade: 4, label: '良好', key: '3', className: 'bg-blue-500 hover:bg-blue-600' },
  { grade: 5, label: '简单', key: '4', className: 'bg-green-500 hover:bg-green-600' },
]

export interface SrsResult {
  nextReview: string
  newEfactor: number
  newInterval: number
  newRepetitions: number
}

export function sm2(
  efactor: number,
  interval: number,
  repetitions: number,
  quality: number,
): SrsResult {
  if (efactor <= 0) efactor = 2.5

  let newInterval: number
  let newRepetitions: number

  if (quality < 3) {
    newInterval = 1
    newRepetitions = 0
  } else {
    if (repetitions === 0) {
      newInterval = 1
    } else if (repetitions === 1) {
      newInterval = 6
    } else {
      newInterval = Math.round(interval * efactor)
    }
    newRepetitions = repetitions + 1
  }

  if (quality === 3 && repetitions > 0) {
    newInterval = Math.max(1, Math.round(interval * 1.2))
  } else if (quality === 5) {
    newInterval = Math.round(newInterval * 1.3)
  }

  const newEfactor = Math.max(
    1.3,
    efactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)),
  )

  const nextDate = new Date(Date.now() + newInterval * 86400000)
  const nextReview = nextDate.toISOString().split('T')[0]

  return { nextReview, newEfactor, newInterval, newRepetitions }
}

export function srsIntervalLabel(quality: number, currentWord: {
  efactor: number
  interval: number
  repetitions: number
}): string {
  if (quality === 1) return '1天后'
  const result = sm2(currentWord.efactor, currentWord.interval, currentWord.repetitions, quality)
  return `${result.newInterval}天后`
}
