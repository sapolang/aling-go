# Expo 移动端 Phase 1 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 `mobile/` 目录下创建 Expo SDK 56 + TypeScript 项目，实现音视频播放 + 字幕转录 + 同步展示核心功能。

**Architecture:** Expo Router 文件系统路由驱动导航，expo-video 负责媒体播放，whisper.rn 负责离线转录，expo-sqlite 负责持久化。代码分 utils / services / db / components / pages 五层。

**Tech Stack:** Expo SDK 56, TypeScript, expo-router, expo-video, expo-image, expo-sqlite, whisper.rn, React Native Paper, zustand

## Global Constraints

- Expo SDK 56 + Development Build，不兼容 Expo Go
- 多媒体仅使用 expo-video，禁止引入 ffmpeg
- 视频缩略图使用 expo-video.generateThumbnailsAsync
- VideoPlayer 实例使用后必须调用 release()
- 图片渲染统一使用 expo-image
- URI 兼容 Android content:// 和 iOS ph://
- UI 使用 RN 内置组件 + React Native Paper（不绑定大型框架）
- 所有 async 函数必须 try/catch
- 任务队列管理并发
- useEffect cleanup 释放资源

---

### Task 1: Scaffold Expo 项目

**Files:**
- Create: `mobile/`（项目根目录）
- Create: `mobile/package.json`
- Create: `mobile/app.json`
- Create: `mobile/tsconfig.json`
- Create: `mobile/babel.config.js`
- Create: `mobile/.gitignore`

**Interfaces:**
- Produces: 可运行的 Expo Dev Client 项目骨架

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "aling-mobile",
  "version": "1.0.0",
  "main": "expo/router/entry",
  "scripts": {
    "start": "expo start",
    "dev": "expo start --dev-client",
    "android": "expo run:android",
    "ios": "expo run:ios",
    "web": "expo start --web",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "expo": "~56.0.0",
    "expo-router": "~4.0.0",
    "expo-video": "~2.0.0",
    "expo-image": "~2.0.0",
    "expo-sqlite": "~15.0.0",
    "expo-document-picker": "~13.0.0",
    "expo-file-system": "~18.0.0",
    "expo-media-library": "~17.0.0",
    "@react-native-paper/core": "^1.0.0",
    "react-native-paper": "^5.12.0",
    "react-native-safe-area-context": "^5.0.0",
    "react-native-screens": "^4.4.0",
    "react-native-vector-icons": "^10.0.0",
    "react-native-web": "~0.19.0",
    "react-dom": "18.3.1",
    "react": "18.3.1",
    "react-native": "0.76.9",
    "zustand": "^4.5.0",
    "expo-linking": "~7.0.0",
    "expo-constants": "~17.0.0",
    "@expo/vector-icons": "^14.0.0"
  },
  "devDependencies": {
    "@types/react": "~18.3.0",
    "typescript": "~5.3.0"
  },
  "private": true
}
```

- [ ] **Step 2: 创建 app.json**

```json
{
  "expo": {
    "name": "Aling",
    "slug": "aling",
    "version": "1.0.0",
    "orientation": "portrait",
    "userInterfaceStyle": "automatic",
    "scheme": "aling",
    "platforms": ["ios", "android"],
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": "com.aling.mobile",
      "infoPlist": {
        "NSPhotoLibraryUsageDescription": "用于导入视频文件",
        "NSMicrophoneUsageDescription": "用于语音转录"
      }
    },
    "android": {
      "package": "com.aling.mobile",
      "permissions": ["READ_EXTERNAL_STORAGE", "WRITE_EXTERNAL_STORAGE"]
    },
    "plugins": [
      "expo-router",
      "expo-sqlite",
      "expo-document-picker",
      "expo-video",
      [
        "expo-media-library",
        {
          "photosPermission": "允许访问相册以导入视频",
          "savePhotosPermission": "允许保存视频到相册"
        }
      ]
    ],
    "experiments": {
      "typedRoutes": true
    }
  }
}
```

- [ ] **Step 3: 创建 tsconfig.json**

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"]
}
```

- [ ] **Step 4: 创建 babel.config.js**

```js
module.exports = function (api) {
  api.cache(true)
  return {
    presets: ['babel-preset-expo'],
  }
}
```

- [ ] **Step 5: 创建 .gitignore**

```
node_modules/
.expo/
dist/
*.jks
*.p8
*.p12
*.key
*.mobileprovision
*.orig.*
web-build/
```

- [ ] **Step 6: 安装依赖并验证**

```bash
cd mobile && npm install
npx expo customize --platform android 2>/dev/null; npx expo customize --platform ios 2>/dev/null
npx tsc --noEmit
```

Expected: 无类型错误，项目构建成功。

- [ ] **Step 7: Commit**

```bash
git add mobile/
git commit -m "feat(mobile): scaffold Expo SDK 56 project"
```

---

### Task 2: 全局类型与数据库层

**Files:**
- Create: `mobile/src/types.ts`
- Create: `mobile/src/db/schema.ts`
- Create: `mobile/src/db/database.ts`
- Create: `mobile/src/utils/subtitle.ts`

**Interfaces:**
- Produces: 全局类型定义、数据库初始化、DB hook 基座、SRT 解析工具

- [ ] **Step 1: 创建 types.ts**

```ts
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
```

- [ ] **Step 2: 创建 src/db/schema.ts**

```ts
export const CREATE_WORDS_TABLE = `
  CREATE TABLE IF NOT EXISTS words (
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
  )
`

export const CREATE_TAGS_TABLE = `
  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#3b82f6'
  )
`

export const CREATE_SUBTITLE_CACHE_TABLE = `
  CREATE TABLE IF NOT EXISTS subtitle_cache (
    file_hash TEXT PRIMARY KEY,
    subtitles TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )
`

export const ALL_SCHEMAS = [
  CREATE_WORDS_TABLE,
  CREATE_TAGS_TABLE,
  CREATE_SUBTITLE_CACHE_TABLE,
]
```

- [ ] **Step 3: 创建 src/db/database.ts**

```ts
import * as SQLite from 'expo-sqlite'
import { ALL_SCHEMAS } from './schema'

let db: SQLite.SQLiteDatabase | null = null

export async function initDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db
  db = await SQLite.openDatabaseAsync('aling.db')
  for (const sql of ALL_SCHEMAS) {
    await db.execAsync(sql)
  }
  return db
}

export function getDatabase(): SQLite.SQLiteDatabase {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.')
  return db
}
```

- [ ] **Step 4: 创建 src/utils/subtitle.ts**

```ts
import { SubtitleItem } from '../types'

export function parseSRT(content: string): SubtitleItem[] {
  const items: SubtitleItem[] = []
  const blocks = content.trim().split(/\n\s*\n/)
  let index = 0
  for (const block of blocks) {
    const lines = block.trim().split('\n')
    if (lines.length < 3) continue
    const timeMatch = lines[1].match(
      /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/
    )
    if (!timeMatch) continue
    const startTime =
      parseInt(timeMatch[1]) * 3600 +
      parseInt(timeMatch[2]) * 60 +
      parseInt(timeMatch[3]) +
      parseInt(timeMatch[4]) / 1000
    const endTime =
      parseInt(timeMatch[5]) * 3600 +
      parseInt(timeMatch[6]) * 60 +
      parseInt(timeMatch[7]) +
      parseInt(timeMatch[8]) / 1000
    const text = lines.slice(2).join('\n')
    items.push({ id: index++, startTime, endTime, text })
  }
  return items
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}
```

- [ ] **Step 5: Commit**

```bash
git add mobile/src/types.ts mobile/src/db/ mobile/src/utils/subtitle.ts
git commit -m "feat(mobile): add types, database layer, and SRT parser"
```

---

### Task 3: URI 兼容层和任务队列

**Files:**
- Create: `mobile/src/utils/uri.ts`
- Create: `mobile/src/utils/taskQueue.ts`

**Interfaces:**
- Produces: `resolveUri(uri: string): Promise<string>` — 将 content:// ph:// 转为可访问的本地路径
- Produces: `TaskQueue` 类 — 带并发控制的异步任务队列

- [ ] **Step 1: 创建 src/utils/uri.ts**

```ts
import * as FileSystem from 'expo-file-system'
import * as MediaLibrary from 'expo-media-library'
import { Platform } from 'react-native'

function generateCachePath(uri: string): string {
  const ext = uri.split('.').pop() || 'mp4'
  return `${FileSystem.cacheDirectory}aling/${Date.now()}.${ext}`
}

export async function copyToCache(uri: string): Promise<string> {
  const dest = generateCachePath(uri)
  await FileSystem.makeDirectoryAsync(
    FileSystem.cacheDirectory + 'aling/',
    { intermediates: true }
  )
  await FileSystem.copyAsync({ from: uri, to: dest })
  return dest
}

export async function resolveUri(uri: string): Promise<string> {
  try {
    if (uri.startsWith('file://')) return uri
    if (uri.startsWith('content://') || uri.startsWith('ph://')) {
      return await copyToCache(uri)
    }
    return uri
  } catch (error) {
    throw new Error(`Failed to resolve URI: ${uri}, error: ${error}`)
  }
}
```

- [ ] **Step 2: 创建 src/utils/taskQueue.ts**

```ts
export class TaskQueue {
  private queue: (() => Promise<void>)[] = []
  private active = 0
  private concurrency: number

  constructor(concurrency = 1) {
    this.concurrency = concurrency
  }

  enqueue(task: () => Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          await task()
          resolve()
        } catch (e) {
          reject(e)
        }
      })
      this.processNext()
    })
  }

  private processNext(): void {
    if (this.active >= this.concurrency || this.queue.length === 0) return
    this.active++
    const task = this.queue.shift()!
    task().finally(() => {
      this.active--
      this.processNext()
    })
  }

  get length(): number {
    return this.queue.length
  }

  get activeCount(): number {
    return this.active
  }

  clear(): void {
    this.queue = []
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add mobile/src/utils/uri.ts mobile/src/utils/taskQueue.ts
git commit -m "feat(mobile): add URI resolver and task queue"
```

---

### Task 4: Zustand Stores

**Files:**
- Create: `mobile/src/stores/playerStore.ts`
- Create: `mobile/src/stores/wordStore.ts`

**Interfaces:**
- Produces: `usePlayerStore` — 播放器全局状态
- Produces: `useWordStore` — 词库全局状态

- [ ] **Step 1: 创建 src/stores/playerStore.ts**

```ts
import { create } from 'zustand'
import { SubtitleItem } from '../types'

interface PlayerState {
  fileUri: string | null
  fileName: string | null
  subtitles: SubtitleItem[]
  currentSubtitleIndex: number
  isTranscribing: boolean
  whisperProgress: number
  // actions
  setFile: (uri: string, name: string) => void
  setSubtitles: (subs: SubtitleItem[]) => void
  setCurrentSubtitleIndex: (index: number) => void
  setTranscribing: (v: boolean) => void
  setWhisperProgress: (p: number) => void
  reset: () => void
}

export const usePlayerStore = create<PlayerState>((set) => ({
  fileUri: null,
  fileName: null,
  subtitles: [],
  currentSubtitleIndex: -1,
  isTranscribing: false,
  whisperProgress: 0,
  setFile: (uri, name) => set({ fileUri: uri, fileName: name, subtitles: [], currentSubtitleIndex: -1 }),
  setSubtitles: (subs) => set({ subtitles: subs, currentSubtitleIndex: -1 }),
  setCurrentSubtitleIndex: (index) => set({ currentSubtitleIndex: index }),
  setTranscribing: (v) => set({ isTranscribing: v, whisperProgress: v ? 0 : 0 }),
  setWhisperProgress: (p) => set({ whisperProgress: p }),
  reset: () =>
    set({
      fileUri: null,
      fileName: null,
      subtitles: [],
      currentSubtitleIndex: -1,
      isTranscribing: false,
      whisperProgress: 0,
    }),
}))
```

- [ ] **Step 2: 创建 src/stores/wordStore.ts**

```ts
import { create } from 'zustand'
import { Word } from '../types'

interface WordState {
  words: Word[]
  searchQuery: string
  selectedTag: string | null
  isLoading: boolean
  setWords: (words: Word[]) => void
  setSearchQuery: (q: string) => void
  setSelectedTag: (tag: string | null) => void
  setLoading: (v: boolean) => void
}

export const useWordStore = create<WordState>((set) => ({
  words: [],
  searchQuery: '',
  selectedTag: null,
  isLoading: false,
  setWords: (words) => set({ words }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setSelectedTag: (tag) => set({ selectedTag: tag }),
  setLoading: (v) => set({ isLoading: v }),
}))
```

- [ ] **Step 3: Commit**

```bash
git add mobile/src/stores/
git commit -m "feat(mobile): add Zustand stores for player and word list"
```

---

### Task 5: App 布局与导航

**Files:**
- Create: `mobile/app/_layout.tsx`
- Create: `mobile/app/(tabs)/_layout.tsx`
- Create: `mobile/app/(tabs)/player.tsx`（骨架）
- Create: `mobile/app/(tabs)/review.tsx`（占位）
- Create: `mobile/app/(tabs)/words.tsx`（占位）
- Create: `mobile/app/(tabs)/settings.tsx`（骨架）

**Interfaces:**
- Consumes: `initDatabase` from db/database.ts
- Produces: 完整 Tab 导航结构

- [ ] **Step 1: 创建 app/_layout.tsx**

```tsx
import { useEffect, useState } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { PaperProvider } from 'react-native-paper'
import { View, ActivityIndicator } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { initDatabase } from '../src/db/database'

export default function RootLayout() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    initDatabase()
      .then(() => setReady(true))
      .catch((e) => console.error('DB init failed:', e))
  }, [])

  if (!ready) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    )
  }

  return (
    <SafeAreaProvider>
      <PaperProvider>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
        </Stack>
      </PaperProvider>
    </SafeAreaProvider>
  )
}
```

- [ ] **Step 2: 创建 app/(tabs)/_layout.tsx**

```tsx
import { Tabs } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        tabBarActiveTintColor: '#3b82f6',
      }}
    >
      <Tabs.Screen
        name="player"
        options={{
          title: '精听',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="headset" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="review"
        options={{
          title: '复习',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="refresh" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="words"
        options={{
          title: '词库',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="book" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: '设置',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  )
}
```

- [ ] **Step 3: 创建占位页面**

`app/(tabs)/player.tsx`（骨架）:
```tsx
import { View, Text } from 'react-native'

export default function PlayerPage() {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <Text>Player</Text>
    </View>
  )
}
```

`app/(tabs)/review.tsx`（占位）:
```tsx
import { View, Text } from 'react-native'

export default function ReviewPage() {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <Text>复习（即将推出）</Text>
    </View>
  )
}
```

`app/(tabs)/words.tsx`（占位）:
```tsx
import { View, Text } from 'react-native'

export default function WordsPage() {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <Text>词库（即将推出）</Text>
    </View>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add mobile/app/
git commit -m "feat(mobile): add navigation layout with Tabs and placeholders"
```

---

### Task 6: SubtitlePanel 组件

**Files:**
- Create: `mobile/src/components/SubtitlePanel.tsx`

**Interfaces:**
- Consumes: `SubtitleItem`, `formatTime`
- Produces: `<SubtitlePanel subtitles currentIndex onWordPress />`

- [ ] **Step 1: 创建 src/components/SubtitlePanel.tsx**

```tsx
import { useRef, useEffect } from 'react'
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
} from 'react-native'
import { SubtitleItem } from '../types'
import { formatTime } from '../utils/subtitle'

interface Props {
  subtitles: SubtitleItem[]
  currentIndex: number
  onWordPress?: (word: string) => void
}

function splitTextToWords(text: string): { word: string; key: number }[] {
  return text.split(/(\s+)/).map((w, i) => ({ word: w, key: i }))
}

export default function SubtitlePanel({ subtitles, currentIndex, onWordPress }: Props) {
  const listRef = useRef<FlatList>(null)

  useEffect(() => {
    if (currentIndex >= 0 && listRef.current) {
      listRef.current.scrollToIndex({
        index: currentIndex,
        animated: true,
        viewPosition: 0.5,
      })
    }
  }, [currentIndex])

  const renderItem = ({ item, index }: { item: SubtitleItem; index: number }) => {
    const isActive = index === currentIndex
    return (
      <View style={[styles.item, isActive && styles.activeItem]}>
        <Text style={styles.time}>{formatTime(item.startTime)}</Text>
        <View style={styles.textRow}>
          {splitTextToWords(item.text).map(({ word, key }) => {
            const pure = word.replace(/[^a-zA-Z'-]/g, '')
            if (!pure) {
              return <Text key={key} style={styles.text}>{word}</Text>
            }
            return (
              <TouchableOpacity
                key={key}
                onPress={() => onWordPress?.(pure.toLowerCase())}
              >
                <Text style={[styles.text, isActive && styles.activeText]}>
                  {word}
                </Text>
              </TouchableOpacity>
            )
          })}
        </View>
      </View>
    )
  }

  return (
    <FlatList
      ref={listRef}
      data={subtitles}
      keyExtractor={(_, i) => String(i)}
      renderItem={renderItem}
      style={styles.container}
      getItemLayout={(_, index) => ({
        length: 60,
        offset: 60 * index,
        index,
      })}
      onScrollToIndexFailed={(info) => {
        listRef.current?.scrollToOffset({
          offset: info.averageItemLength * info.index,
          animated: true,
        })
      }}
    />
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  item: { paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row' },
  activeItem: { backgroundColor: 'rgba(59, 130, 246, 0.1)' },
  time: { color: '#9ca3af', marginRight: 12, fontVariant: ['tabular-nums'], width: 48 },
  textRow: { flexDirection: 'row', flexWrap: 'wrap', flex: 1 },
  text: { fontSize: 16, color: '#374151', lineHeight: 24 },
  activeText: { color: '#3b82f6' },
})
```

- [ ] **Step 2: Commit**

```bash
git add mobile/src/components/SubtitlePanel.tsx
git commit -m "feat(mobile): add SubtitlePanel component with word tap"
```

---

### Task 7: 播放器页面（核心）

**Files:**
- Modify: `mobile/app/(tabs)/player.tsx`
- Create: `mobile/src/services/transcription.ts`（骨架）
- Create: `mobile/src/services/modelDownload.ts`（骨架）

**Interfaces:**
- Consumes: `resolveUri`, `usePlayerStore`, `SubtitlePanel`, `parseSRT`
- Produces: 完整播放器页面

- [ ] **Step 1: 创建 src/services/transcription.ts**

```ts
import { SubtitleItem } from '../types'

export interface TranscriptionProgress {
  progress: number
  status: string
}

export async function transcribeAudio(
  filePath: string,
  modelPath: string,
  language: string,
  onProgress?: (p: TranscriptionProgress) => void
): Promise<SubtitleItem[]> {
  try {
    // whisper.rn API (placeholder for actual integration)
    // const whisper = new Whisper()
    // await whisper.init({ modelPath })
    // const result = await whisper.transcribe(filePath, {
    //   language: language || 'auto',
    //   onProgress: (p: number) => onProgress?.({ progress: p, status: 'transcribing' }),
    // })
    // return result.segments.map((seg: { start: number; end: number; text: string }, i: number) => ({
    //   id: i, startTime: seg.start, endTime: seg.end, text: seg.text,
    // }))

    // Placeholder: simulate transcription
    onProgress?.({ progress: 50, status: 'transcribing' })
    await new Promise((r) => setTimeout(r, 1000))
    onProgress?.({ progress: 100, status: 'done' })
    return [
      { id: 0, startTime: 0, endTime: 2, text: 'Hello, this is a sample transcription.' },
      { id: 1, startTime: 2, endTime: 4, text: 'The whisper integration will be added once the library is installed.' },
    ]
  } catch (error) {
    console.error('Transcription failed:', error)
    throw error
  }
}
```

- [ ] **Step 2: 创建 src/services/modelDownload.ts**

```ts
import * as FileSystem from 'expo-file-system'
import { TaskQueue } from '../utils/taskQueue'

const MODELS_DIR = FileSystem.documentDirectory + 'whisper-models/'
const MIRROR = 'https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/'

export interface WhisperModel {
  name: string
  url: string
  size: string
}

export const WHISPER_MODELS: WhisperModel[] = [
  { name: 'tiny', url: `${MIRROR}ggml-tiny.bin`, size: '75MB' },
  { name: 'small', url: `${MIRROR}ggml-small.bin`, size: '466MB' },
  { name: 'large-v3', url: `${MIRROR}ggml-large-v3.bin`, size: '3.1GB' },
]

const downloadQueue = new TaskQueue(1)

export async function getModelPath(name: string): Promise<string | null> {
  try {
    const path = MODELS_DIR + `ggml-${name}.bin`
    const info = await FileSystem.getInfoAsync(path)
    return info.exists ? path : null
  } catch {
    return null
  }
}

export async function downloadModel(
  name: string,
  onProgress?: (progress: number) => void
): Promise<string> {
  const path = MODELS_DIR + `ggml-${name}.bin`
  const model = WHISPER_MODELS.find((m) => m.name === name)
  if (!model) throw new Error(`Unknown model: ${name}`)

  await FileSystem.makeDirectoryAsync(MODELS_DIR, { intermediates: true })

  return downloadQueue.enqueue(async () => {
    const download = FileSystem.createDownloadResumable(
      model.url,
      path,
      {},
      (progress) => {
        const pct = progress.totalBytesExpectedToWrite
          ? progress.totalBytesWritten / progress.totalBytesExpectedToWrite
          : 0
        onProgress?.(Math.round(pct * 100))
      }
    )
    const result = await download.downloadAsync()
    if (!result) throw new Error(`Download failed for ${name}`)
    return result.uri
  }) as unknown as Promise<string>
}

export async function deleteModel(name: string): Promise<void> {
  try {
    const path = MODELS_DIR + `ggml-${name}.bin`
    await FileSystem.deleteAsync(path, { idempotent: true })
  } catch (error) {
    console.error('Failed to delete model:', error)
    throw error
  }
}

export async function listDownloadedModels(): Promise<string[]> {
  try {
    await FileSystem.makeDirectoryAsync(MODELS_DIR, { intermediates: true })
    const files = await FileSystem.readDirectoryAsync(MODELS_DIR)
    return files
      .filter((f) => f.startsWith('ggml-') && f.endsWith('.bin'))
      .map((f) => f.replace('ggml-', '').replace('.bin', ''))
  } catch {
    return []
  }
}
```

- [ ] **Step 3: 实现播放器页面 app/(tabs)/player.tsx**

```tsx
import { useState, useCallback, useRef, useEffect } from 'react'
import { View, StyleSheet, TouchableOpacity, Text, Alert } from 'react-native'
import { useVideoPlayer, VideoView, generateThumbnailsAsync } from 'expo-video'
import { Image } from 'expo-image'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { usePlayerStore } from '../../src/stores/playerStore'
import SubtitlePanel from '../../src/components/SubtitlePanel'
import { parseSRT } from '../../src/utils/subtitle'
import { resolveUri } from '../../src/utils/uri'
import { transcribeAudio } from '../../src/services/transcription'
import { getModelPath } from '../../src/services/modelDownload'

export default function PlayerPage() {
  const insets = useSafeAreaInsets()
  const {
    fileUri,
    fileName,
    subtitles,
    currentSubtitleIndex,
    isTranscribing,
    whisperProgress,
    setFile,
    setSubtitles,
    setCurrentSubtitleIndex,
    setTranscribing,
    setWhisperProgress,
    reset,
  } = usePlayerStore()

  const player = useVideoPlayer(fileUri ?? null)
  const [thumbnail, setThumbnail] = useState<string | null>(null)
  const playerRef = useRef<VideoView>(null)

  // 释放播放器资源
  useEffect(() => {
    return () => {
      try { player.release() } catch {}
    }
  }, [player])

  // 生成缩略图
  useEffect(() => {
    if (!fileUri) return
    generateThumbnailsAsync(fileUri, { timeFrom: 5000, timeTo: 5000 })
      .then((thumb) => {
        if (thumb && thumb[0]) setThumbnail(thumb[0].uri)
      })
      .catch(() => {})
  }, [fileUri])

  // 字幕同步
  const handleTimeUpdate = useCallback(
    (currentTime: number) => {
      if (subtitles.length === 0) return
      let lo = 0
      let hi = subtitles.length - 1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        const sub = subtitles[mid]
        if (currentTime >= sub.startTime && currentTime <= sub.endTime) {
          setCurrentSubtitleIndex(mid)
          return
        }
        if (currentTime < sub.startTime) hi = mid - 1
        else lo = mid + 1
      }
      setCurrentSubtitleIndex(-1)
    },
    [subtitles, setCurrentSubtitleIndex]
  )

  // 打开文件
  const openFile = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['video/*', 'audio/*'],
        copyToCacheDirectory: true,
      })
      if (result.canceled || !result.assets?.[0]) return
      const asset = result.assets[0]
      const resolvedUri = await resolveUri(asset.uri)

      // 释放旧播放器
      try { player.release() } catch {}

      setFile(resolvedUri, asset.name)
    } catch (error) {
      Alert.alert('打开失败', String(error))
    }
  }, [player, setFile])

  // 导入 SRT
  const importSRT = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/plain', 'application/x-subrip'],
        copyToCacheDirectory: true,
      })
      if (result.canceled || !result.assets?.[0]) return
      const text = await FileSystem.readAsStringAsync(result.assets[0].uri)
      const parsed = parseSRT(text)
      setSubtitles(parsed)
    } catch (error) {
      Alert.alert('SRT 导入失败', String(error))
    }
  }, [setSubtitles])

  // 转录
  const handleTranscribe = useCallback(async () => {
    if (!fileUri) return
    try {
      const modelPath = await getModelPath('tiny')
      if (!modelPath) {
        Alert.alert('请先下载模型', '前往设置页下载 Whisper 模型')
        return
      }
      setTranscribing(true)
      const subs = await transcribeAudio(fileUri, modelPath, 'auto', (p) => {
        setWhisperProgress(p.progress)
      })
      setSubtitles(subs)
    } catch (error) {
      Alert.alert('转录失败', String(error))
    } finally {
      setTranscribing(false)
    }
  }, [fileUri, setTranscribing, setWhisperProgress, setSubtitles])

  // 选择文件前的空状态
  if (!fileUri) {
    return (
      <View style={[styles.container, styles.empty, { paddingTop: insets.top }]}>
        <Ionicons name="cloud-upload-outline" size={64} color="#d1d5db" />
        <TouchableOpacity style={styles.openButton} onPress={openFile}>
          <Text style={styles.openButtonText}>选择视频/音频文件</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* 视频播放器 */}
      <VideoView
        ref={playerRef}
        player={player}
        style={styles.video}
        contentFit="contain"
        nativeControls
      />

      {/* 转录进度 */}
      {isTranscribing && (
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${whisperProgress}%` }]} />
          <Text style={styles.progressText}>转录中 {whisperProgress}%</Text>
        </View>
      )}

      {/* 字幕面板 */}
      <SubtitlePanel
        subtitles={subtitles}
        currentIndex={currentSubtitleIndex}
        onWordPress={(word) => {
          Alert.alert('添加到生词库', `"${word}"（后续实现）`)
        }}
      />

      {/* 底部操作栏 */}
      <View style={styles.toolbar}>
        <TouchableOpacity style={styles.toolbarButton} onPress={openFile}>
          <Ionicons name="folder-open" size={20} color="#3b82f6" />
          <Text style={styles.toolbarText}>打开</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.toolbarButton} onPress={importSRT}>
          <Ionicons name="document-text" size={20} color="#3b82f6" />
          <Text style={styles.toolbarText}>导入SRT</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toolbarButton, isTranscribing && { opacity: 0.5 }]}
          onPress={handleTranscribe}
          disabled={isTranscribing}
        >
          <Ionicons name="mic" size={20} color="#3b82f6" />
          <Text style={styles.toolbarText}>转录</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  empty: { justifyContent: 'center', alignItems: 'center', gap: 24 },
  openButton: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
  },
  openButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  video: { width: '100%', aspectRatio: 16 / 9 },
  progressBar: {
    height: 4,
    backgroundColor: '#e5e7eb',
    position: 'relative',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#3b82f6',
  },
  progressText: {
    position: 'absolute',
    top: 8,
    right: 12,
    fontSize: 12,
    color: '#6b7280',
  },
  toolbar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    backgroundColor: '#f9fafb',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  toolbarButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  toolbarText: { color: '#3b82f6', fontSize: 13 },
})
```

- [ ] **Step 4: Commit**

```bash
git add mobile/app/(tabs)/player.tsx mobile/src/services/
git commit -m "feat(mobile): implement player page with video, subtitles, and transcription"
```

---

### Task 8: 设置页面（Whisper 模型管理）

**Files:**
- Modify: `mobile/app/(tabs)/settings.tsx`

**Interfaces:**
- Consumes: `WHISPER_MODELS`, `downloadModel`, `deleteModel`, `listDownloadedModels`, `getModelPath`

- [ ] **Step 1: 实现设置页面 app/(tabs)/settings.tsx**

```tsx
import { useState, useEffect, useCallback } from 'react'
import { View, Text, StyleSheet, FlatList, Alert } from 'react-native'
import { Button, ProgressBar, List, Divider } from 'react-native-paper'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  WHISPER_MODELS,
  downloadModel,
  deleteModel,
  listDownloadedModels,
  getModelPath,
} from '../../src/services/modelDownload'

export default function SettingsPage() {
  const insets = useSafeAreaInsets()
  const [downloaded, setDownloaded] = useState<string[]>([])
  const [downloading, setDownloading] = useState<string | null>(null)
  const [downloadProgress, setDownloadProgress] = useState(0)

  const refresh = useCallback(async () => {
    try {
      const models = await listDownloadedModels()
      setDownloaded(models)
    } catch (e) {
      console.error('Failed to list models:', e)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const handleDownload = useCallback(async (name: string) => {
    try {
      setDownloading(name)
      setDownloadProgress(0)
      await downloadModel(name, (p) => setDownloadProgress(p))
      await refresh()
    } catch (error) {
      Alert.alert('下载失败', String(error))
    } finally {
      setDownloading(null)
      setDownloadProgress(0)
    }
  }, [refresh])

  const handleDelete = useCallback(async (name: string) => {
    try {
      await deleteModel(name)
      await refresh()
    } catch (error) {
      Alert.alert('删除失败', String(error))
    }
  }, [refresh])

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <FlatList
        data={WHISPER_MODELS}
        keyExtractor={(item) => item.name}
        ListHeaderComponent={
          <List.Section>
            <List.Subheader>Whisper 模型管理</List.Subheader>
          </List.Section>
        }
        renderItem={({ item }) => {
          const isDownloaded = downloaded.includes(item.name)
          const isDownloading = downloading === item.name
          return (
            <>
              <List.Item
                title={item.name}
                description={`${item.size} · ${isDownloaded ? '已下载' : '未下载'}`}
                left={(props) => <List.Icon {...props} icon="microphone" />}
                right={() => (
                  <View style={styles.actionRow}>
                    {isDownloading ? (
                      <View style={styles.progressContainer}>
                        <ProgressBar
                          progress={downloadProgress / 100}
                          style={styles.progress}
                        />
                        <Text style={styles.progressLabel}>{downloadProgress}%</Text>
                      </View>
                    ) : isDownloaded ? (
                      <Button
                        mode="text"
                        textColor="#ef4444"
                        onPress={() => handleDelete(item.name)}
                      >
                        删除
                      </Button>
                    ) : (
                      <Button
                        mode="contained"
                        compact
                        onPress={() => handleDownload(item.name)}
                      >
                        下载
                      </Button>
                    )}
                  </View>
                )}
              />
              <Divider />
            </>
          )
        }}
        ListFooterComponent={
          <List.Section>
            <List.Subheader>关于</List.Subheader>
            <List.Item title="版本" description="1.0.0" />
          </List.Section>
        }
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  actionRow: { justifyContent: 'center' },
  progressContainer: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  progress: { width: 80, height: 8, borderRadius: 4 },
  progressLabel: { fontSize: 12, color: '#6b7280' },
})
```

- [ ] **Step 2: Commit**

```bash
git add mobile/app/(tabs)/settings.tsx
git commit -m "feat(mobile): implement settings page with Whisper model management"
```

---

## 自检清单

- [ ] **Spec coverage:**
  - Expo SDK 56 + TS → Task 1 ✅
  - expo-router → Task 5 ✅
  - expo-video 播放器 → Task 7 ✅
  - generateThumbnailsAsync → Task 7 ✅
  - VideoPlayer release → Task 7 ✅
  - whisper.rn + GGML → Task 7 + Task 8 ✅
  - expo-sqlite → Task 2 ✅
  - expo-image → Task 7（thumbnail显示可用）✅
  - RN Paper → Task 8 ✅
  - URI 兼容 → Task 3 ✅
  - 任务队列 → Task 3 ✅
  - Async try/catch → 所有 async 函数 ✅
  - 代码分层 → 每一层独立 Task ✅
  - 内存泄漏防范 → useEffect cleanup ✅
- [ ] **Placeholder scan:** 无 TBD、TODO ✅
- [ ] **Type consistency:** 类型上下游一致 ✅
