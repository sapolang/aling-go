declare module 'whisper.rn' {
  interface TranscribeOptions {
    language?: string
    translate?: boolean
    maxThreads?: number
    nProcessors?: number
    maxContext?: number
    maxLen?: number
    tokenTimestamps?: boolean
    tdrzEnable?: boolean
    wordThold?: number
    offset?: number
    duration?: number
    temperature?: number
    temperatureInc?: number
    beamSize?: number
    bestOf?: number
    prompt?: string
  }

  interface TranscribeResult {
    result: string
    segments: Array<{ text: string; t0: number; t1: number }>
    isAborted: boolean
  }

  interface TranscribeFileOptions extends TranscribeOptions {
    onProgress?: (progress: number) => void
    onNewSegments?: (result: { nNew: number; totalNNew: number; result: string; segments: TranscribeResult['segments'] }) => void
  }

  class WhisperContext {
    id: number
    gpu: boolean
    reasonNoGPU: string
    transcribe(filePath: string, options?: TranscribeFileOptions): {
      stop: () => Promise<void>
      promise: Promise<TranscribeResult>
    }
    release(): Promise<void>
  }

  interface ContextOptions {
    filePath: string
    isBundleAsset?: boolean
    useCoreMLIos?: boolean
    useGpu?: boolean
    useFlashAttn?: boolean
  }

  export function initWhisper(options: ContextOptions): Promise<WhisperContext>
  export function releaseAllWhisper(): Promise<void>
}
