import { Paths, File, Directory } from 'expo-file-system'
import { TaskQueue } from '../utils/taskQueue'

const MODELS_DIR = new Directory(Paths.document, 'whisper-models')
const MIRROR = 'https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/'

export interface WhisperModel {
  name: string
  url: string
  size: string
}

export const WHISPER_MODELS: WhisperModel[] = [
  { name: 'tiny', url: `${MIRROR}ggml-tiny.bin`, size: '75MB' },
  { name: 'small', url: `${MIRROR}ggml-small.bin`, size: '466MB' },
  { name: 'large-v3', url: `${MIRROR}ggml-large-v3.bin`, size: '3.1GB' },
]

const downloadQueue = new TaskQueue(1)

export async function getModelPath(name: string): Promise<string | null> {
  try {
    const file = new File(MODELS_DIR, `ggml-${name}.bin`)
    return file.exists ? file.uri : null
  } catch {
    return null
  }
}

export async function downloadModel(
  name: string,
  onProgress?: (progress: number) => void
): Promise<string> {
  const model = WHISPER_MODELS.find((m) => m.name === name)
  if (!model) throw new Error(`Unknown model: ${name}`)

  MODELS_DIR.create({ intermediates: true, idempotent: true })
  const dest = new File(MODELS_DIR, `ggml-${name}.bin`)

  return downloadQueue.enqueue(async () => {
    const task = File.createDownloadTask(model.url, dest, {
      onProgress: ({ bytesWritten, totalBytes }) => {
        const pct = totalBytes ? bytesWritten / totalBytes : 0
        onProgress?.(Math.round(pct * 100))
      },
    })
    const result = await task.downloadAsync()
    if (!result) throw new Error(`Download failed for ${name}`)
    return result.uri
  })
}

export async function deleteModel(name: string): Promise<void> {
  try {
    const file = new File(MODELS_DIR, `ggml-${name}.bin`)
    if (file.exists) file.delete()
  } catch (error) {
    console.error('Failed to delete model:', error)
    throw error
  }
}

export async function getFirstModelPath(): Promise<string | null> {
  try {
    const models = await listDownloadedModels()
    if (models.length === 0) return null
    return await getModelPath(models[0])
  } catch {
    return null
  }
}

export async function listDownloadedModels(): Promise<string[]> {
  try {
  MODELS_DIR.create({ intermediates: true, idempotent: true })
    const entries = MODELS_DIR.list()
    return entries
      .filter((e): e is File => e instanceof File)
      .filter((f) => f.name.startsWith('ggml-') && f.name.endsWith('.bin'))
      .map((f) => f.name.replace('ggml-', '').replace('.bin', ''))
  } catch {
    return []
  }
}
