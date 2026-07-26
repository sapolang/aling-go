# 文章打字练习 - 设计说明

## 概述

新增「文章打字」功能，受 [typewords.cc](https://typewords.cc/) 启发。用户阅读一篇内置文章，然后逐字打字练习，通过肌肉记忆强化英语学习和拼写能力。

## 一、数据来源

文章数据从 [typewords.cc](https://typewords.cc/) 的开放 API 获取：

| API | 说明 |
|-----|------|
| `https://files.typewords.cc/list/article.json` | 文章分类列表 |
| `https://files.typewords.cc/dicts/en/article/{url}` | 某分类下的文章列表（含正文、翻译、音频路径、LRC 时间戳） |

用 `cmd/articles-download/main.go` 工具将数据导入到 `articles.db`（SQLite），随应用发布。音频不下载，运行时直接从 typewords.cc CDN 流式播放（`https://files.typewords.cc` + `audioSrc` 路径）。

## 二、数据模型

### articles.db 表结构

**categories 表**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 分类 ID |
| en_name | TEXT | 英文标识，如 `nce3` |
| name | TEXT | 中文名，如「新概念英语3」 |
| description | TEXT | 分类描述 |
| url | TEXT | API 中对应的文件名 |
| length | INTEGER | 文章总数 |
| cover | TEXT | 封面图路径 |

**articles 表**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 文章 ID（来自 API） |
| category_en_name | TEXT | 所属分类 en_name |
| title | TEXT | 英文标题 |
| title_translate | TEXT | 中文标题 |
| text | TEXT | 英文正文 |
| text_translate | TEXT | 中文翻译 |
| audio_src | TEXT | 音频文件路径 |
| lrc_position | TEXT | LRC 时间戳 JSON `[[start, end], ...]` |
| question_json | TEXT | 课文问题 JSON（text, translate, start, end） |
| index_order | INTEGER | 排序序号（文章在列表中的位置） |

### userData.db 新增表

**typing_records 表**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK AUTO | 自增主键 |
| article_id | INTEGER | 文章 ID |
| mode | TEXT | `follow` 跟打 / `dictation` 默写 |
| accuracy | REAL | 正确率 0.0 - 1.0 |
| wpm | REAL | 每分钟单词数 |
| duration | INT | 耗时（秒） |
| mistakes | TEXT | 错词 JSON |
| created_at | TEXT | 时间戳 ISO8601 |

**typing_progress 表**

| 字段 | 类型 | 说明 |
|------|------|------|
| article_id | INTEGER PK | 文章 ID |
| mode | TEXT PK | 模式 |
| position | INT | 上次练习到的字符位置 |
| completed | BOOL | 是否至少完成过一次 |
| best_accuracy | REAL | 最佳正确率 |
| best_wpm | REAL | 最高速度 WPM |
| updated_at | TEXT | 更新时间 |

## 三、页面结构

### 文章列表页 `/articles`

- 顶部：分类 tabs（教材 / 文学）
- 难度筛选：全部 / 1-5 级
- 列表项：标题、作者、难度星星、是否已完成标记（✓）、最佳成绩显示（如 `98% · 45 WPM`）
- 排序：默认按 index_order，可按字母排序

### 打字练习页 `/articles/:id`

- **顶栏**：文章标题、模式切换按钮（跟打 / 默写）、音频播放按钮（有音频时显示）
- **原文显示区**：等宽字体大字号，每个字符状态着色
- **用户输入区**：捕获键盘事件，不显示可见 input
- **底部状态栏**：正确率、速度 WPM、进度（百分比 + 进度条）

## 四、打字交互

### 跟打模式

- 每个字符状态：未打到(灰色) / 当前位置(闪烁蓝色光标) / 正确(绿色) / 错误(红色背景)
- 输入正确字符：自动前进到下一个字符
- 输入错误字符：标红，停留在当前位置，不前进
- Backspace：回退到上一个字符，清除错误标记
- 标点、大小写按原文严格匹配
- 空格换行等显示 `␣` `↵` 等可见符号

### 默写模式

- 原文隐藏，用户凭记忆输入
- 以单词为粒度（空格/标点触发）：每完成一个单词，显示答案
  - 正确：绿色渲染该词，继续
  - 错误：红色显示「原文 vs 输入」，继续（不阻塞）
- Tab 键：揭示下一个单词（提示，3秒后自动隐藏）
- 忽略多余空格，只按原文序列匹配

### 完成弹窗

- 成绩展示：正确率、WPM、耗时
- 错词列表：原词 / 用户输入 / 出现次数，可展开看上下文
- 「将错词加入生词库」按钮：一键批量调用 `AddWord`
- 「再来一次」按钮：重新开始当前文章
- 「返回列表」按钮

## 五、Go 后端接口

### articles.db 查询

- `GetCategories()` → 分类列表
- `GetArticles(categoryEnName)` → 某分类下的文章列表
- `GetArticle(id)` → 文章详情（正文、翻译、音频路径等）
- `GetArticleAudioURL(id)` → 拼接完整的音频 CDN URL

### 练习记录和进度

- `GetTypingProgress(articleId, mode)` → 练习进度
- `SaveTypingProgress(articleId, mode, position, completed, accuracy, wpm)` → 保存进度
- `GetTypingRecords(articleId)` → 历史练习记录
- `SaveTypingRecord(record)` → 保存练习记录

### 生词库

- `AddWordsBatch(words)` → 批量添加错词为生词

## 六、错误词加入生词库

打错的词通过 `AddWordsBatch` 批量加入生词库：
- 前端调用现有 dict.db 查询该词的释义，自动填充
- 对于 dict.db 中没有的错误词（如较冷僻），显示空白弹窗让用户手动填写释义
- 重复的词自动跳过，不重复添加

## 七、音频播放

- 音频不随应用打包，运行时直接从 typewords.cc CDN 流式播放
- CDN 基础 URL：`https://files.typewords.cc`
- 拼接路径：CDN 基础 URL + 文章 `audio_src` 字段
- 顶栏播放按钮 + 进度控制（复用 HTML5 `<audio>`）

## 八、文章数据下载工具

`cmd/articles-download/main.go` — 一次性离线导入工具：

1. 请求 `https://files.typewords.cc/list/article.json` 获取分类
2. 逐分类请求 `https://files.typewords.cc/dicts/en/article/{url}` 获取文章
3. 写入 `articles.db`（categories + articles 表）

```
go run ./cmd/articles-download/
```

产物 `articles.db` 随应用打包发布。
