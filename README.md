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
| Windows（x64） | `aling-go-<version>-amd64-installer.exe` | 安装用，当前用户安装，无需管理员权限 |
| Windows（x64） | `aling-go-<version>-windows-amd64.zip` | 应用内更新使用的格式，仅含 exe |

### macOS 首次打开

应用使用 **ad-hoc 签名**，没有 Apple Developer ID，也未经 Apple 公证。macOS 15 起，从浏览器下载后首次打开可能出现：

- 提示“已损坏，无法打开”或“无法验证开发者”；
- 不弹任何提示，双击没反应；
- 「应用程序」里的图标变成问号。

这些都不是安装包损坏，而是 Gatekeeper 给下载文件打的隔离标记（`com.apple.quarantine`）在拦截。任选一种方式放行，只需一次：

1. **挂载前先去掉 DMG 的隔离标记**（推荐，之后拖出来的应用不会再被拦截）：

   ```bash
   xattr -d com.apple.quarantine ~/Downloads/aling-go-*.dmg
   ```

2. **安装后去掉应用的隔离标记**：

   ```bash
   xattr -dr com.apple.quarantine /Applications/aling-go.app
   ```

3. **系统设置里放行**：先双击一次应用触发拦截，再到「系统设置 → 隐私与安全性」页面底部点「仍要打开」。

若放行后图标仍是问号，重建该应用的 Launch Services 注册：

```bash
/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -f /Applications/aling-go.app
killall Finder
```

> 根治办法是 Developer ID 签名 + Apple 公证（需要 Apple Developer Program 账号）。在此之前，上述步骤是 macOS 安全机制要求的，无法省略。Windows 安装包未做代码签名，SmartScreen 会提示“未知发布者”，选择“仍要运行”即可。

## 快速开始

需要 Go 1.26.11+、Node.js 26+、[Wails v3 CLI](https://wails.io/)（版本与 `go.mod` 保持一致），以及对应平台的构建依赖：macOS 安装 Xcode Command Line Tools，Windows 安装 WebView2。

```bash
make frontend-install   # 安装前端依赖
make sidecar            # 可选：构建 Whisper / FFmpeg，并获取 yt-dlp sidecar
make dev                # 开发模式（热重载）
```

## 命令行工具（macOS）

应用内置的 ffmpeg、yt-dlp 和 whisper-sidecar 可以通过 `aling-go tool` 调用，参数、标准输入输出和退出码都会原样透传，适合写脚本或配合管道使用。

首次使用时，先注册 `aling-go` 命令（需要管理员授权，会在 `/usr/local/bin/aling-go` 创建软链）：

```bash
/Applications/aling-go.app/Contents/MacOS/aling-go install-cli
```

之后就可以在任意目录运行：

```bash
aling-go tool list                  # 查看内置工具及其路径
aling-go tool ffmpeg -version       # 参数原样透传给 ffmpeg
aling-go tool yt-dlp --version
aling-go tool whisper --help        # whisper.cpp 的 whisper-cli 参数
aling-go uninstall-cli              # 撤销注册
```

说明：

- `ffmpeg` / `yt-dlp` 优先使用 `PATH` 中的版本，找不到时回退到应用内置的 sidecar；`whisper` 只使用应用内置的 `whisper-sidecar`。
- `whisper` 不会自动选择模型，需要按 whisper.cpp 的用法自行传 `-m <模型文件>`；模型通常位于 `~/Library/Application Support/com.aling-go/whisper-models/`。
- `tool` 子命令不会启动 GUI 或打开数据库；不带参数运行 `aling-go` 仍会正常打开应用。
- 如果应用不在 `/Applications/aling-go.app`，请把注册命令里的路径换成实际位置。
- 如果 `/usr/local/bin/aling-go` 已存在且不是软链，`install-cli` 会拒绝覆盖；`uninstall-cli` 也只删除软链，不会动普通文件。

## 构建

```bash
make build              # 当前平台产物
make dmg                # macOS .dmg
make check-dmg          # 校验 .dmg 内 App 的结构、签名与 Gatekeeper 状态
make zip                # macOS 更新包 + SHA256SUMS
make exe                # Windows NSIS 安装包（需 Windows + NSIS，见下）
make dist               # .app + sidecar
make clean              # 清理构建产物
make upgrade-wails      # 升级 Wails CLI / Go 依赖 / 前端 runtime
```

macOS 应用启动时会从 `Resources/` 读取 `whisper-sidecar`、`ffmpeg`、`yt-dlp`、`dict.db`、`articles.db`，打包目标已包含这一步。

### Windows 构建

```bash
# 1. 在 MSYS2 MINGW64 下构建 sidecar（首次编译较慢）
bash sidecar/build-windows.sh

# 2. 安装 NSIS 并加入 PATH，然后打包当前用户范围的安装程序
make exe
# 产物：bin/aling-go-<version>-amd64-installer.exe
```

安装程序装到 `%LOCALAPPDATA%\Programs\aling-go`（目录名固定用 ASCII，中文只作为显示名出现在向导标题、快捷方式和卸载列表里），不需要管理员权限，因此应用内自动更新可以直接替换 exe。安装包会把 `aling-go.exe`、`ffmpeg.exe`、`whisper-sidecar.exe`、`yt-dlp.exe`、`dict.db`、`articles.db` 放在同一目录，应用从 exe 所在目录读取这些资源。

应用内自动更新只替换 `aling-go.exe`；sidecar 与数据库不会随自动更新升级，需要更新时请重新下载安装包覆盖安装。

想装到其他盘时，在目标盘先新建一个文件夹再在安装向导里选中（例如 `D:\Apps\aling-go`）。安装包以当前用户权限运行，不会写入 `Program Files` 这类受保护位置，也不能直接装到盘符根目录（`D:\`）或网络共享根目录 —— 卸载时会 `RMDir /r` 整个安装目录，装到根目录等于让卸载器删整盘。

旧版本装在 `%LOCALAPPDATA%\Programs\语练`。安装程序不会自动删除旧目录：升级时最好先运行旧目录里的 `uninstall.exe` 卸载旧版本，再安装新版；如果已经装了新版，直接删掉旧目录即可（此时不要再运行旧 `uninstall.exe`，两版共用同一个卸载注册项，旧卸载器会把新版的卸载项一起删掉）。

发布版已内置 yt-dlp，YouTube/B 站字幕与音轨下载无需另装 Python、Homebrew 或 yt-dlp；网络受限时仍可在播客页配置代理。

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

- **macOS**：`~/Library/Application Support/com.aling-go/`
- **Windows**：`%AppData%/com.aling-go/`

目录名与 bundle identifier 一致，卸载工具可以正确关联到应用数据。旧版本使用的 `aling-go/` 目录会在首次启动时自动整体改名迁移。

| 路径 | 内容 |
|------|------|
| `userData.db` | 生词、标签、复习进度、收藏、历史、打字记录、AI 缓存 |
| `library.json` | 媒体库目录结构 |
| `settings.json` | 通用设置（Whisper 模型/语言、RSS 代理、AI 端点） |
| `secrets.json` | 敏感凭据（AI API Key、B站 Cookie），权限 0600 |
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
| 在线字幕 / 音轨下载 | yt-dlp（sidecar） |

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
