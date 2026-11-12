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
  GetVideoThumbnail,
  GetWaveformData,
  GetMediaPort,
  GetBilibiliStream,
  TranscodeForPlayback,
} from '../../bindings/aling-go/internal/content/mediaservice'

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
  ApplyUpdate,
  CheckForUpdate,
  DownloadLatest,
} from '../../bindings/aling-go/internal/system/updateservice'
import { Events } from '@wailsio/runtime'

export function initBridge(): void {
  window.api = {
    openFile: (filters?: any) => OpenFile(filters || ''),
    saveFile: (name: string) => SaveFile(name),
    openSubtitle: () => OpenSubtitle(),
    readTextFile: (path: string) => ReadTextFile(path),
    writeTextFile: (path: string, content: string) => WriteTextFile(path, content),

    dbWordsList: () => DbWordsList(),
    dbWordsAdd: (word: any) => DbWordsAdd(JSON.stringify(word)),
    dbWordsUpdate: (id: number, data: any) => DbWordsUpdate(id, JSON.stringify(data)),
    dbWordsDelete: (id: number) => DbWordsDelete(id),
    dbWordsDeleteBatch: (ids: number[]) => DbWordsDeleteBatch(ids),
    dbWordsGetReview: () => DbWordsGetReview(),
    dbWordsGetReviewCount: () => DbWordsGetReviewCount(),
    dbWordsSearch: (query: string) => DbWordsSearch(query),

    dbTagsList: () => DbTagsList(),
    dbTagsAdd: (name: string, color: string) => DbTagsAdd(name, color),
    dbTagsDelete: (id: number) => DbTagsDelete(id),

    dbExport: () => DbExport(),
    dbImport: (jsonStr: string) => DbImport(jsonStr),
    dbClear: () => DbClear(),

    logReview: (wordID: number, quality: number) => LogReview(wordID, quality),
    learningStats: () => GetLearningStats().then((s: string) => JSON.parse(s)),
    extendedStats: () => GetExtendedStats().then((s: string) => JSON.parse(s)),

    whisperTranscribe: (filePath: string) =>
      Transcribe(filePath).then((s: string) => {
        const parsed = JSON.parse(s)
        return Array.isArray(parsed) ? parsed : []
      }),
    whisperStatus: () => WhisperStatus(),
    downloadWhisperModel: (modelName: string) => DownloadWhisperModel(modelName),
    setWhisperModel: (name: string) => SetWhisperModel(name),
    listWhisperModels: () => ListWhisperModels().then((s: string) => JSON.parse(s)),
    getWhisperLang: () => GetWhisperLang(),
    setWhisperLang: (lang: string) => SetWhisperLang(lang),
    onWhisperProgress: (cb: (data: any) => void) => {
      Events.On('whisper:progress', (e: any) => cb(e.data))
      return () => Events.Off('whisper:progress')
    },
    onDownloadProgress: (cb: (pct: number) => void) => {
      Events.On('whisper:download-progress', (e: any) => cb(e.data))
      return () => Events.Off('whisper:download-progress')
    },
    getDownloadProgress: () => GetDownloadProgress(),

    recentList: () => RecentList().then((s: string) => JSON.parse(s)),
    recentAdd: (filePath: string) => RecentAdd(filePath).then((s: string) => JSON.parse(s)),
    recentGetPosition: (filePath: string) =>
      RecentGetPosition(filePath).then((s: string) => {
        const n = JSON.parse(s)
        return typeof n === 'number' ? n : 0
      }),
    recentUpdatePosition: (filePath: string, position: number) =>
      RecentUpdatePosition(filePath, position),
    cacheSubtitles: (filePath: string, subs: any[]) =>
      CacheSubtitles(filePath, JSON.stringify(subs)),
    getCachedSubtitles: (filePath: string) =>
      GetCachedSubtitles(filePath).then((s: string) => {
        if (!s) return null
        const parsed = JSON.parse(s)
        return Array.isArray(parsed) ? parsed : null
      }),

    getVideoThumbnail: (filePath: string) => GetVideoThumbnail(filePath),
    getWaveformData: (filePath: string) => GetWaveformData(filePath),
    transcodeForPlayback: (filePath: string) => TranscodeForPlayback(filePath),
    getPlatform: () => GetPlatform(),
    getVersion: () => GetVersion(),
    getMediaPort: () => GetMediaPort(),

    feedList: () => FeedList().then((s: string) => JSON.parse(s)),
    feedAdd: (url: string) => FeedAdd(url).then((s: string) => JSON.parse(s)),
    feedRemove: (id: number) => FeedRemove(id).then((s: string) => JSON.parse(s)),
    feedRefresh: (id: number) => FeedRefresh(id).then((s: string) => JSON.parse(s)),
    feedEpisodes: (id: number, limit: number) =>
      FeedEpisodes(id, limit).then((s: string) => JSON.parse(s)),
    episodeDownload: (id: number) => EpisodeDownload(id).then((s: string) => JSON.parse(s)),
    feedGetProxy: () => FeedGetProxy(),
    feedSetProxy: (proxy: string) => FeedSetProxy(proxy).then((s: string) => JSON.parse(s)),
    feedGetBilibiliCookie: () => FeedGetBilibiliCookie(),
    feedSetBilibiliCookie: (cookie: string) =>
      FeedSetBilibiliCookie(cookie).then((s: string) => JSON.parse(s)),
    getBilibiliStream: (bvid: string) => GetBilibiliStream(bvid).then((s: string) => JSON.parse(s)),
    feedStartBilibiliQRLogin: () => FeedStartBilibiliQRLogin().then((s: string) => JSON.parse(s)),
    feedPollBilibiliQRLogin: (key: string) =>
      FeedPollBilibiliQRLogin(key).then((s: string) => JSON.parse(s)),
    feedOnProgress: (cb: (data: { episodeId: number; pct: number }) => void) => {
      Events.On('feed:download-progress', (e: any) => cb(e.data))
      return () => Events.Off('feed:download-progress')
    },
    platformConvertToRSS: (url: string) =>
      PlatformConvertToRSS(url).then((s: string) => JSON.parse(s)),
    platformGetRSSHubURL: () => GetRSSHubURL(),
    platformSetRSSHubURL: (u: string) => SetRSSHubURL(u).then((s: string) => JSON.parse(s)),
    platformGetSubtitles: (episodeId: number) =>
      GetSubtitles(episodeId).then((s: string) => JSON.parse(s)),
    platformTranscribePodcast: (episodeId: number, force: boolean) =>
      PlatformTranscribePodcast(episodeId, force).then((s: string) => JSON.parse(s)),

    dbDictTags: () => DbDictTags(),
    dbDictWords: (tag: string) => DbDictWords(tag),
    dbDictAddToWordList: (words: any[]) => DbDictAddToWordList(JSON.stringify(words)),
    dbDictSaveProgress: (tag: string, index: number) => DbDictSaveProgress(tag, index),
    dbDictGetProgress: (tag: string) => DbDictGetProgress(tag),
    dbDictLookup: (word: string) =>
      DbDictLookup(word).then((s: string) => {
        if (!s) return null
        return JSON.parse(s)
      }),
    dbDictSearch: (query: string, limit?: number) => DbDictSearch(query, limit ?? 50),

    libraryList: () => LibraryList().then((s: string) => JSON.parse(s)),
    libraryImport: (category: string, folderId: string) =>
      LibraryImport(category, folderId).then((s: string) => JSON.parse(s)),
    libraryImportPaths: (paths: string[], folderId: string) =>
      LibraryImportPaths(JSON.stringify(paths), folderId).then((s: string) => JSON.parse(s)),
    libraryRemove: (paths: string[]) =>
      LibraryRemove(JSON.stringify(paths)).then((s: string) => JSON.parse(s)),
    libraryRename: (path: string, newName: string) =>
      LibraryRename(path, newName).then((s: string) => JSON.parse(s)),
    libraryMove: (paths: string[], folderId: string) =>
      LibraryMove(JSON.stringify(paths), folderId).then((s: string) => JSON.parse(s)),
    folderCreate: (name: string, parentId: string) =>
      FolderCreate(name, parentId).then((s: string) => JSON.parse(s)),
    folderDelete: (id: string) => FolderDelete(id).then((s: string) => JSON.parse(s)),
    folderRename: (id: string, name: string) =>
      FolderRename(id, name).then((s: string) => JSON.parse(s)),

    openExternal: (path: string) => OpenExternal(path),

    getCategories: () => GetCategories(),
    getArticles: (categoryEnName: string) => GetArticles(categoryEnName),
    getArticle: (id: number) =>
      GetArticle(id).then((s: string) => {
        if (!s) return null
        return JSON.parse(s)
      }),
    getTypingProgress: (articleId: number, mode: string) =>
      GetTypingProgress(articleId, mode).then((s: string) => {
        if (!s) return null
        return JSON.parse(s)
      }),
    saveTypingProgress: (progressJson: string) => SaveTypingProgress(progressJson),
    getTypingRecords: (articleId: number) =>
      GetTypingRecords(articleId).then((s: string) => {
        if (!s) return []
        return JSON.parse(s)
      }),
    saveTypingRecord: (recordJson: string) => SaveTypingRecord(recordJson),
    getAllTypingProgress: () =>
      GetAllTypingProgress().then((s: string) => {
        if (!s) return []
        return JSON.parse(s)
      }),
    addWordsBatch: (wordsJson: string) => AddWordsBatch(wordsJson),

    favoriteList: (tagId: number) =>
      FavoriteList(tagId).then((s: string) => {
        if (!s) return []
        return JSON.parse(s)
      }),
    favoriteAdd: (clip: any) => FavoriteAdd(JSON.stringify(clip)),
    favoriteDelete: (id: number) => FavoriteDelete(id),
    favoriteUpdateTag: (id: number, tagId: number) => FavoriteUpdateTag(id, tagId),
    favoriteReview: (id: number, rating: number) => FavoriteReview(id, rating),
    favoriteTagsList: () =>
      FavoriteTagsList().then((s: string) => {
        if (!s) return []
        return JSON.parse(s)
      }),
    favoriteTagAdd: (name: string) => FavoriteTagAdd(name),
    favoriteTagDelete: (id: number) => FavoriteTagDelete(id),

    aiGetConfig: () => GetAIConfig().then((s: string) => JSON.parse(s)),
    aiSetConfig: (cfg: any) => SetAIConfig(JSON.stringify(cfg)),
    aiTest: () => TestAIConnection().then((s: string) => JSON.parse(s)),
    aiTranslateStream: (text: string, context: string, reqId: string) =>
      TranslateStream(text, context, reqId).then((s: string) => JSON.parse(s)),
    aiExplain: (text: string, context: string) =>
      Explain(text, context).then((s: string) => JSON.parse(s)),
    aiOnChunk: (cb: (data: { reqId: string; delta: string }) => void) => {
      Events.On('ai:translate:chunk', (e: any) => cb(e.data))
      return () => Events.Off('ai:translate:chunk')
    },
    aiOnDone: (cb: (data: { reqId: string; text?: string; error?: string }) => void) => {
      Events.On('ai:translate:done', (e: any) => cb(e.data))
      return () => Events.Off('ai:translate:done')
    },

    backupNow: () => BackupNow().then((s: string) => JSON.parse(s)),
    getBackupStatus: () => GetBackupStatus().then((s: string) => JSON.parse(s)),

    checkUpdate: () => CheckForUpdate().then((s: string) => JSON.parse(s)),
    downloadUpdate: () => DownloadLatest().then((s: string) => JSON.parse(s)),
    applyUpdate: () => ApplyUpdate().then((s: string) => JSON.parse(s)),
    updateOnProgress: (cb: (pct: number) => void) => {
      Events.On('wails:updater:download-progress', (e: any) => {
        const p = e?.data
        const pct = p && p.total > 0 ? Math.min(100, Math.round((p.written / p.total) * 100)) : 0
        cb(pct)
      })
      return () => Events.Off('wails:updater:download-progress')
    },
  } as any
}
