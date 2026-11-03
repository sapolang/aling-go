# SRS 卡片背诵交互重设计

## 概述

重设计 `WordCard` (卡片背诵) 页面的交互流程、SRS 算法和视觉布局，从"点击翻转 + 同时看到答案和评分"改为 Anki 风格的两步骤流程，并将评分从 3 档升级为 SM-2 算法的 4 档。

## 交互流程

### 两步骤流程

```
正面（只看单词） → 点击/空格翻转 → 反面（答案显示，评分按钮延迟滑入） → 评分 → 下一张
```

### 正面

- 卡片居中，大字号（`text-5xl`）显示单词
- 下方显示音标（`text-xl text-muted-foreground`）
- 发音按钮（Speaker 图标 + "朗读"）
- 底部轻提示"按空格键翻面"
- 左右箭头切换卡片（上一个/下一个），翻面后翻回正面

### 反面

- 翻转动画保留 3D `rotateY(180deg)` 
- 翻转完成后 0.3s 延迟，评分按钮从底部滑入（`transition` + `translateY`）
- **翻回正面**：用户可再次点击卡片翻回正面重新思考，翻回后按钮隐藏
- 卡片内容层级：
  1. 单词 + 音标（小字号，灰色）
  2. 释义（大字号 `text-3xl`，醒目）
  3. 例句（斜体，灰色）
  4. 标签 badges
- 评分按钮行：
  - "忘记"（红 / 快捷键 1）→ 1天后
  - "困难"（橙 / 快捷键 2）→ 动态显示实际间隔
  - "良好"（蓝 / 快捷键 3）→ 动态显示实际间隔
  - "简单"（绿 / 快捷键 4）→ 动态显示实际间隔
  - 每个按钮下方的间隔天数由 SM-2 函数根据当前词条的 EF/interval/repetitions 计算，不同词条不同按钮显示的间隔可能不同

### 队列信息

- 顶部进度条 + 文字："今日待复习 48 | 已完成 12 | 剩余 36"
- 移除硬编码 LIMIT 20，改为获取全部到期词条
- 顶部进度条在页面加载时显示总量，实时更新

## SRS 算法 (SM-2)

### 新增数据库字段

在 `words` 表中新增三列：

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `repetitions` | `INTEGER` | `0` | 连续正确次数 |
| `efactor` | `REAL` | `2.5` | 难度系数 (E-Factor) |
| `interval` | `INTEGER` | `0` | 上次间隔天数 |

### 评分与调度

| 按钮 | 质量 q | 间隔计算 | EF 调整 | repetitions |
|------|--------|----------|---------|-------------|
| 忘记 | 1 | 1 天，重置 | 不变 | 重置为 0 |
| 困难 | 3 | 首次 1 天，否则 `interval * 1.2` | SM-2 公式 | 不变 |
| 良好 | 4 | 首次 1 天→6 天，之后 `interval * EF` | SM-2 公式 | +1 |
| 简单 | 5 | `interval * EF * 1.3` | SM-2 公式 | +1 |

所有等级的 EF 使用同一公式计算：

```
EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
```

q 为质量评分（1-5），EF' 不低于 1.3。

### `next_review` 计算

```
next_review = 今天 + interval（天数向上取整）
```

格式保持 `YYYY-MM-DD`。

### 兼容性

- 现有词条的 `repetitions`、`efactor`、`interval` 默认为 0 / 2.5 / 0
- 旧 `level` 字段保留但不参与 SRS 计算
- 首次复习（interval=0）按 repetition=0 的逻辑处理

## 数据库迁移

### Go 端

在 `migrate.go` 新增迁移逻辑：

```go
func migrateSRSTables() error {
    // 添加新列（SQLite 不支持 ADD COLUMN IF NOT EXISTS，使用 ALTER TABLE 尝试）
    db.Exec("ALTER TABLE words ADD COLUMN repetitions INTEGER DEFAULT 0")
    db.Exec("ALTER TABLE words ADD COLUMN efactor REAL DEFAULT 2.5")
    db.Exec("ALTER TABLE words ADD COLUMN interval INTEGER DEFAULT 0")
    return nil
}
```

在 `createTables()` 中新增字段定义，新安装用户直接使用完整 DDL。

### TypeScript 端

`Word` 接口新增字段：

```typescript
interface Word {
  // ... 现有字段
  repetitions: number
  efactor: number
  interval: number
}
```

## API 变更

### Go 方法

- `DbWordsGetReview()`：移除 LIMIT 20，返回所有 `next_review <= today` 的词条
- `DbWordsGetReviewCount()`：新增方法，返回待复习总数（用于进度条）

### 前端 Store

- `loadReview()` 一次性加载所有到期词条
- 新增 `reviewTotal` 状态记录总量
- `updateWord` 时同步更新本地 reviewWords 数组（不移除，仅更新属性）

## 前端变更

### 文件修改

| 文件 | 改动 |
|------|------|
| `WordCard.tsx` | 完全重写交互逻辑、布局、评分按钮 |
| `wordStore.ts` | 新增 `repetitions`/`efactor`/`interval` 字段、新增 `loadReviewCount` |
| `AddWordModal.tsx` | 字段更新（可选，新词默认值已兼容） |
| `bridge.ts` | 类型声明更新 |

### 新增共享常量文件

`src/lib/srs.ts`：评分选项、SM-2 计算函数、EF 计算函数

```typescript
export const gradeOptions = [
  { grade: 1, label: '忘记', key: '1', className: 'bg-red-500' },
  { grade: 2, label: '困难', key: '2', className: 'bg-orange-500' },
  { grade: 3, label: '良好', key: '3', className: 'bg-blue-500' },
  { grade: 4, label: '简单', key: '4', className: 'bg-green-500' },
]

// desc 动态计算，不在此常量化
// 忘记 = '1天后'
// 其他 = sm2(...).interval + '天后'

export function sm2(efactor: number, interval: number, repetitions: number, quality: number) {
  // 返回 { nextReview, newEfactor, newInterval, newRepetitions }
}
```

### 键盘快捷键

| 按键 | 操作 |
|------|------|
| Space | 翻转卡片 |
| 1 | 忘记 |
| 2 | 困难 |
| 3 | 良好 |
| 4 | 简单 |
| ← | 上一个（翻回正面） |
| → | 下一个（翻回正面） |

### 动画

1. 翻转：保留现有 500ms `rotateY` 3D 动画
2. 评分按钮：翻面后延迟 300ms，`translateY` + `opacity` 过渡 200ms 滑入
3. 卡片切换：200ms `opacity` 淡出 + 淡入

## 视觉设计要点

### 进度条

- 顶部全宽细条（h-1），底色 `bg-muted`，进度色 `bg-primary`
- 进度条下方一行文字：`今日待复习 48 | 已完成 12 | 剩余 36`
- 实时更新：评完一张后数字刷新

### 卡片（正面）

- `max-w-md mx-auto`，卡片 `min-h-[320px]`
- 单词 `text-5xl font-bold` 居中
- 音标 `text-xl text-muted-foreground` 居单词下方 8px
- 发音按钮带 `Speaker` 图标
- 底部 `text-xs text-muted-foreground` 提示"按空格键翻面"

### 卡片（反面）

- 内容区 flex-col 纵向排列，间距 gap-4
- 释义使用 `text-3xl font-semibold text-primary` 突出
- 例句 `text-base text-muted-foreground italic`
- 标签 badges 小字号

### 评分按钮栏

- 4 个按钮 `flex gap-3 justify-center`
- 按钮宽 `min-w-[80px]`，圆角 `rounded-xl`，白色文字
- 颜色：红(忘记) / 橙(困难) / 蓝(良好) / 绿(简单)
- 每个按钮双行：标签名 + 下次复习日期小字
- 快捷键提示在按钮底部角标

### 空状态

- 无待复习词条时，居中卡片：
  - 标题 "今日没有待复习的词条"
  - 副标题 "前往播放器学习新词或浏览生词库"
  - 显示统计："词库共 N 个词 | 下一次复习在 X 天后"

### 完成状态

- 全部复习完后，居中卡片：
  - 标题 "🎉 今日复习完成！"
  - 统计 "本次复习了 N 个词"
  - 按钮"再看一遍"（可选）

## 边缘情况

1. **网络/DB 错误**：评分后若 updateWord 失败，显示 toast 提示，卡片不自动翻页，允许重试
2. **并发评分**：评分期间禁用按钮，防止双击产生多次提交
3. **窗口 resize**：卡片尺寸使用相对单位 + min-h，缩放友好
4. **数据导出**：导出 JSON 需包含新增字段，导入时兼容旧数据（缺字段则用默认值）
