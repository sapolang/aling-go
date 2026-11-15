// 前端类型以 Wails bindings 为唯一来源：与后端重复的结构只做 re-export，
// 不再手写维护，避免出现实现与声明漂移。
import type {
  Word,
  Tag,
  ImportResult,
  DailyReview,
  LearningStats,
  GradeCount,
  LevelCount,
  TypingDayStat,
  ExtendedStats,
  FavoriteClip,
  FavoriteTag,
  DictAddResult,
} from '../../bindings/aling-go/internal/study/models'
import type { DictTag, DictWord } from '../../bindings/aling-go/internal/dict/models'
import type {
  SubtitleItem,
  WhisperModelInfo,
  WhisperDownloadProgress,
  WhisperStatus,
  RecentEntry,
  HistoryEntry,
  HistoryUpsertInput,
  ResolvedMedia,
  LibraryFile,
  Folder,
  LibraryData,
  LibraryImportResult,
  ArticleCategory,
  ArticleItem,
  TypingProgress,
  TypingRecord,
  Feed,
  FeedEpisode,
  SubtitleCue,
  PlatformSubtitlesResult,
  ActionResult,
  FeedListResult,
  FeedEpisodesResult,
  EpisodeDownloadResult,
  BiliStreamResult,
  BiliQRLoginResult,
  PodcastTranscribeResult,
  RSSConvertResult,
  CacheEntry,
  CacheStats,
  CacheClearResult,
} from '../../bindings/aling-go/internal/content/models'
import type {
  AIConfig,
  AIConfigView,
  AIExplainResult,
  AIStreamResult,
  AITestResult,
  BackupResult,
  BackupStatus,
  UpdateInfo,
  UpdateResult,
  UpdateState,
} from '../../bindings/aling-go/internal/system/models'

export type {
  Word,
  Tag,
  ImportResult,
  DailyReview,
  LearningStats,
  GradeCount,
  LevelCount,
  TypingDayStat,
  ExtendedStats,
  FavoriteClip,
  FavoriteTag,
  DictAddResult,
  DictTag,
  DictWord,
  SubtitleItem,
  WhisperModelInfo,
  WhisperDownloadProgress,
  WhisperStatus,
  RecentEntry,
  HistoryEntry,
  HistoryUpsertInput,
  ResolvedMedia,
  LibraryFile,
  Folder,
  LibraryData,
  LibraryImportResult,
  ArticleCategory,
  ArticleItem,
  TypingProgress,
  TypingRecord,
  Feed,
  FeedEpisode,
  SubtitleCue,
  PlatformSubtitlesResult,
  ActionResult,
  FeedListResult,
  FeedEpisodesResult,
  EpisodeDownloadResult,
  BiliStreamResult,
  BiliQRLoginResult,
  PodcastTranscribeResult,
  RSSConvertResult,
  CacheEntry,
  CacheStats,
  CacheClearResult,
  AIConfig,
  AIConfigView,
  AIExplainResult,
  AIStreamResult,
  AITestResult,
  BackupResult,
  BackupStatus,
  UpdateInfo,
  UpdateResult,
  UpdateState,
}

// 旧代码沿用的命名，语义与 bindings 一致
export type PlatformSubtitleCue = SubtitleCue
export type PlatformSubtitleResult = PlatformSubtitlesResult
export type FeedActionResult = ActionResult

/** whisper:progress 事件载荷，不属于 Wails 生成模型 */
export interface WhisperProgress {
  progress: number
  status: string
}

/** 新增收藏片段时前端提供的字段，其余字段由后端按默认值补齐 */
export type FavoriteAddInput = Pick<
  FavoriteClip,
  'filePath' | 'startTime' | 'endTime' | 'text' | 'tagId' | 'word'
>

export interface ElectronAPI {
  openFile: (filters?: string | { name: string; extensions: string[] }[]) => Promise<string>
  saveFile: (defaultName: string) => Promise<string>
  openSubtitle: () => Promise<string>
  readTextFile: (path: string) => Promise<string>
  writeTextFile: (path: string, content: string) => Promise<void>

  dbWordsList: () => Promise<Word[]>
  dbWordsAdd: (word: Omit<Word, 'id' | 'created_at' | 'updated_at'>) => Promise<number>
  dbWordsUpdate: (id: number, data: Partial<Word>) => Promise<void>
  dbWordsDelete: (id: number) => Promise<void>
  dbWordsDeleteBatch: (ids: number[]) => Promise<void>
  dbWordsGetReview: () => Promise<Word[]>
  dbWordsGetReviewCount: () => Promise<number>
  dbWordsSearch: (query: string) => Promise<Word[]>

  dbTagsList: () => Promise<Tag[]>
  dbTagsAdd: (name: string, color: string) => Promise<number>
  dbTagsDelete: (id: number) => Promise<void>

  dbExport: () => Promise<string>
  dbImport: (jsonData: string) => Promise<ImportResult>
  dbClear: () => Promise<void>

  logReview: (wordID: number, quality: number) => Promise<void>
  learningStats: () => Promise<LearningStats>
  extendedStats: () => Promise<ExtendedStats>

  whisperTranscribe: (filePath: string) => Promise<SubtitleItem[]>
  whisperStatus: () => Promise<WhisperStatus>
  downloadWhisperModel: (modelName: string) => Promise<void>
  setWhisperModel: (name: string) => Promise<void>
  listWhisperModels: () => Promise<WhisperModelInfo[]>
  getWhisperLang: () => Promise<string>
  setWhisperLang: (lang: string) => Promise<void>
  onWhisperProgress: (callback: (data: WhisperProgress) => void) => () => void
  onDownloadProgress: (callback: (pct: number) => void) => () => void
  getDownloadProgress: () => Promise<WhisperDownloadProgress | null>

  recentList: () => Promise<RecentEntry[]>
  recentAdd: (filePath: string) => Promise<RecentEntry[]>
  recentGetPosition: (filePath: string) => Promise<number>
  recentUpdatePosition: (filePath: string, position: number) => Promise<void>

  historyUpsert: (entry: HistoryUpsertInput) => Promise<HistoryEntry>
  historyUpdatePosition: (mediaKey: string, position: number, duration: number) => Promise<void>
  historyList: (kind: string, limit: number, offset: number) => Promise<HistoryEntry[]>
  historyContinueLearning: (limit: number) => Promise<HistoryEntry[]>
  historyGet: (mediaKey: string) => Promise<HistoryEntry>
  historyDelete: (mediaKey: string) => Promise<void>
  historyClear: () => Promise<void>
  cacheSubtitles: (filePath: string, subtitles: SubtitleItem[]) => Promise<void>
  getCachedSubtitles: (filePath: string) => Promise<SubtitleItem[] | null>
  getVideoThumbnail: (filePath: string) => Promise<string | null>
  getWaveformData: (filePath: string) => Promise<number[]>
  // 把内置播放器不支持的容器转成可播格式，返回转换后的本地路径
  transcodeForPlayback: (filePath: string) => Promise<string>

  getPlatform: () => Promise<string>
  getVersion: () => Promise<string>
  getMediaPort: () => Promise<number>
  resolveMediaURL: (url: string) => Promise<ResolvedMedia>

  // Dictionary
  dbDictTags: () => Promise<DictTag[]>
  dbDictWords: (tag: string) => Promise<DictWord[]>
  dbDictAddToWordList: (words: DictWord[]) => Promise<DictAddResult>
  dbDictSaveProgress: (tag: string, index: number) => Promise<void>
  dbDictGetProgress: (tag: string) => Promise<number>
  dbDictLookup: (word: string) => Promise<DictWord | null>
  dbDictSearch: (query: string, limit?: number) => Promise<DictWord[]>

  libraryList: () => Promise<LibraryData>
  libraryImport: (category: string, folderId: string) => Promise<LibraryImportResult>
  libraryImportPaths: (paths: string[], folderId: string) => Promise<LibraryImportResult>
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
  saveTypingProgress: (progress: Omit<TypingProgress, 'updatedAt'>) => Promise<void>
  getTypingRecords: (articleId: number) => Promise<TypingRecord[]>
  saveTypingRecord: (record: Omit<TypingRecord, 'id' | 'createdAt'>) => Promise<void>
  getAllTypingProgress: () => Promise<TypingProgress[]>
  addWordsBatch: (words: Pick<Word, 'word' | 'definition' | 'phonetic'>[]) => Promise<number>

  // Podcast feeds
  feedList: () => Promise<FeedListResult>
  feedAdd: (url: string) => Promise<ActionResult>
  feedRemove: (id: number, deleteDownloads: boolean) => Promise<ActionResult>
  feedRefresh: (id: number) => Promise<ActionResult>
  feedEpisodes: (id: number, limit: number) => Promise<FeedEpisodesResult>
  episodeDownload: (id: number) => Promise<EpisodeDownloadResult>
  feedGetProxy: () => Promise<string>
  feedSetProxy: (proxy: string) => Promise<ActionResult>
  feedGetBilibiliCookie: () => Promise<string>
  feedSetBilibiliCookie: (cookie: string) => Promise<ActionResult>
  getBilibiliStream: (bvid: string) => Promise<BiliStreamResult>
  feedStartBilibiliQRLogin: () => Promise<BiliQRLoginResult>
  feedPollBilibiliQRLogin: (key: string) => Promise<BiliQRLoginResult>
  feedOnProgress: (cb: (data: { episodeId: number; pct: number }) => void) => () => void

  // Platform helpers (YouTube / Bilibili)
  platformConvertToRSS: (url: string) => Promise<RSSConvertResult>
  platformGetRSSHubURL: () => Promise<string>
  platformSetRSSHubURL: (u: string) => Promise<ActionResult>
  platformGetSubtitles: (episodeId: number) => Promise<PlatformSubtitlesResult>
  platformGetSubtitlesBySource: (
    sourceKind: string,
    videoID: string,
  ) => Promise<PlatformSubtitlesResult>
  platformTranscribePodcast: (episodeId: number, force: boolean) => Promise<PodcastTranscribeResult>

  // Favorites
  favoriteList: (tagId: number) => Promise<FavoriteClip[]>
  favoriteAdd: (clip: FavoriteAddInput) => Promise<number>
  favoriteDelete: (id: number) => Promise<void>
  favoriteUpdateTag: (id: number, tagId: number) => Promise<void>
  favoriteReview: (id: number, rating: number) => Promise<void>
  favoriteTagsList: () => Promise<FavoriteTag[]>
  favoriteTagAdd: (name: string) => Promise<number>
  favoriteTagDelete: (id: number) => Promise<void>

  // AI
  aiGetConfig: () => Promise<AIConfigView>
  aiSetConfig: (cfg: AIConfig) => Promise<ActionResult>
  aiTest: () => Promise<AITestResult>
  aiTranslateStream: (text: string, context: string, reqId: string) => Promise<AIStreamResult>
  aiExplain: (text: string, context: string) => Promise<AIExplainResult>
  aiOnChunk: (cb: (data: { reqId: string; delta: string }) => void) => () => void
  aiOnDone: (cb: (data: { reqId: string; text?: string; error?: string }) => void) => () => void

  // Backup
  backupNow: () => Promise<BackupResult>
  getBackupStatus: () => Promise<BackupStatus>

  // Cache
  cacheStats: () => Promise<CacheStats>
  clearCache: (kind: string) => Promise<CacheClearResult>
  clearAllCaches: () => Promise<CacheClearResult>

  // Updater
  checkUpdate: () => Promise<UpdateInfo>
  getUpdateState: () => Promise<UpdateState>
  downloadUpdate: () => Promise<UpdateResult>
  applyUpdate: () => Promise<UpdateResult>
  updateOnProgress: (cb: (pct: number) => void) => () => void
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
