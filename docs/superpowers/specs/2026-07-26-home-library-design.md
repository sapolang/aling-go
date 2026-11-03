# 首页文件库设计

**日期**: 2026-07-26
**分支**: feat/desktop
**状态**: 设计中

## 目标

将当前播放器的文件列表（打开 app 后的默认着陆页）替换为带分类的文件浏览器，支持文件夹管理、多选编辑、视图切换和排序。

## 数据模型

### library.json

替换现有的 `recent.json`，新增文件类型和文件夹归属字段。

```json
{
  "folders": [
    { "id": "uuid", "name": "韩语学习", "createdAt": "2026-07-26T..." }
  ],
  "files": [
    {
      "path": "/path/to/file.mp4",
      "name": "file.mp4",
      "type": "video",
      "folderId": "uuid",
      "addedAt": "2026-07-26T..."
    }
  ]
}
```

文件类型（`type`）判定规则：
- `video`: mp4, mkv, avi, mov, webm, flv, wmv
- `audio`: mp3, wav, m4a, ogg, flac, aac, wma
- `pdf`: pdf

文件夹上限 50 个，文件上限 200 条。

## Go 后端 API

### 新增方法

| 方法 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `LibraryList()` | — | JSON string | 返回 `{folders, files}` 完整结构 |
| `LibraryImport()` | — | JSON string | 打开系统文件对话框，导入选中的文件，返回更新后的 files |
| `LibraryRemove(pathsJSON)` | string[] JSON | JSON string | 批量删除文件记录（不删实际文件），返回更新后的 files |
| `LibraryRename(path, newName)` | string, string | JSON string | 重命名文件 |
| `LibraryMove(pathsJSON, folderId)` | string[] JSON, string | JSON string | 将文件移动到指定文件夹，folderId 为空则移出文件夹 |
| `FolderCreate(name)` | string | JSON string | 创建虚拟文件夹，返回更新后的 folders |
| `FolderDelete(id)` | string | JSON string | 删除文件夹（文件回到未归类），返回更新后的 folders |
| `FolderRename(id, name)` | string, string | JSON string | 重命名文件夹 |

### LibraryList 返回结构

```json
{
  "folders": [...],
  "files": [...]
}
```

前端通过 `JSON.parse` 解析后使用。

### 向后兼容

`RecentAdd()` 和 `RecentList()` 保留，内部改为写入/读取 `library.json` 的 files 数组（仅存 path/name，type/folderId 留空），保持现有播放器逻辑不报错。

## 前端

### 路由

`/` 不再重定向到 `/player`，改为直接渲染新的首页组件。Player 始终挂载（保持不变）。

新增路由：
```
/ → Home（新首页 = 文件库）
/home → Home（重定向到 /）
/player → Player（不变，播放时可见）
```

### 组件结构

**新组件 `pages/Home.tsx`（重写）**

```
Home
├── Toolbar                    # 工具栏
│   ├── Button "导入"
│   ├── Button "编辑"（切换编辑模式）
│   ├── Button "新建文件夹"
│   ├── Button 视图切换（网格/列表图标）
│   └── Select 排序方式
├── CategoryTabs               # 分类标签行
│   └── Tab: 全部 | 文件夹 | 视频 | 音频 | PDF
└── FileGrid / FileList         # 文件展示区
    ├── FolderCard              # 文件夹卡片
    └── FileCard                # 文件卡片（视频缩略图/音频图标/PDF图标）
```

### 视图模式

- **网格模式（默认）**：卡片式，缩略图 + 文件名，文件夹显示名称 + 文件计数
- **列表模式**：表格式，图标 + 文件名 + 类型 + 添加日期

### 编辑模式

- 点击"编辑"按钮进入编辑模式
- 每个文件/文件夹出现复选框
- 选中文件后可执行：移动到文件夹（下拉选择）、删除
- 顶部出现"全选"和已选计数
- 再次点击"编辑"或完成操作后退出编辑模式

### 排序

- 按名称（A-Z）
- 按添加时间（新→旧，默认）
- 按类型

### 分类标签

```
全部 | 📁 文件夹 | 🎬 视频 | 🎵 音频 | 📄 PDF
```

- "全部"：显示所有文件夹和文件
- "文件夹"：仅显示文件夹
- "视频/音频/PDF"：仅显示对应类型文件 + 文件夹（因为文件夹包含混合类型文件）

### 点击行为

- **文件夹**：进入文件夹内视图（面包屑导航），显示该文件夹下的文件
- **视频/音频文件**：调用现有 `openFile()` → 进入播放器
- **PDF 文件**：调用系统 `open` 命令，用默认 PDF 阅读器打开

### 空文件夹内

在文件夹内且无文件时，显示"此文件夹为空，点击导入添加文件"提示。

## 交互流程

1. **导入** → 系统文件对话框 → 选择文件 → 按扩展名定 type → 写入 library.json → 刷新界面
2. **新建文件夹** → 弹出输入框 → 输入名称 → 创建 → 可选：进入文件夹后提示导入
3. **编辑 → 移动** → 选中文件 → 点击移动到 → 下拉选目标文件夹 → 确认移动
4. **编辑 → 删除** → 选中文件 → 点击删除 → 确认对话框 → 从库中移除（不删原文件）
5. **编辑 → 删除文件夹** → 选中文件夹 → 点击删除 → 确认对话框 → 文件夹内文件归为未归类

## 不纳入范围

- 拖拽移动文件到文件夹（可后续迭代）
- 系统文件浏览器集成
- PDF 内嵌预览
- 文件去重检测
