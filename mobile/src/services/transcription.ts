import { initWhisper } from 'whisper.rn'
import { Platform } from 'react-native'
import { File } from 'expo-file-system'
import { extractAudioFromVideo } from './audioExtractor'
import { SubtitleItem } from '../types'

export interface TranscriptionProgress {
  progress: number
  status: string
}

export interface TranscribeOptions {
  language?: string
  nProcessors?: number
  onProgress?: (p: TranscriptionProgress) => void
  onChunkReady?: (subs: SubtitleItem[], chunkIndex: number, chunkTotal: number) => void
}

const NEEDS_EXTRACTION_EXTS = new Set([
  '.mp4', '.mov', '.m4v', '.mkv', '.avi', '.webm', '.flv', '.3gp',
  '.mp3', '.m4a', '.aac', '.ogg', '.flac', '.wma', '.aiff', '.aif',
])

const CHUNK_DURATION_MS = 30000
const OVERLAP_MS = 1000
const IS_IOS = (Platform.OS as string) === 'ios'

function isVideo(path: string): boolean {
  const ext = path.substring(path.lastIndexOf('.')).toLowerCase()
  return NEEDS_EXTRACTION_EXTS.has(ext)
}

function getCPUCount(): number {
  if (IS_IOS) return 1
  try {
    // @ts-ignore - undocumented RN API, falls back to default
    const count = require('react-native').default.Systrace?.cputCount
    if (typeof count === 'number' && count > 0) return count
  } catch {}
  return 4
}

function toPlainPath(uri: string): string {
  if (uri.startsWith('file://')) {
    return decodeURIComponent(uri.slice(7))
  }
  return uri
}

async function getWavDurationMs(wavUri: string): Promise<number> {
  const file = new File(wavUri)
  if (!file.exists || !file.size) throw new Error('WAV file not found')
  const dataSize = file.size - 44
  return (dataSize / 32000) * 1000
}

export async function transcribeAudio(
  filePath: string,
  modelPath: string,
  options: TranscribeOptions = {}
): Promise<SubtitleItem[]> {
  const {
    language = 'auto',
    nProcessors = Math.max(getCPUCount(), 4),
    onProgress,
  } = options

  let audioPath = filePath

  if (isVideo(filePath)) {
    onProgress?.({ progress: 0, status: 'extracting' })
    audioPath = await extractAudioFromVideo(filePath)
  }

  const ctx = await initWhisper({
    filePath: modelPath,
  })
  try {
    onProgress?.({ progress: 0, status: 'transcribing' })

    const { promise } = ctx.transcribe(toPlainPath(audioPath), {
      language,
      translate: false,
      nProcessors,
      beamSize: 1,
      onProgress: (p) => onProgress?.({ progress: p, status: 'transcribing' }),
    })
    const result = await promise

    const segments: SubtitleItem[] = result.segments.map((seg, i) => ({
      id: i,
      startTime: seg.t0 / 100,
      endTime: seg.t1 / 100,
      text: seg.text.trim(),
    }))

    onProgress?.({ progress: 100, status: 'done' })

    return segments
  } finally {
    try { await ctx.release() } catch {}
  }
}

export async function transcribeAudioStreaming(
  filePath: string,
  modelPath: string,
  options: TranscribeOptions = {}
): Promise<SubtitleItem[]> {
  const {
    language = 'auto',
    nProcessors = Math.max(getCPUCount(), 4),
    onProgress,
    onChunkReady,
  } = options

  let audioPath = filePath

  if (isVideo(filePath)) {
    onProgress?.({ progress: 0, status: 'extracting' })
    audioPath = await extractAudioFromVideo(filePath)
  }

  const totalDurationMs = await getWavDurationMs(audioPath)

  if (true) {
    return transcribeAudio(filePath, modelPath, { language, nProcessors, onProgress })
  }

  const chunkStep = CHUNK_DURATION_MS - OVERLAP_MS
  const numChunks = Math.ceil(totalDurationMs / chunkStep)

  const ctx = await initWhisper({
    filePath: modelPath,
  })

  try {
    const allSegments: SubtitleItem[] = []
    let nextId = 0

    for (let i = 0; i < numChunks; i++) {
      const chunkStartMs = i * chunkStep
      const chunkLenMs = Math.min(CHUNK_DURATION_MS, totalDurationMs - chunkStartMs)

      onProgress?.({
        progress: (i / numChunks) * 100,
        status: 'transcribing',
      })

      const chunkStartSec = chunkStartMs / 1000

      const { promise } = ctx.transcribe(toPlainPath(audioPath), {
        language,
        translate: false,
        nProcessors,
        beamSize: 1,
        offset: chunkStartMs,
        duration: chunkLenMs,
        onProgress: (p) => {
          // per-chunk progress updates — scale to overall progress
          const chunkProgress = Math.min(p, 100)
          const overallProgress = ((i + chunkProgress / 100) / numChunks) * 100
          onProgress?.({ progress: overallProgress, status: 'transcribing' })
        },
      })

      const result = await promise

      const segments: SubtitleItem[] = result.segments
        .map((seg) => ({
          id: 0,
          startTime: chunkStartSec + seg.t0 / 100,
          endTime: chunkStartSec + seg.t1 / 100,
          text: seg.text.trim(),
        }))
        .filter((seg) => {
          if (allSegments.length === 0) return true
          const lastEnd = allSegments[allSegments.length - 1].endTime
          return seg.startTime >= lastEnd
        })

      for (const seg of segments) {
        allSegments.push({ ...seg, id: nextId++ })
      }

      onChunkReady?.(allSegments, i + 1, numChunks)
    }

    onProgress?.({ progress: 100, status: 'done' })

    return allSegments
  } finally {
    try { await ctx.release() } catch {}
  }
}
