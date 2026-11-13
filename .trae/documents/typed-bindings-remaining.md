# 剩余 Wails 服务接口类型化改造计划（issue #88 第二阶段）

## Context

issue #88 要求把 Wails 服务方法从「Go 返回 JSON 字符串 → 前端 `JSON.parse`」改为「直接返回 Go struct/slice → Wails bindings 负责序列化与类型传递」。第一阶段（媒体库 `LibraryService`）已完成，PR #94 待合并。本阶段覆盖其余所有仍在手工序列化的服务：Feed、Platform、Whisper、Article、Word/Favorite/Dict、AI、Backup、Update、Bilibili 流。

目标是消除 40+ 处 `json.Marshal`/`JSON.parse`/`JSON.stringify`，让前后端接口由编译器校验，并顺手修掉第一阶段遗留的 `getCachedSubtitles` 空值类型不准确问题。

## 设计约定

1. **不引入泛型 `Result[T]`**：Wails bindings 生成器对泛型支持弱、生成名可读性差。同构结果在包内共享一个 `ActionResult{OK, Error, Message}`；带载荷的接口使用各自具名的 `XxxResult`。
2. **列表永远返回空切片而非 nil**：`json.Marshal(nil slice)` 会变成 `null`，前端若直接 `.reduce`/`.length` 会崩。所有列表在 DB 出错或无数据时返回 `make([]T, 0)`。
3. **空值语义**：
   - 单对象查询（`GetArticle`、`GetTypingProgress`、`DbDictLookup`、`GetDownloadProgress`）返回指针 `*T`，未命中为 `nil`，前端类型声明为 `T | null`。
   - `GetCachedSubtitles` 同步改为未命中返回空切片（或 d.ts 声明 `SubtitleItem[] | null`），与调用方 `cached && cached.length` 一致。
4. **保持 string 的接口**（不改造）：
   - 标量/路径/版本：`GetProxy`、`GetBilibiliCookie`、`GetRSSHubURL`、`GetWhisperLang`、`GetPlatform`、`GetVersion`、`OpenFile`、`SaveFile`、`OpenSubtitle`、`ReadTextFile`
   - `GetVideoThumbnail`：单个 data URL 大标量，包对象无收益
   - `DbExport`：产物是可直接 `writeTextFile` 的备份文本，改结构会与 `DbImport` 漂移
   - `DbImport`：输入是用户选中文件的原始文本
   - 所有事件载荷（`whisper:progress`、`feed:download-progress`、`ai:translate:chunk/done`）保持不变
5. **入参去 stringify**：`Json` 结尾的入参改为 struct/slice 直接传。Wails 已支持嵌套结构（`CacheSubtitles(string, []SubtitleItem)` 已验证）。`DbImport` 例外保留 string。
6. **未导出类型无法生成 bindings**：`backupStatus`、`biliStreamResult`、`biliQRLoginResult`、`feedActionResult` 等需先导出为 `BackupStatus`、`BiliStreamResult`、`BiliQRLoginResult`、`ActionResult`。

## 实施步骤（按提交分组）

### 提交 0：收尾第一阶段遗留

- `frontend/src/types/electron.d.ts`：`getCachedSubtitles` 类型与 Go 空值语义对齐。
- `Home.tsx` 的 `recentList().then((list: any[]))`、`Favorites.tsx` 的 `getCachedSubtitles().then((subs: any))` 去掉 `any`。
- 删除 `internal/content/models.go` 中已无引用的 `RecentFile`。

### 提交 1：Whisper + Article（风险最低）

- `internal/content/whisper_service.go`
  - `Transcribe` → `[]SubtitleItem`，失败返回空切片
  - `ListWhisperModels` → `[]WhisperModelInfo{Name,File,Size,Downloaded}`
  - `GetDownloadProgress` → `*WhisperDownloadProgress{Model,Progress}`，空闲返回 nil
- `internal/content/youtube_subtitles.go`：去掉对 Whisper 返回值的 `json.Unmarshal`
- `internal/content/article_service.go` + `article_store.go`
  - `GetArticle` → `*ArticleItem`
  - `GetTypingProgress` → `*TypingProgress`
  - `GetTypingRecords` / `GetAllTypingProgress` → `[]TypingRecord` / `[]TypingProgress`
  - `SaveTypingProgress` / `SaveTypingRecord` 入参改为 struct
- 前端：`bridge.ts`、`electron.d.ts`、`Article.tsx`、`Home.tsx`（若用到）

### 提交 2：Study（Word / Favorite / Dict）

- `internal/study/word_service.go` + `words_store.go`
  - `GetLearningStats` → `LearningStats`
  - `GetExtendedStats` → `ExtendedStats`（复用已有类型）
  - `DbWordsAdd` / `DbWordsUpdate` / `AddWordsBatch` 入参改为 `Word` / `[]Word`
  - `DbExport` 保持 string
- `internal/study/favorite_service.go`：`FavoriteList` → `[]FavoriteClip`，`FavoriteTagsList` → `[]FavoriteTag`，`FavoriteAdd(clipJSON)` → `FavoriteAdd(FavoriteClip)`
- `internal/study/dict_service.go`：`DbDictLookup` → `*dict.DictWord`，`DbDictAddToWordList` 入参 `[]dict.DictWord`
- 前端：`Stats.tsx`、`Dict.tsx`、`Favorites.tsx`、`Review.tsx`、`Player.tsx`、`bridge.ts`、`electron.d.ts`

### 提交 3：Feed（结构最多）

- `internal/content/feed_service.go`
  - 导出 `ActionResult`（替代 `feedActionResult`）、`FeedListResult`、`FeedEpisodesResult`、`EpisodeDownloadResult`、`BiliQRLoginResult`
  - `FeedList`/`FeedEpisodes` 空库与错误均返回空切片 + `error` 字段
  - `FeedAdd`/`FeedRefresh`/`FeedRemove`/`SetProxy`/`SetBilibiliCookie` → `ActionResult`
  - `EpisodeDownload` → `EpisodeDownloadResult`
  - `StartBilibiliQRLogin`/`PollBilibiliQRLogin` → `BiliQRLoginResult`，移除内部 `marshalBiliQR` 往返
- 前端：`stores/feedStore.ts`、`pages/Podcast.tsx`、`bridge.ts`、`electron.d.ts`

### 提交 4：Platform + Bilibili 流

- `internal/content/platform_service.go`
  - `ConvertToRSS` → `RSSConvertResult{OK,RSSURL,Platform,Error}`
  - `SetRSSHubURL` → `ActionResult`
  - `GetSubtitles` → `PlatformSubtitlesResult{OK,Platform,VideoID,Title,Cues,Error}`
  - `TranscribePodcast` → `PodcastTranscribeResult{OK,Cues,Cached,Error}`
  - `GetRSSHubURL` 保持 string
- `internal/content/bilibili_stream.go`：`GetBilibiliStream` → `BiliStreamResult`（导出已有结构体）
- 前端：`Podcast.tsx`、`Player.tsx`、`bridge.ts`、`electron.d.ts`

### 提交 5：System（AI / Backup / Update）

- `internal/system/translate_service.go`
  - `GetAIConfig` → `AIConfigView`
  - `SetAIConfig` 入参 `AIConfig`，返回 `ActionResult`
  - `TestAIConnection` → `AITestResult`
  - `TranslateStream` → `AIStreamResult`（事件流不变）
  - `Explain` → `AIExplainResult`，`Data` 改为 `*AIExplainData`，避免 `json.RawMessage` 在 bindings 中退化成 `number[]`
- `internal/system/backup_service.go`：导出 `BackupStatus`/`BackupFileInfo`/`BackupResult`，`BackupNow` → `BackupResult`，`GetBackupStatus` → `BackupStatus`
- `internal/system/update_service.go`：`CheckForUpdate` → `UpdateInfo`，`DownloadLatest`/`ApplyUpdate` → `UpdateResult`，删除 `marshalJSON`
- 前端：`Settings.tsx`（重点 `if (err)` 判断改为 `res.error`）、`Favorites.tsx`（AI 详解）、`bridge.ts`、`electron.d.ts`

### 提交 6：全局收尾

- `bridge.ts` 中相关方法的 `JSON.parse`/`JSON.stringify` 清零（`DbExport`/`DbImport` 除外）
- `electron.d.ts` 清理剩余 `any`
- 全局 grep 确认无残留字符串契约

## 关键文件

- `internal/content/feed_service.go`、`platform_service.go`、`whisper_service.go`、`article_service.go`、`article_store.go`、`bilibili_stream.go`、`media_service.go`
- `internal/study/word_service.go`、`words_store.go`、`favorite_service.go`、`favorite_store.go`、`dict_service.go`
- `internal/system/translate_service.go`、`backup_service.go`、`update_service.go`
- `frontend/src/api/bridge.ts`、`frontend/src/types/electron.d.ts`
- `frontend/src/stores/feedStore.ts`、`frontend/src/pages/{Podcast,Home,Favorites,Settings,Stats,Dict,Article,Player}.tsx`

## 验证

1. **Go**：`go vet ./...`、`go test ./...`
   - 新增测试：whisper 模型列表/进度（空目录、已下载、空闲 nil）、feed 列表空库返回 `[]`、typing 写读回环、dict 查词命中/未命中、backup 空目录 `Files` 非 nil。
2. **Bindings**：`wails3 generate bindings -ts`，检查新类型生成、`T[]` 与 `T | null` 正确。
3. **前端**：`npm run build`（tsc + vite）、`npm run lint`、prettier。
4. **Wails MCP 端到端**（隔离 `HOME` 启动，避免沙箱写权限问题）：
   - `js_eval` 断言 `Array.isArray(await window.api.listWhisperModels())`、`feedList().feeds`、`getTypingRecords(1)`、`getDownloadProgress() === null`、`dbDictLookup('apple')` 结构
   - `backupNow()` 后 shell 校验 `backups/` 落盘
   - 打开 Stats / Podcast / Settings / Favorites 页面检查无红屏、无渲染报错
   - 重点回归 AI 翻译：缓存命中与 chunk/done 事件流
5. **CI**：bindings、go-checks、frontend-checks 全绿。

## 风险与规避

| 风险 | 规避 |
|---|---|
| nil 切片变 `null` 导致前端 `.reduce` 崩溃 | 后端强制返回空切片；bridge 补 `?? []` |
| map→struct 的 `omitempty` 与旧字段存在性不一致 | 可选字段严格对齐旧 map 行为 |
| 错误从 string 变对象，调用方 `if (err)` 失效 | 逐处改为 `res.error`，全局 grep 旧判断 |
| `json.RawMessage` 在 bindings 中退化为 `number[]` | AI 详解改用具名 `AIExplainData` |
| 未导出结构体不生成 bindings | 先导出类型再改签名 |
| AI 流式事件与返回结果并存 | 只改返回结构，事件 payload 不动，单独回归 |
| 一次性改动面过大 | 按 6 个提交分组，每组独立跑 Go 测试 + 前端构建 |

## PR 策略建议

先合并已全绿的 PR #94，再从最新 `main` 切出 `refactor/typed-bindings-rest`，按上面 6 个提交推进，最终一个 PR 或拆成 2 个（前端/Go 数据层、Feed/Platform 网络层）。若希望保留 #94 未合并状态，也可基于 `refactor/typed-bindings` 新建堆叠分支，PR base 指向该分支。
