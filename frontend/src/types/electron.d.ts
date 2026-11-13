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
  repetitions: number
  efactor: number
  interval: number
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

export interface RecentEntry {
  path: string
  name: string
  type: string
  lastPosition?: number
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

export interface LibraryFile {
  path: string
  name: string
  type: 'video' | 'audio' | 'pdf'
  folderId: string
  addedAt: string
}

export interface Folder {
  id: string
  name: string
  createdAt: string
  parentId: string
}

export interface LibraryData {
  folders: Folder[]
  files: LibraryFile[]
}

export interface LibraryImportResult {
  files: LibraryFile[]
  imported: number
  skipped: number
  dropped: number
}

export interface ArticleCategory {
  id: number
  enName: string
  name: string
  description: string
  cover: string
  length: number
}

export interface ArticleItem {
  id: number
  categoryEnName: string
  title: string
  titleTranslate: string
  text: string
  textTranslate: string
  audioSrc: string
  lrcPosition: string
  questionJson: string
  indexOrder: number
}

export interface TypingProgress {
  articleId: number
  mode: string
  position: number
  completed: boolean
  bestAccuracy: number
  bestWpm: number
  updatedAt: string
}

export interface TypingRecord {
  id: number
  articleId: number
  mode: string
  accuracy: number
  wpm: number
  duration: number
  mistakes: string
  createdAt: string
}

export interface DailyReview {
  date: string
  count: number
}

export interface LearningStats {
  totalReviews: number
  todayReviews: number
  streak: number
  totalWords: number
  mastered: number
  daily: DailyReview[]
}

export interface GradeCount {
  grade: number
  count: number
}

export interface LevelCount {
  level: number
  count: number
}

export interface TypingDayStat {
  date: string
  count: number
  avgAccuracy: number
  avgWpm: number
  totalDuration: number
}

export interface ExtendedStats {
  gradeDistribution: GradeCount[]
  levelDistribution: LevelCount[]
  typingDaily: TypingDayStat[]
}

export interface ElectronAPI {
  openFile: (filters?: string | { name: string; extensions: string[] }[]) => Promise<string | null>
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
  dbWordsGetReviewCount: () => Promise<number>
  dbWordsSearch: (query: string) => Promise<Word[]>

  dbTagsList: () => Promise<Tag[]>
  dbTagsAdd: (name: string, color: string) => Promise<number>
  dbTagsDelete: (id: number) => Promise<void>

  dbExport: () => Promise<string>
  dbImport: (jsonData: string) => Promise<{ imported: number; skipped: number }>
  dbClear: () => Promise<void>

  logReview: (wordID: number, quality: number) => Promise<void>
  learningStats: () => Promise<LearningStats>
  extendedStats: () => Promise<ExtendedStats>

  whisperTranscribe: (filePath: string) => Promise<SubtitleItem[]>
  whisperStatus: () => Promise<WhisperStatus>
  downloadWhisperModel: (mirrorURL: string, modelName: string) => Promise<void>
  setWhisperModel: (name: string) => void
  listWhisperModels: () => Promise<
    { name: string; file: string; size: string; downloaded: boolean }[]
  >
  getWhisperLang: () => Promise<string>
  setWhisperLang: (lang: string) => void
  onWhisperProgress: (callback: (data: WhisperProgress) => void) => () => void
  onDownloadProgress: (callback: (pct: number) => void) => () => void
  getDownloadProgress: () => Promise<string>

  recentList: () => Promise<RecentEntry[]>
  recentAdd: (filePath: string) => Promise<RecentEntry[]>
  cacheSubtitles: (filePath: string, subtitles: SubtitleItem[]) => Promise<void>
  getCachedSubtitles: (filePath: string) => Promise<SubtitleItem[]>
  getVideoThumbnail: (filePath: string) => Promise<string | null>
  getWaveformData: (filePath: string) => Promise<number[]>
  // 把内置播放器不支持的容器转成可播格式，返回转换后的本地路径
  transcodeForPlayback: (filePath: string) => Promise<string>

  getPlatform: () => string
  getMediaPort: () => Promise<number>

  // Dictionary
  dbDictTags: () => Promise<DictTag[]>
  dbDictWords: (tag: string) => Promise<DictWord[]>
  dbDictAddToWordList: (words: DictWord[]) => Promise<DictAddResult>
  dbDictSaveProgress: (tag: string, index: number) => Promise<void>
  dbDictGetProgress: (tag: string) => Promise<number>
  dbDictSearch: (query: string, limit?: number) => Promise<DictWord[]>

  libraryList: () => Promise<LibraryData>
  libraryImport: (category: string, folderId: string) => Promise<LibraryImportResult>
  libraryRemove: (paths: string[]) => Promise<LibraryFile[]>
  libraryRename: (path: string, newName: string) => Promise<LibraryData>
  libraryMove: (paths: string[], folderId: string) => Promise<LibraryFile[]>
  folderCreate: (name: string, parentId: string) => Promise<Folder[]>
  folderDelete: (id: string) => Promise<Folder[]>
  folderRename: (id: string, name: string) => Promise<Folder[]>

  openExternal: (path: string) => Promise<void>

  // Articles
  getCategories: () => Promise<ArticleCategory[]>
  getArticles: (categoryEnName: string) => Promise<ArticleItem[]>
  getArticle: (id: number) => Promise<ArticleItem | null>
  getTypingProgress: (articleId: number, mode: string) => Promise<TypingProgress | null>
  saveTypingProgress: (progressJson: string) => Promise<void>
  getTypingRecords: (articleId: number) => Promise<TypingRecord[]>
  saveTypingRecord: (recordJson: string) => Promise<void>
  getAllTypingProgress: () => Promise<TypingProgress[]>
  addWordsBatch: (wordsJson: string) => Promise<number>

  // Podcast feeds
  feedList: () => Promise<{ feeds: Feed[] }>
  feedAdd: (url: string) => Promise<FeedActionResult>
  feedRemove: (id: number) => Promise<FeedActionResult>
  feedRefresh: (id: number) => Promise<FeedActionResult>
  feedEpisodes: (id: number, limit: number) => Promise<{ episodes: FeedEpisode[] }>
  episodeDownload: (id: number) => Promise<{ ok: boolean; error: string; path: string }>
  feedGetProxy: () => Promise<string>
  feedSetProxy: (proxy: string) => Promise<FeedActionResult>
  feedGetBilibiliCookie: () => Promise<string>
  feedSetBilibiliCookie: (cookie: string) => Promise<FeedActionResult>
  getBilibiliStream: (bvid: string) => Promise<{
    ok: boolean
    url: string
    quality: number
    qualityLabel: string
    duration: number
    title: string
    error?: string
  }>
  feedStartBilibiliQRLogin: () => Promise<{
    ok: boolean
    url?: string
    key?: string
    error?: string
  }>
  feedPollBilibiliQRLogin: (key: string) => Promise<{
    ok: boolean
    url?: string
    key?: string
    status?: string
    message?: string
    error?: string
  }>
  feedOnProgress: (cb: (data: { episodeId: number; pct: number }) => void) => () => void

  // Platform helpers (YouTube / Bilibili)
  platformConvertToRSS: (
    url: string,
  ) => Promise<{ ok: boolean; rssUrl?: string; platform?: string; error?: string }>
  platformGetRSSHubURL: () => Promise<string>
  platformSetRSSHubURL: (u: string) => Promise<FeedActionResult>
  platformGetSubtitles: (episodeId: number) => Promise<PlatformSubtitleResult>
  platformTranscribePodcast: (
    episodeId: number,
    force: boolean,
  ) => Promise<{
    ok: boolean
    subtitles?: SubtitleItem[]
    cached?: boolean
    error?: string
  }>
}

export interface Feed {
  id: number
  url: string
  title: string
  description: string
  image: string
  siteUrl: string
  lastFetchedAt: string
  lastError: string
  episodeCount: number
}

export interface FeedEpisode {
  id: number
  feedId: number
  title: string
  description: string
  audioUrl: string
  link: string
  duration: number
  publishedAt: string
  localPath: string
}

export interface FeedActionResult {
  ok: boolean
  error: string
  message: string
}

export interface PlatformSubtitleCue {
  start: number
  end: number
  text: string
}

export interface PlatformSubtitleResult {
  ok: boolean
  platform?: string
  videoId?: string
  title?: string
  cues?: PlatformSubtitleCue[]
  error?: string
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
