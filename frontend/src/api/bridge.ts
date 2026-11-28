import {
  OpenFile,
  SaveFile,
  OpenSubtitle,
  ReadTextFile,
  WriteTextFile,
  GetPlatform,
  GetVersion,
  OpenExternal,
} from '../../bindings/aling-go/internal/system/platformservice'

import {
  DbWordsList,
  DbWordsAdd,
  DbWordsUpdate,
  DbWordsDelete,
  DbWordsDeleteBatch,
  DbWordsGetReview,
  DbWordsGetReviewCount,
  DbWordsSearch,
  DbTagsList,
  DbTagsAdd,
  DbTagsDelete,
  DbExport,
  DbImport,
  DbClear,
  AddWordsBatch,
  LogReview,
  GetLearningStats,
  GetExtendedStats,
} from '../../bindings/aling-go/internal/study/wordservice'

import {
  GetCategories,
  GetArticles,
  GetArticle,
  GetTypingProgress,
  SaveTypingProgress,
  GetTypingRecords,
  SaveTypingRecord,
  GetAllTypingProgress,
} from '../../bindings/aling-go/internal/content/articleservice'

import {
  DbDictTags,
  DbDictWords,
  DbDictAddToWordList,
  DbDictSaveProgress,
  DbDictGetProgress,
  DbDictLookup,
  DbDictSearch,
} from '../../bindings/aling-go/internal/study/dictservice'

import {
  LibraryList,
  LibraryImport,
  LibraryImportPaths,
  LibraryRemove,
  LibraryRename,
  LibraryMove,
  FolderCreate,
  FolderDelete,
  FolderRename,
  RecentList,
  RecentAdd,
  RecentGetPosition,
  RecentUpdatePosition,
  CacheSubtitles,
  GetCachedSubtitles,
} from '../../bindings/aling-go/internal/content/libraryservice'

import {
  PDFImport,
  PDFList,
  PDFLoad,
  PDFReadFile,
  PDFRemove,
  PDFUpdateProgress,
} from '../../bindings/aling-go/internal/content/pdfservice'

import {
  InstallLocalTTS,
  SynthesizeSentence,
  TTSStatus,
} from '../../bindings/aling-go/internal/tts/service'

import {
  GetWaveformData,
  GetMediaPort,
  GetBilibiliStream,
  TranscodeForPlayback,
  ResolveMediaURL,
} from '../../bindings/aling-go/internal/content/mediaservice'

import {
  Upsert as HistoryUpsert,
  UpdatePosition as HistoryUpdatePosition,
  List as HistoryList,
  ContinueLearning as HistoryContinueLearning,
  Get as HistoryGet,
  Delete as HistoryDelete,
  Clear as HistoryClear,
} from '../../bindings/aling-go/internal/content/historyservice'
import type { HistoryUpsertInput } from '../../bindings/aling-go/internal/content/models'
import type { ElectronAPI } from '../types/api'

import {
  FeedList,
  FeedAdd,
  FeedRemove,
  FeedRefresh,
  FeedEpisodes,
  EpisodeDownload,
  GetProxy as FeedGetProxy,
  SetProxy as FeedSetProxy,
  GetBilibiliCookie as FeedGetBilibiliCookie,
  SetBilibiliCookie as FeedSetBilibiliCookie,
  StartBilibiliQRLogin as FeedStartBilibiliQRLogin,
  PollBilibiliQRLogin as FeedPollBilibiliQRLogin,
} from '../../bindings/aling-go/internal/content/feedservice'

import {
  ConvertToRSS as PlatformConvertToRSS,
  GetRSSHubURL,
  SetRSSHubURL,
  GetSubtitles,
  GetSubtitlesBySource,
  TranscribeBySource as PlatformTranscribeBySource,
  WarmAudio as PlatformWarmAudio,
  TranscribePodcast as PlatformTranscribePodcast,
} from '../../bindings/aling-go/internal/content/platformservice'

import {
  Transcribe,
  WhisperStatus,
  DownloadWhisperModel,
  SetWhisperModel,
  ListWhisperModels,
  GetWhisperLang,
  SetWhisperLang,
  GetDownloadProgress,
} from '../../bindings/aling-go/internal/content/whisperservice'

import {
  GetAIConfig,
  SetAIConfig,
  TestAIConnection,
  TranslateStream,
  Explain,
} from '../../bindings/aling-go/internal/system/aiservice'

import {
  FavoriteList,
  FavoriteAdd,
  FavoriteDelete,
  FavoriteUpdateTag,
  FavoriteReview,
  FavoriteTagsList,
  FavoriteTagAdd,
  FavoriteTagDelete,
} from '../../bindings/aling-go/internal/study/favoriteservice'

import { BackupNow, GetBackupStatus } from '../../bindings/aling-go/internal/system/backupservice'
import {
  GetCacheStats,
  ClearCache,
  ClearAllCaches,
} from '../../bindings/aling-go/internal/content/cacheservice'
import type { SubtitleItem } from '../../bindings/aling-go/internal/content/models'
import {
  ApplyUpdate,
  CheckForUpdate,
  DownloadLatest,
  GetUpdateState,
} from '../../bindings/aling-go/internal/system/updateservice'
import { Events } from '@wailsio/runtime'

export function initBridge(): void {
  const api: ElectronAPI = {
    openFile: (filters?: any) => OpenFile(filters || ''),
    saveFile: (name: string) => SaveFile(name),
    openSubtitle: () => OpenSubtitle(),
    readTextFile: (path: string) => ReadTextFile(path),
    writeTextFile: (path: string, content: string) => WriteTextFile(path, content),

    // bindings 以 interface 模式生成时，Go 切片返回类型为 T[] | null；这里统一归一化为空数组
    dbWordsList: () => DbWordsList().then((rows) => rows ?? []),
    dbWordsAdd: (word: any) => DbWordsAdd(word),
    dbWordsUpdate: (id: number, data: any) => DbWordsUpdate(id, data),
    dbWordsDelete: (id: number) => DbWordsDelete(id),
    dbWordsDeleteBatch: (ids: number[]) => DbWordsDeleteBatch(ids),
    dbWordsGetReview: () => DbWordsGetReview().then((rows) => rows ?? []),
    dbWordsGetReviewCount: () => DbWordsGetReviewCount(),
    dbWordsSearch: (query: string) => DbWordsSearch(query).then((rows) => rows ?? []),

    dbTagsList: () => DbTagsList().then((rows) => rows ?? []),
    dbTagsAdd: (name: string, color: string) => DbTagsAdd(name, color),
    dbTagsDelete: (id: number) => DbTagsDelete(id),

    dbExport: () => DbExport(),
    dbImport: (jsonStr: string) => DbImport(jsonStr),
    dbClear: () => DbClear(),

    logReview: (wordID: number, quality: number) => LogReview(wordID, quality),
    learningStats: () => GetLearningStats(),
    extendedStats: () => GetExtendedStats(),

    whisperTranscribe: (filePath: string) => Transcribe(filePath).then((subs) => subs ?? []),
    whisperStatus: () => WhisperStatus(),
    downloadWhisperModel: (modelName: string) => DownloadWhisperModel(modelName),
    setWhisperModel: (name: string) => SetWhisperModel(name),
    listWhisperModels: () => ListWhisperModels().then((models) => models ?? []),
    getWhisperLang: () => GetWhisperLang(),
    setWhisperLang: (lang: string) => SetWhisperLang(lang),
    onWhisperProgress: (cb: (data: any) => void) =>
      Events.On('whisper:progress', (e: any) => cb(e.data)),
    onWhisperSegments: (cb: (data: any) => void) =>
      Events.On('whisper:segments', (e: any) => cb(e.data)),
    onDownloadProgress: (cb: (pct: number) => void) =>
      Events.On('whisper:download-progress', (e: any) => cb(e.data)),
    getDownloadProgress: () => GetDownloadProgress(),

    recentList: () => RecentList().then((rows) => rows ?? []),
    recentAdd: (filePath: string) => RecentAdd(filePath).then((rows) => rows ?? []),
    recentGetPosition: (filePath: string) => RecentGetPosition(filePath),
    recentUpdatePosition: (filePath: string, position: number) =>
      RecentUpdatePosition(filePath, position),
    cacheSubtitles: (filePath: string, subs: SubtitleItem[]) => CacheSubtitles(filePath, subs),
    getCachedSubtitles: (filePath: string) => GetCachedSubtitles(filePath),

    historyUpsert: (entry: HistoryUpsertInput) => HistoryUpsert(entry),
    historyUpdatePosition: (mediaKey: string, position: number, duration: number) =>
      HistoryUpdatePosition(mediaKey, position, duration),
    historyList: (kind: string, limit: number, offset: number) =>
      HistoryList(kind, limit, offset).then((rows) => rows ?? []),
    historyContinueLearning: (limit: number) =>
      HistoryContinueLearning(limit).then((rows) => rows ?? []),
    historyGet: (mediaKey: string) => HistoryGet(mediaKey),
    historyDelete: (mediaKey: string) => HistoryDelete(mediaKey),
    historyClear: () => HistoryClear(),

    getWaveformData: (filePath: string) => GetWaveformData(filePath).then((data) => data ?? []),
    transcodeForPlayback: (filePath: string) => TranscodeForPlayback(filePath),
    getPlatform: () => GetPlatform(),
    getVersion: () => GetVersion(),
    getMediaPort: () => GetMediaPort(),
    resolveMediaURL: (url: string) => ResolveMediaURL(url),

    feedList: () => FeedList().then((r) => ({ ...r, feeds: r.feeds ?? [] })),
    feedAdd: (url: string) => FeedAdd(url),
    feedRemove: (id: number, deleteDownloads: boolean) => FeedRemove(id, deleteDownloads),
    feedRefresh: (id: number) => FeedRefresh(id),
    feedEpisodes: (id: number, limit: number, offset: number) =>
      FeedEpisodes(id, limit, offset).then((r) => ({ ...r, episodes: r.episodes ?? [] })),
    episodeDownload: (id: number) => EpisodeDownload(id),
    feedGetProxy: () => FeedGetProxy(),
    feedSetProxy: (proxy: string) => FeedSetProxy(proxy),
    feedGetBilibiliCookie: () => FeedGetBilibiliCookie(),
    feedSetBilibiliCookie: (cookie: string) => FeedSetBilibiliCookie(cookie),
    getBilibiliStream: (bvid: string, cid?: number) => GetBilibiliStream(bvid, cid || 0),
    feedStartBilibiliQRLogin: () => FeedStartBilibiliQRLogin(),
    feedPollBilibiliQRLogin: (key: string) => FeedPollBilibiliQRLogin(key),
    feedOnProgress: (cb: (data: { episodeId: number; pct: number }) => void) =>
      Events.On('feed:download-progress', (e: any) => cb(e.data)),
    platformConvertToRSS: (url: string) => PlatformConvertToRSS(url),
    platformGetRSSHubURL: () => GetRSSHubURL(),
    platformSetRSSHubURL: (u: string) => SetRSSHubURL(u),
    platformGetSubtitles: (episodeId: number) => GetSubtitles(episodeId),
    platformGetSubtitlesBySource: (sourceKind: string, videoID: string) =>
      GetSubtitlesBySource(sourceKind, videoID),
    platformTranscribeBySource: (sourceKind: string, videoID: string, force: boolean) =>
      PlatformTranscribeBySource(sourceKind, videoID, force),
    platformWarmAudio: (sourceKind: string, videoID: string) =>
      PlatformWarmAudio(sourceKind, videoID),
    platformTranscribePodcast: (episodeId: number, force: boolean) =>
      PlatformTranscribePodcast(episodeId, force),

    dbDictTags: () => DbDictTags().then((tags) => tags ?? []),
    dbDictWords: (tag: string) => DbDictWords(tag).then((words) => words ?? []),
    dbDictAddToWordList: (words: any[]) => DbDictAddToWordList(words),
    dbDictSaveProgress: (tag: string, index: number) => DbDictSaveProgress(tag, index),
    dbDictGetProgress: (tag: string) => DbDictGetProgress(tag),
    dbDictLookup: (word: string) => DbDictLookup(word),
    dbDictSearch: (query: string, limit?: number) =>
      DbDictSearch(query, limit ?? 50).then((words) => words ?? []),

    libraryList: () => LibraryList(),
    libraryImport: (category: string, folderId: string) => LibraryImport(category, folderId),
    libraryImportPaths: (paths: string[], folderId: string) => LibraryImportPaths(paths, folderId),
    libraryRemove: (paths: string[]) => LibraryRemove(paths).then((files) => files ?? []),
    libraryRename: (path: string, newName: string) => LibraryRename(path, newName),
    libraryMove: (paths: string[], folderId: string) =>
      LibraryMove(paths, folderId).then((files) => files ?? []),
    folderCreate: (name: string, parentId: string) =>
      FolderCreate(name, parentId).then((folders) => folders ?? []),
    folderDelete: (id: string) => FolderDelete(id).then((folders) => folders ?? []),
    folderRename: (id: string, name: string) =>
      FolderRename(id, name).then((folders) => folders ?? []),

    pdfImport: (path: string) => PDFImport(path),
    pdfList: () => PDFList().then((rows) => rows ?? []),
    pdfLoad: (path: string) => PDFLoad(path),
    pdfReadFile: (path: string) => PDFReadFile(path),
    pdfRemove: (path: string) => PDFRemove(path),
    pdfUpdateProgress: (path: string, sentenceIndex: number) =>
      PDFUpdateProgress(path, sentenceIndex),

    ttsSynthesize: (text: string, voice: string) => SynthesizeSentence(text, voice),
    ttsStatus: () => TTSStatus(),
    installLocalTTS: (voice: string) => InstallLocalTTS(voice),
    ttsOnInstallProgress: (cb: (data: any) => void) =>
      Events.On('tts:install-progress', (e: any) => cb(e.data)),

    openExternal: (path: string) => OpenExternal(path),

    getCategories: () => GetCategories().then((categories) => categories ?? []),
    getArticles: (categoryEnName: string) =>
      GetArticles(categoryEnName).then((articles) => articles ?? []),
    getArticle: (id: number) => GetArticle(id),
    getTypingProgress: (articleId: number, mode: string) => GetTypingProgress(articleId, mode),
    saveTypingProgress: (progress: any) => SaveTypingProgress(progress),
    getTypingRecords: (articleId: number) =>
      GetTypingRecords(articleId).then((records) => records ?? []),
    saveTypingRecord: (record: any) => SaveTypingRecord(record),
    getAllTypingProgress: () => GetAllTypingProgress().then((progress) => progress ?? []),
    addWordsBatch: (words: any[]) => AddWordsBatch(words),

    favoriteList: (tagId: number) => FavoriteList(tagId).then((clips) => clips ?? []),
    favoriteAdd: (clip: any) => FavoriteAdd(clip),
    favoriteDelete: (id: number) => FavoriteDelete(id),
    favoriteUpdateTag: (id: number, tagId: number) => FavoriteUpdateTag(id, tagId),
    favoriteReview: (id: number, rating: number) => FavoriteReview(id, rating),
    favoriteTagsList: () => FavoriteTagsList().then((tags) => tags ?? []),
    favoriteTagAdd: (name: string) => FavoriteTagAdd(name),
    favoriteTagDelete: (id: number) => FavoriteTagDelete(id),

    aiGetConfig: () => GetAIConfig(),
    aiSetConfig: (cfg: any) => SetAIConfig(cfg),
    aiTest: () => TestAIConnection(),
    aiTranslateStream: (text: string, context: string, reqId: string) =>
      TranslateStream(text, context, reqId),
    aiExplain: (text: string, context: string) => Explain(text, context),
    aiOnChunk: (cb: (data: { reqId: string; delta: string }) => void) =>
      Events.On('ai:translate:chunk', (e: any) => cb(e.data)),
    aiOnDone: (cb: (data: { reqId: string; text?: string; error?: string }) => void) =>
      Events.On('ai:translate:done', (e: any) => cb(e.data)),

    backupNow: () => BackupNow(),
    getBackupStatus: () => GetBackupStatus(),

    cacheStats: () => GetCacheStats(),
    clearCache: (kind: string) => ClearCache(kind),
    clearAllCaches: () => ClearAllCaches(),

    checkUpdate: () => CheckForUpdate(),
    getUpdateState: () => GetUpdateState(),
    downloadUpdate: () => DownloadLatest(),
    applyUpdate: () => ApplyUpdate(),
    updateOnProgress: (cb: (pct: number) => void) =>
      Events.On('wails:updater:download-progress', (e: any) => {
        const p = e?.data
        const pct = p && p.total > 0 ? Math.min(100, Math.round((p.written / p.total) * 100)) : 0
        cb(pct)
      }),
  }
  window.api = api
}
