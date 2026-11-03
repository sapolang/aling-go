# 词典背单词功能设计

## 概述

在 aling-go Wails 桌面应用中，利用现有的 `dict.db`（含 mini_dict 表，10689 词）新增"单词书架 → 卡片背词"功能。

## 交互流程

### 页面 1：单词书架 (DictPage)
- 路由 `/dict`
- 调用 `DbDictTags` 获取所有标签列表
- 每个标签展示为一张"单词书"卡片，显示名称和词数
- 点击标签进入对应的复习页

### 页面 2：卡片复习 (ReviewPage)
- 路由 `/dict/:tag`
- 顶部显示进度（如 `2/2560`）
- 显示单词卡片：
  - 默认显示单词（word）
  - 点击卡片翻转，展示 phonetic + translation + definition
- 三个操作按钮：
  - **👎 不认识**：记录到 unknownWords 列表，跳转下一词
  - **👍 认识**：记录到 knownWords，跳转下一词，不再展示
  - **➕ 入库**：调用 `DbDictAddToWordList` 添加到个人词库
- 退出时若 unknownWords 非空，提示"还有 X 个不认识的词，是否添加到词库？"

## API 设计

Go 方法（App struct 绑定），位于 `internal/dict/db.go`：

```go
type DictWord struct {
    Word        string
    Phonetic    string
    Translation string
    Definition  string
    Pos         string
    Tag         string
}

func (a *App) DbDictTags() ([]struct{Tag string; Count int}, error)
func (a *App) DbDictWords(tag string) ([]DictWord, error)
func (a *App) DbDictAddToWordList(words []DictWord) (added int, skipped int, err error)
```

## 数据库

### dict.db（只读）
- 表 `mini_dict`：word, phonetic, translation, definition, pos, tag
- 标签存储在 `tag` 列，空格分隔（如 `"gk cet4 cet6 ky toefl gre"`）
- 搜索按标签筛选：`WHERE tag LIKE '%cet4%'`
- 当前用户数据存在 `userData.db` 的 `words` 表

### 添加逻辑
- `DbDictAddToWordList` 对 `words` 表执行 `INSERT OR IGNORE`，以 word 去重
- 添加时复用现有字段映射：DictWord → Word 表的对应列

## 前端

### 新增文件
- `frontend/src/pages/DictPage.tsx` — 单词书架
- `frontend/src/pages/ReviewPage.tsx` — 卡片复习
- `frontend/src/stores/dictStore.ts` — Zustand 状态管理

### 修改文件
- `frontend/src/App.tsx` — 添加路由 `/dict`, `/dict/:tag`

### 状态管理（dictStore）
```typescript
interface DictStore {
  books: { tag: string; name: string; count: number }[]
  currentBook: string | null
  words: DictWord[]
  currentIndex: number
  knownWords: Set<string>
  unknownWords: Set<string>
  addToWordList: Set<string>
}
```

## Go 后端

### 新增文件
- `internal/dict/db.go` — 词典数据库查询逻辑
- `internal/dict/models.go` — DictWord 类型定义

### 修改文件
- `app.go` — 在 App struct 上挂载 DbDict* 方法

## 错误处理

- dict.db 打不开 → Go 返回错误，前端 toast 提示"词典数据库未找到"
- 添加单词时使用 `INSERT OR IGNORE`，返回 added/skipped 计数
- 空标签 → 书架页不显示词数为 0 的书
- 空搜索结果 → 提示"该单词书暂无单词"

## 验收标准

1. 导航到 `/dict`，看到所有标签作为单词书展示，每本显示词数
2. 点击"cet4"单词书，进入复习页，显示 `1/2560`
3. 点击卡片，翻转显示完整释义
4. 点击"不认识"跳转下一词并记录
5. 点击"认识"跳转下一词
6. 点击"入库"将单词添加到个人词库，确认后在 userData.db 中可查到
7. 退出时提示未入库的生词
8. 界面风格与现有页面一致
