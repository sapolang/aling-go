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

export interface WhisperStatus {
  loaded: boolean
  loading: boolean
  model: string | null
}

export interface DictWord {
  word: string
  phonetic: string
  translation: string
  definition: string
  pos: string
  tag: string
}

export interface DictTag {
  tag: string
  count: number
}
