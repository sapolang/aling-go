import {
  OpenFile,
  SaveFile,
  OpenSubtitle,
  ReadTextFile,
  WriteTextFile,
  GetPlatform,
  OpenExternal,
} from '../../bindings/aling-go/platformservice'

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
} from '../../bindings/aling-go/wordservice'

import {
  GetCategories,
  GetArticles,
  GetArticle,
  GetTypingProgress,
  SaveTypingProgress,
  GetTypingRecords,
  SaveTypingRecord,
  GetAllTypingProgress,
} from '../../bindings/aling-go/articleservice'

import {
  DbDictTags,
  DbDictWords,
  DbDictAddToWordList,
  DbDictSaveProgress,
  DbDictGetProgress,
} from '../../bindings/aling-go/dictservice'

import {
  LibraryList,
  LibraryImport,
  LibraryRemove,
  LibraryRename,
  LibraryMove,
  FolderCreate,
  FolderDelete,
  FolderRename,
  RecentList,
  RecentAdd,
  CacheSubtitles,
  GetCachedSubtitles,
} from '../../bindings/aling-go/libraryservice'

import {
  GetVideoThumbnail,
  GetWaveformData,
  GetMediaPort,
} from '../../bindings/aling-go/mediaservice'

import {
  Transcribe,
  WhisperStatus,
  DownloadWhisperModel,
  SetWhisperModel,
  ListWhisperModels,
  GetWhisperLang,
  SetWhisperLang,
  GetDownloadProgress,
} from '../../bindings/aling-go/whisperservice'
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

    whisperTranscribe: (filePath: string) => Transcribe(filePath).then((s: string) => {
      const parsed = JSON.parse(s)
      return Array.isArray(parsed) ? parsed : []
    }),
    whisperStatus: () => WhisperStatus(),
    downloadWhisperModel: (mirrorURL: string, modelName: string) => DownloadWhisperModel(mirrorURL, modelName),
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
    cacheSubtitles: (filePath: string, subs: any[]) => CacheSubtitles(filePath, JSON.stringify(subs)),
    getCachedSubtitles: (filePath: string) => GetCachedSubtitles(filePath).then((s: string) => {
      if (!s) return null
      const parsed = JSON.parse(s)
      return Array.isArray(parsed) ? parsed : null
    }),

    getVideoThumbnail: (filePath: string) => GetVideoThumbnail(filePath),
    getWaveformData: (filePath: string) => GetWaveformData(filePath),
    getPlatform: () => GetPlatform(),
    getMediaPort: () => GetMediaPort(),

    dbDictTags: () => DbDictTags(),
    dbDictWords: (tag: string) => DbDictWords(tag),
    dbDictAddToWordList: (words: any[]) => DbDictAddToWordList(JSON.stringify(words)),
    dbDictSaveProgress: (tag: string, index: number) => DbDictSaveProgress(tag, index),
    dbDictGetProgress: (tag: string) => DbDictGetProgress(tag),

    libraryList: () => LibraryList().then((s: string) => JSON.parse(s)),
    libraryImport: (category: string, folderId: string) => LibraryImport(category, folderId).then((s: string) => JSON.parse(s)),
    libraryRemove: (paths: string[]) => LibraryRemove(JSON.stringify(paths)).then((s: string) => JSON.parse(s)),
    libraryRename: (path: string, newName: string) => LibraryRename(path, newName).then((s: string) => JSON.parse(s)),
    libraryMove: (paths: string[], folderId: string) => LibraryMove(JSON.stringify(paths), folderId).then((s: string) => JSON.parse(s)),
    folderCreate: (name: string, parentId: string) => FolderCreate(name, parentId).then((s: string) => JSON.parse(s)),
    folderDelete: (id: string) => FolderDelete(id).then((s: string) => JSON.parse(s)),
    folderRename: (id: string, name: string) => FolderRename(id, name).then((s: string) => JSON.parse(s)),

    openExternal: (path: string) => OpenExternal(path),

    getCategories: () => GetCategories(),
    getArticles: (categoryEnName: string) => GetArticles(categoryEnName),
    getArticle: (id: number) => GetArticle(id).then((s: string) => {
      if (!s) return null
      return JSON.parse(s)
    }),
    getTypingProgress: (articleId: number, mode: string) => GetTypingProgress(articleId, mode).then((s: string) => {
      if (!s) return null
      return JSON.parse(s)
    }),
    saveTypingProgress: (progressJson: string) => SaveTypingProgress(progressJson),
    getTypingRecords: (articleId: number) => GetTypingRecords(articleId).then((s: string) => {
      if (!s) return []
      return JSON.parse(s)
    }),
    saveTypingRecord: (recordJson: string) => SaveTypingRecord(recordJson),
    getAllTypingProgress: () => GetAllTypingProgress().then((s: string) => {
      if (!s) return []
      return JSON.parse(s)
    }),
    addWordsBatch: (wordsJson: string) => AddWordsBatch(wordsJson),
  } as any
}
