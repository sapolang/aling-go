import { initWhisper } from 'whisper.rn'
import AudioExtractor from 'audio-extractor'
import { SubtitleItem } from '../types'

export interface TranscriptionProgress {
  progress: number
  status: string
}

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.m4v', '.mkv', '.avi', '.webm', '.flv', '.3gp'])

function isVideo(path: string): boolean {
  const ext = path.substring(path.lastIndexOf('.')).toLowerCase()
  return VIDEO_EXTS.has(ext)
}

export async function transcribeAudio(
  filePath: string,
  modelPath: string,
  language: string,
  onProgress?: (p: TranscriptionProgress) => void
): Promise<SubtitleItem[]> {
  let audioPath = decodeURIComponent(filePath.replace(/^file:\/\//, ''))
  if (isVideo(filePath)) {
    onProgress?.({ progress: 0, status: 'extracting' })
    audioPath = await AudioExtractor.extractAudio(audioPath)
  }

  const ctx = await initWhisper({ filePath: modelPath })
  try {
    onProgress?.({ progress: 0, status: 'transcribing' })

    const { promise } = ctx.transcribe(audioPath, {
      language: language || 'auto',
      translate: true,
      nProcessors: 1,
    })
    const result = await promise

    const segments = result.segments.map((seg, i) => ({
      id: i,
      startTime: seg.t0 / 100,
      endTime: seg.t1 / 100,
      text: seg.text.trim(),
    }))

    onProgress?.({ progress: 100, status: 'done' })

    return segments
  } finally {
    await ctx.release()
  }
}
