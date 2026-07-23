export interface Word {
  id: number
  word: string
  definition: string
  phonetic: string
  example: string
  tags: string
  level: number
  next_review: string
  created_at: string
  updated_at: string
}

export interface Tag {
  id: number
  name: string
  color: string
}

export interface SubtitleItem {
  id: number
  startTime: number
  endTime: number
  text: string
}

export interface WhisperProgress {
  progress: number
  status: string
}

export interface WhisperStatus {
  loaded: boolean
  loading: boolean
  model: string
}

export interface DictTag {
  tag: string
  count: number
}

export interface DictWord {
  word: string
  phonetic: string
  translation: string
  definition: string
  pos: string
  tag: string
}

export interface DictAddResult {
  added: number
  skipped: number
}

export interface ElectronAPI {
  openFile: (filters?: { name: string; extensions: string[] }[]) => Promise<string | null>
  saveFile: (defaultName: string) => Promise<string | null>
  openSubtitle: () => Promise<string | null>
  readTextFile: (path: string) => Promise<string>
  writeTextFile: (path: string, content: string) => Promise<void>

  dbWordsList: () => Promise<Word[]>
  dbWordsAdd: (word: Omit<Word, 'id' | 'created_at' | 'updated_at'>) => Promise<number>
  dbWordsUpdate: (id: number, word: Partial<Word>) => Promise<void>
  dbWordsDelete: (id: number) => Promise<void>
  dbWordsDeleteBatch: (ids: number[]) => Promise<void>
  dbWordsGetReview: () => Promise<Word[]>
  dbWordsSearch: (query: string) => Promise<Word[]>

  dbTagsList: () => Promise<Tag[]>
  dbTagsAdd: (name: string, color: string) => Promise<number>
  dbTagsDelete: (id: number) => Promise<void>

  dbExport: () => Promise<string>
  dbImport: (jsonData: string) => Promise<{ imported: number; skipped: number }>
  dbClear: () => Promise<void>

  whisperTranscribe: (filePath: string) => Promise<SubtitleItem[]>
  whisperStatus: () => Promise<WhisperStatus>
  downloadWhisperModel: (mirrorURL: string, modelName: string) => Promise<void>
  setWhisperModel: (name: string) => void
  listWhisperModels: () => Promise<{ name: string; file: string; size: string; downloaded: boolean }[]>
  getWhisperLang: () => Promise<string>
  setWhisperLang: (lang: string) => void
  onWhisperProgress: (callback: (data: WhisperProgress) => void) => () => void
  onDownloadProgress: (callback: (pct: number) => void) => () => void
  getDownloadProgress: () => Promise<string>

  recentList: () => Promise<{ path: string; name: string; subtitles?: any[] }[]>
  recentAdd: (filePath: string) => Promise<{ path: string; name: string; subtitles?: any[] }[]>
  cacheSubtitles: (filePath: string, subtitles: any[]) => Promise<void>
  getCachedSubtitles: (filePath: string) => Promise<any[] | null>
  getVideoThumbnail: (filePath: string) => Promise<string | null>

  getPlatform: () => string
  getMediaPort: () => Promise<number>

  // Dictionary
  dbDictTags: () => Promise<DictTag[]>
  dbDictWords: (tag: string) => Promise<DictWord[]>
  dbDictAddToWordList: (words: DictWord[]) => Promise<DictAddResult>
  dbDictSaveProgress: (tag: string, index: number) => Promise<void>
  dbDictGetProgress: (tag: string) => Promise<number>
}

declare global {
  interface Window {
    api: ElectronAPI
    runtime: {
      EventsOn: (event: string, callback: (...args: any[]) => void) => void
      EventsOff: (event: string, ...additionalArgs: string[]) => void
    }
  }
}
