# 移动端（Expo）迁移设计

## 概述

将 Aling（小诺语伴）桌面端应用的核心功能迁移到移动端，使用 Expo SDK 56 + TypeScript 重构。

## 技术栈

| 层面 | 技术选型 |
|------|----------|
| 框架 | Expo SDK 56 + TypeScript，Development Build（不兼容 Expo Go） |
| 导航 | expo-router（Tab + Stack） |
| 播放器 | expo-video（VideoPlayer） |
| 缩略图 | expo-video generateThumbnailsAsync |
| 离线转录 | whisper.rn（whisper.cpp binding，GGML 模型） |
| 本地数据库 | expo-sqlite（同步 API + hooks） |
| 状态管理 | zustand |
| 文件选择 | expo-document-picker |
| 图片渲染 | expo-image |
| UI 组件库 | React Native Paper（轻量，不绑定） |
| URI 兼容 | 统一处理 Android content:// 和 iOS ph:// |

## 范围（第一阶段）

仅实现核心功能：音视频播放 + 字幕转录 + 同步展示。SRS 卡片背诵、生词库管理为后续阶段。

## 项目结构

```
mobile/
├── app.json
├── package.json
├── tsconfig.json
├── babel.config.js
├── app/
│   ├── _layout.tsx              # 根布局（Tab 导航）
│   ├── (tabs)/
│   │   ├── _layout.tsx          # 底部 Tab 配置
│   │   ├── player.tsx           # 播放器主页
│   │   ├── review.tsx           # 卡片背诵
│   │   ├── words.tsx            # 生词库
│   │   └── settings.tsx         # 设置
│   └── word-detail.tsx          # 单词详情（Stack 模态）
├── src/
│   ├── components/
│   │   ├── SubtitlePanel.tsx    # 字幕面板
│   │   ├── WordCard.tsx         # 翻转卡片
│   │   ├── VideoPlayer.tsx      # 播放器控件封装
│   │   └── EmptyState.tsx       # 空状态
│   ├── stores/
│   │   ├── playerStore.ts       # 播放器状态
│   │   └── wordStore.ts         # 词库状态
│   ├── db/
│   │   ├── schema.ts            # 建表
│   │   ├── words.ts             # 单词 CRUD hooks
│   │   ├── dict.ts              # dict.db 查询 hooks
│   │   └── progress.ts          # 进度记录 hooks
│   ├── services/
│   │   ├── transcription.ts     # whisper.rn 调用封装
│   │   └── modelDownload.ts     # GGML 模型下载
│   ├── utils/
│   │   ├── srs.ts               # SRS 排程算法
│   │   └── subtitle.ts          # SRT 解析
│   ├── assets/
│   │   └── dict.db              # 内置只读词库
│   └── types.ts                 # 全局类型
```

## 数据库 Schema

### userData.db（应用主数据库）

```sql
CREATE TABLE words (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word TEXT NOT NULL,
  definition TEXT DEFAULT '',
  phonetic TEXT DEFAULT '',
  example TEXT DEFAULT '',
  tags TEXT DEFAULT '',
  level INTEGER DEFAULT 1,
  next_review TEXT DEFAULT (date('now')),
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#3b82f6'
);

CREATE TABLE subtitle_cache (
  file_hash TEXT PRIMARY KEY,
  subtitles TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
```

### dict.db（内置只读）

```sql
-- mini_dict 表，和桌面端一致
SELECT word, phonetic, translation, definition, pos, tag FROM mini_dict
```

## 播放器 + 字幕页面

### 布局

```
Header: 精听 · 当前文件名
  ↓
VideoPlayer (expo-video)
  ↓
Whisper 进度条（转录时显示）
  ↓
SubtitlePanel
  - 自动滚动到当前字幕项
  - 高亮当前句
  - 点击任意单词 → 弹出"添加生词"模态
  ↓
底部操作栏: 导入SRT  |  转录
```

### 字幕同步机制

```
VideoPlayer onTimeUpdate(currentTime) →
  二分查找 subtitles 中 startTime ≤ currentTime ≤ endTime →
  更新 currentSubtitleIndex →
  SubtitlePanel.scrollToItem(index)
```

### 资源释放

VideoPlayer 实例使用后必须调用 `player.release()` 释放资源，在组件卸载时通过 `useEffect` cleanup 确保释放。

### 缩略图

使用 expo-video 的 generateThumbnailsAsync：

```ts
const thumbnail = await generateThumbnailsAsync(uri, {
  timeFrom: 5000,
  timeTo: 5000,
  scale: 0.3,
})
```

## Whisper 离线转录

### 流程

```
用户点击 🎙 转录
  │
  ├─ 检查模型是否存在 → 否 → 跳转设置页下载
  │
  ├─ whisper.rn transcribe(filePath, modelPath, language)
  │   - 直接传入视频/音频文件路径
  │   - whisper.cpp 内部解封装，无需 ffmpeg
  │
  ├─ 进度回调：更新 UI 进度条
  │
  └─ 结果转换：segments[{start,end,text}] → SubtitleItem[]
      存入 subtitle_cache
```

### 模型下载

```ts
FileSystem.createDownloadResumable(
  `https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-${name}.bin`,
  modelsDir + `/ggml-${name}.bin`
)
```

### 模型选项

- tiny（~75MB）
- small（~466MB）
- large-v3（~3.1GB）

## 设置页面

- Whisper 模型管理：下载/切换/删除模型，选择语言
- 数据管理：JSON 导出/导入，清除数据
- 关于：版本号，dict.db 词条数

## Zustand Store

### playerStore

```ts
interface PlayerStore {
  videoPlayer: VideoPlayer | null
  fileUri: string | null
  subtitles: SubtitleItem[]
  currentSubtitleIndex: number
  isTranscribing: boolean
  whisperProgress: number
}
```

### wordStore

```ts
interface WordStore {
  words: Word[]
  searchQuery: string
  isLoading: boolean
  refresh: () => Promise<void>
}
```

## URI 兼容性

移动端 URI 格式因平台而异，所有文件 URI 统一通过工具函数处理：

```ts
// src/utils/uri.ts
// - Android content:// → 通过 FileSystem.copyToCacheDirectory 转为本地文件
// - iOS ph:// → 通过 expo-media-library 或 FileSystem 转为本地文件
// - file:// → 直接使用
export function resolveUri(uri: string): Promise<string>
```

所有文件选择结果传入视频加载、缩略图生成、转录服务之前，先经过 `resolveUri` 转换。

## 编码质量要求

### 任务队列控制

```ts
// src/utils/taskQueue.ts
// 顺序执行异步任务，控制并发数
class TaskQueue {
  private queue: (() => Promise<void>)[]
  private concurrency: number
  private active: number
  enqueue(task: () => Promise<void>): void
}
```

用于：模型下载分片、多条转录请求排队等场景。

### 异步错误处理

所有 `async` 函数必须包含 `try/catch`，错误信息通过日志输出或 UI 提示展示。不允许未捕获的 Promise rejection。

### 代码分层

| 层 | 目录 | 职责 |
|----|------|------|
| 工具函数 | src/utils/ | 纯函数、无副作用、无平台依赖 |
| 业务服务 | src/services/ | 封装第三方库调用、平台 API |
| 数据访问 | src/db/ | SQLite 查询 hooks |
| 页面组件 | app/ | expo-router 页面 |
| 通用组件 | src/components/ | 可复用 UI 组件 |

禁止跨层调用（如组件中直接操作 SQLite）。

### 内存泄漏防范

- `useEffect` cleanup 中调用 `player.release()`、取消事件监听、清除定时器
- Zustand store 中保存的 VideoPlayer 引用在页面卸载时置 `null` 并 release
- 大对象（音频缓冲区、模型数据）用完后及时释放引用

## Tab 导航

底部 4 个 Tab：

| Tab | 路由 | 图标 |
|-----|------|------|
| 精听 | /(tabs)/player | headphone |
| 复习 | /(tabs)/review | refresh |
| 词库 | /(tabs)/words | book |
| 设置 | /(tabs)/settings | gear |
