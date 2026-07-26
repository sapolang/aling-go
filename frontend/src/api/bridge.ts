export function initBridge(): void {
  const app = (window as any).go.main.App

  window.api = {
    openFile: (filters?: any) => app.OpenFile(filters || ''),
    saveFile: (name: string) => app.SaveFile(name),
    openSubtitle: () => app.OpenSubtitle(),
    readTextFile: (path: string) => app.ReadTextFile(path),
    writeTextFile: (path: string, content: string) => app.WriteTextFile(path, content),

    dbWordsList: () => app.DbWordsList(),
    dbWordsAdd: (word: any) => app.DbWordsAdd(JSON.stringify(word)),
    dbWordsUpdate: (id: number, data: any) => app.DbWordsUpdate(id, JSON.stringify(data)),
    dbWordsDelete: (id: number) => app.DbWordsDelete(id),
    dbWordsDeleteBatch: (ids: number[]) => app.DbWordsDeleteBatch(ids),
    dbWordsGetReview: () => app.DbWordsGetReview(),
    dbWordsSearch: (query: string) => app.DbWordsSearch(query),

    dbTagsList: () => app.DbTagsList(),
    dbTagsAdd: (name: string, color: string) => app.DbTagsAdd(name, color),
    dbTagsDelete: (id: number) => app.DbTagsDelete(id),

    dbExport: () => app.DbExport(),
    dbImport: (jsonStr: string) => app.DbImport(jsonStr),
    dbClear: () => app.DbClear(),

    whisperTranscribe: (filePath: string) => app.Transcribe(filePath).then((s: string) => {
      const parsed = JSON.parse(s)
      return Array.isArray(parsed) ? parsed : []
    }),
    whisperStatus: () => app.WhisperStatus(),
    downloadWhisperModel: (mirrorURL: string, modelName: string) => app.DownloadWhisperModel(mirrorURL, modelName),
    setWhisperModel: (name: string) => app.SetWhisperModel(name),
    listWhisperModels: () => app.ListWhisperModels().then((s: string) => JSON.parse(s)),
    getWhisperLang: () => app.GetWhisperLang().then((s: string) => s),
    setWhisperLang: (lang: string) => app.SetWhisperLang(lang),
    onWhisperProgress: (cb: (data: any) => void) => {
      window.runtime.EventsOn('whisper:progress', cb)
      return () => window.runtime.EventsOff('whisper:progress')
    },
    onDownloadProgress: (cb: (pct: number) => void) => {
      window.runtime.EventsOn('whisper:download-progress', cb)
      return () => window.runtime.EventsOff('whisper:download-progress')
    },
    getDownloadProgress: () => app.GetDownloadProgress(),

    recentList: () => app.RecentList().then((s: string) => JSON.parse(s)),
    recentAdd: (filePath: string) => app.RecentAdd(filePath).then((s: string) => JSON.parse(s)),
    cacheSubtitles: (filePath: string, subs: any[]) => app.CacheSubtitles(filePath, JSON.stringify(subs)),
    getCachedSubtitles: (filePath: string) => app.GetCachedSubtitles(filePath).then((s: string) => {
      if (!s) return null
      const parsed = JSON.parse(s)
      return Array.isArray(parsed) ? parsed : null
    }),

    getVideoThumbnail: (filePath: string) => app.GetVideoThumbnail(filePath),
    getPlatform: () => app.GetPlatform(),
    getMediaPort: () => app.GetMediaPort(),

    // Dictionary
    dbDictTags: () => app.DbDictTags(),
    dbDictWords: (tag: string) => app.DbDictWords(tag),
    dbDictAddToWordList: (words: any[]) => app.DbDictAddToWordList(JSON.stringify(words)),
    dbDictSaveProgress: (tag: string, index: number) => app.DbDictSaveProgress(tag, index),
    dbDictGetProgress: (tag: string) => app.DbDictGetProgress(tag),

    // Library
    libraryList: () => app.LibraryList().then((s: string) => JSON.parse(s)),
    libraryImport: (category: string, folderId: string) => app.LibraryImport(category, folderId).then((s: string) => JSON.parse(s)),
    libraryRemove: (paths: string[]) => app.LibraryRemove(JSON.stringify(paths)).then((s: string) => JSON.parse(s)),
    libraryRename: (path: string, newName: string) => app.LibraryRename(path, newName).then((s: string) => JSON.parse(s)),
    libraryMove: (paths: string[], folderId: string) => app.LibraryMove(JSON.stringify(paths), folderId).then((s: string) => JSON.parse(s)),
    folderCreate: (name: string, parentId: string) => app.FolderCreate(name, parentId).then((s: string) => JSON.parse(s)),
    folderDelete: (id: string) => app.FolderDelete(id).then((s: string) => JSON.parse(s)),
    folderRename: (id: string, name: string) => app.FolderRename(id, name).then((s: string) => JSON.parse(s)),

    openExternal: (path: string) => app.OpenExternal(path),
  } as any
}
