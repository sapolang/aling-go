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
  { name: 'tiny.en', url: `${MIRROR}ggml-tiny.en-q5_1.bin`, size: '32MB' },
  { name: 'tiny', url: `${MIRROR}ggml-tiny-q5_1.bin`, size: '32MB' },
  { name: 'base', url: `${MIRROR}ggml-base-q5_1.bin`, size: '60MB' },
  { name: 'small', url: `${MIRROR}ggml-small-q5_1.bin`, size: '190MB' },
  { name: 'large-v3', url: `${MIRROR}ggml-large-v3-q5_0.bin`, size: '1.1GB' },
]

const QUANT_SUFFIX: Record<string, string> = {
  'tiny.en': 'q5_1',
  tiny: 'q5_1',
  base: 'q5_1',
  small: 'q5_1',
  'large-v3': 'q5_0',
}

function modelFilename(name: string): string {
  return `ggml-${name}-${QUANT_SUFFIX[name]}.bin`
}

const downloadQueue = new TaskQueue(1)

export async function getModelPath(name: string): Promise<string | null> {
  try {
    const file = new File(MODELS_DIR, modelFilename(name))
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
  const dest = new File(MODELS_DIR, modelFilename(name))

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
    const file = new File(MODELS_DIR, modelFilename(name))
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
    const suffixMap = Object.entries(QUANT_SUFFIX)
    return entries
      .filter((e): e is File => e instanceof File)
      .flatMap((f) => {
        for (const [name, suffix] of suffixMap) {
          if (f.name === `ggml-${name}-${suffix}.bin`) return [name]
        }
        return []
      })
  } catch {
    return []
  }
}
