<p align="center">
  <img src="build/appicon.png" alt="语练" width="96" height="96">
</p>

<h1 align="center">语练 · aling-go</h1>

<p align="center">本地优先的英语学习桌面应用：边看视频、听播客边查词，生词按 SRS 安排复习。</p>

<p align="center">
  <a href="https://github.com/sapolang/aling-go/releases/latest"><img src="https://img.shields.io/github/v/release/sapolang/aling-go?label=release" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/sapolang/aling-go" alt="License"></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey" alt="Platform">
  <img src="https://img.shields.io/badge/Wails-v3-DF0000" alt="Wails v3">
</p>

## 功能

- **媒体播放**：播放本地视频/音频，SRT 字幕同步，波形可视化与播放记忆。
- **AI 字幕**：没有字幕的音视频用 Whisper.cpp 转录；模型可在设置中下载、切换。
- **查词与收藏**：播放时划词查词，一键收藏句子片段，按标签归类。
- **生词库 + SRS**：Anki 式间隔复习（EF、间隔、重复次数），支持拼写练习与复习统计。
- **文章打字**：按分类阅读文章，记录正确率与 WPM，并配有理解题。
- **播客 / RSS**：订阅 RSS，下载单集；支持把 YouTube、B 站频道转为 RSS，B 站可扫码登录后播放。
- **AI 翻译**：OpenAI 兼容接口（DeepSeek 等），字幕与片段流式翻译，Key 只保存在本地。
- **学习数据**：学习历史、学习统计、词表导入导出、本地自动备份、应用内更新（支持断点续传）。

## 下载

前往 [Releases](https://github.com/sapolang/aling-go/releases/latest) 获取最新版本。

| 平台 | 文件 | 说明 |
|------|------|------|
| macOS（Apple Silicon） | `aling-go-<version>-arm64.dmg` | 安装用，推荐 |
| macOS（Apple Silicon） | `aling-go-<version>-darwin-arm64.zip` | 应用内更新使用的格式 |
| Windows / Intel Mac | — | 暂未提供预编译包，可按下方步骤从源码构建 |

> 应用使用 ad-hoc 签名、未经 Apple 公证。首次打开若被 Gatekeeper 拦截，请右键点击应用 → 打开。

## 快速开始

需要 Go 1.26.11+、Node.js 26+、[Wails v3 CLI](https://wails.io/)（版本与 `go.mod` 保持一致），以及对应平台的构建依赖：macOS 安装 Xcode Command Line Tools，Windows 安装 WebView2。

```bash
make frontend-install   # 安装前端依赖
make sidecar            # 可选：构建 Whisper / FFmpeg sidecar，用于字幕转录
make dev                # 开发模式（热重载）
```

## 构建

```bash
make build              # 当前平台产物
make dmg                # macOS .dmg
make zip                # macOS 更新包 + SHA256SUMS
make exe                # Windows .exe
make dist               # .app + sidecar
make clean              # 清理构建产物
make upgrade-wails      # 升级 Wails CLI / Go 依赖 / 前端 runtime
```

macOS 应用启动时会从 `Resources/` 读取 `whisper-sidecar`、`ffmpeg`、`dict.db`、`articles.db`，打包目标已包含这一步。

## 测试与检查

```bash
go test ./...                     # Go 测试
make vet                          # go vet
make lint                         # golangci-lint
make test                         # 前端 typecheck + ESLint
make sqlc                         # 由 schema/queries 重新生成数据访问代码
cd frontend && npm run build      # TypeScript 检查 + 构建
cd frontend && npm run format:check
```

## 数据存储

所有数据保存在本地平台配置目录，不需要账号：

- **macOS**：`~/Library/Application Support/aling-go/`
- **Windows**：`%AppData%/aling-go/`

| 路径 | 内容 |
|------|------|
| `userData.db` | 生词、标签、复习进度、收藏、历史、打字记录、AI 缓存 |
| `library.json` | 媒体库目录结构 |
| `backups/` | 自动备份（保留最近 7 份） |
| `subtitle-cache/` | 在线字幕与转录结果缓存 |
| `whisper-models/` | 下载的 Whisper 模型 |

内置的 `dict.db`（ECDICT 词典）与 `articles.db`（文章/分类）随应用发布，不写入用户数据目录。

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Go |
| 桌面框架 | Wails v3 |
| 前端 | React 18 · TypeScript · Vite |
| 样式与 UI | Tailwind CSS · Radix UI |
| 状态管理 | Zustand |
| 数据库 | SQLite（`modernc.org/sqlite`） |
| 语音转录 / 媒体处理 | Whisper.cpp · FFmpeg（sidecar） |

## 项目结构

```
aling-go/
├── main.go              # 入口：嵌入前端产物，调用 bootstrap.Run
├── internal/
│   ├── bootstrap/       # 启动编排、服务注册、窗口与托盘
│   ├── core/            # 数据库连接、schema、迁移
│   ├── study/           # 单词、标签、SRS、收藏、词典进度
│   ├── content/         # 文章、媒体库、播放、字幕、转录、RSS
│   ├── system/          # 平台能力、备份、更新、AI 翻译
│   ├── dict/            # 内置只读词典
│   └── store/           # schema.sql、queries/、sqlc 生成代码
├── cmd/                 # 文章下载、词典构建等 CLI
├── frontend/src/        # pages · components · stores · api/bridge.ts · lib
├── sidecar/             # Whisper.cpp / FFmpeg 构建脚本
└── build/               # 平台构建配置与图标
```

## 参与贡献

欢迎提交 Issue 和 PR。开始前请先读 [AGENTS.md](AGENTS.md)，其中写明目录职责、Wails 服务写法、sqlc 数据流程和提交规范。

提交前请运行 `go test ./...`、`make vet`、`make lint`，前端改动再加上 `npm run build` 与 `npm run lint`。CI 会校验这些检查，以及 sqlc 生成代码是否与源文件同步。

## 许可证

[MIT](LICENSE)

## 致谢

[Wails](https://wails.io/)、[Whisper.cpp](https://github.com/ggerganov/whisper.cpp)、[FFmpeg](https://ffmpeg.org/)、[ECDICT](https://github.com/skywind3000/ECDICT)。
