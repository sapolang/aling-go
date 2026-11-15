# AGENTS.md

## 项目概况

这是一个跨平台桌面语言学习应用，使用 **Wails v3** 将 Go 后端与前端连接起来。

主要技术栈：

- 后端：Go（版本以 `go.mod` 为准）
- 桌面框架：Wails v3（版本以 `go.mod` 为准）
- 前端：React 18、TypeScript、Vite
- 样式：Tailwind CSS
- UI：项目现有的 Radix UI 组件和 `frontend/src/components/ui/` 下的本地组件
- 状态管理：Zustand
- 数据库：SQLite，使用 `modernc.org/sqlite`
- 音视频与语音转录：FFmpeg、Whisper.cpp sidecar

## 通用原则

- 动手前先阅读相关实现、调用方和测试，理解现有代码的职责边界。
- 优先遵循项目现有目录结构、命名方式、错误处理和组件风格。
- 改动应聚焦于用户要求；不要顺手重构无关代码、批量格式化无关文件或改变公共 API。
- 优先复用现有代码和依赖。新增依赖、替换库或引入新的架构模式前，先说明原因。
- 不要仅为让检查通过而删除测试、放宽断言、屏蔽错误或加入不必要的类型断言。
- 不覆盖、撤销或清理与当前任务无关的用户改动。
- 不要编造运行过的命令、测试结果或验证结论。
- 如果发现需求与现有行为冲突，先基于代码和测试判断影响；无法安全确定时再询问用户。

## 项目结构与职责

- `main.go`：应用入口，负责嵌入前端构建产物和图标，并调用 `internal/bootstrap` 启动应用。
- `internal/bootstrap/`：Wails v3 应用初始化、服务注册、主窗口和系统托盘。
- `internal/core/`：数据库连接、schema、迁移和初始化/关闭。
- `internal/study/`：单词、标签、复习、词典和收藏等学习功能。
- `internal/content/`：文章、媒体库、播放、字幕、Feed 和转录等内容功能。
- `internal/system/`：平台能力、备份、更新和 AI 相关功能。
- `internal/dict/`：词典数据访问。
- `internal/store/schema.sql`、`internal/store/queries/`：sqlc 的 schema 和查询源文件。
- `internal/store/userdb/`：由 sqlc 生成的数据访问代码。
- `frontend/src/components/`：共享前端组件。
- `frontend/src/components/ui/`：项目本地维护的基础 UI 组件。
- `frontend/src/pages/`：页面级 React 组件。
- `frontend/src/stores/`：Zustand 状态。
- `frontend/src/types/`：前端类型。
- `frontend/bindings/`：Wails 生成的前端 bindings。
- `Taskfile.yml`、`build/`：Wails v3 的构建任务和平台配置。
- `Makefile`：常用开发、检查和打包入口。
- `sidecar/`：Whisper.cpp 和 FFmpeg 等外部工具的构建脚本。

新增代码时应放在职责最匹配的现有模块中；不要把业务逻辑塞进 `main.go`、页面组件或启动编排代码。

## Wails v3 约定

- 本项目使用 **Wails v3**，不要套用 Wails v2 的 API、配置格式或绑定生成命令。
- 后端服务注册、应用和窗口生命周期应遵循 `internal/bootstrap/` 中的现有模式。
- 暴露给前端的 Go 服务 API 发生变化时，检查所有前端调用方和相关类型。
- 需要更新 Wails 前端 bindings 时，使用项目当前工具链生成：
  `make bindings`（必须带 `-i` 生成 TS interface，参数与打包任务一致）
- `frontend/bindings/` 是生成产物；通常不要直接手工修改生成文件。若生成产物被版本控制忽略，应按 CI 的流程重新生成并验证调用方。
- 不要在生成 bindings 时顺带覆盖或修改其他不相关文件。
- `main.go` 使用 `//go:embed frontend/dist`。干净 checkout 下若该目录不存在，Go 的嵌入会失败；CI 会创建占位目录用于 Go 检查。进行本地 Go 检查前应确认构建产物目录存在，优先使用正常前端构建，不要提交临时占位文件。
- 不要未经确认改变 Wails 配置、应用启动参数、窗口行为、平台专属设置或资源嵌入方式。

## Go 后端约定

- 遵循 Go 惯用写法，保持函数职责清楚，避免不必要的抽象和过度设计。
- 错误应在合适层级处理或返回；不要静默忽略错误。
- 修改服务逻辑时检查调用方、事件、数据读写和关闭流程。
- 涉及 goroutine、网络请求、进程、文件或数据库时，考虑取消、超时、资源释放和错误路径。
- SQL 使用参数化查询；不要把外部输入拼接进 SQL。
- 数据库变更要检查初始化、迁移、现有数据兼容性及相关查询。
- `internal/store/userdb/` 是 sqlc 生成目录。修改数据库查询时，应编辑 `internal/store/schema.sql` 或 `internal/store/queries/` 中的源文件，然后运行 `make sqlc`；不要只修改生成文件。
- 修改生成代码后，检查 `git diff`，确认生成结果与预期源文件一致。
- 修改平台专属代码时，留意 macOS、Windows、Linux 之间的差异，不要假设某个平台的路径、命令或系统 API 在其他平台也可用。
- 不要未经确认修改数据库文件、用户数据目录、备份格式或数据迁移行为。

## 前端约定

- 前端位于 `frontend/`，采用 React 18、TypeScript、Vite 和 Zustand。
- 优先复用 `frontend/src/components/` 与 `frontend/src/components/ui/` 的现有组件。
- UI 基础以项目现有的 Radix UI、Tailwind CSS 和本地封装为准；不要未经确认再引入另一套组件库或重写现有组件体系。
- 使用项目已有的主题变量、设计 token、`cn` 工具函数和样式约定，不要随意添加互相冲突的颜色或样式。
- 优先使用明确的 TypeScript 类型；避免使用 `any`、非空断言或强制类型转换来掩盖类型问题。
- React 组件和 hooks 应遵循现有模式；避免重复状态、不必要的副作用和过大的组件。
- 处理异步操作时，考虑加载中、错误、空数据、重复触发和组件卸载等情况。
- 用户可见文案应与现有中文界面风格保持一致。
- 页面或组件改动应检查键盘操作、对话框关闭、焦点和基础可访问性行为。

## 测试与质量检查

根据改动范围运行适当检查，并在最终回复中如实列出结果。

### Go

- `go test ./...`
- `go vet ./...`
- `make lint`

CI 还会检查 sqlc 生成结果是否与源文件同步，并运行 `govulncheck ./...`。

### 前端

在 `frontend/` 目录运行：

- `npm ci`：按 lockfile 安装依赖
- `npm run build`：TypeScript 检查并构建前端
- `npm run lint`
- `npm run format:check`

根目录的 `make test` 目前执行前端类型检查和 lint；它不等同于 `go test ./...`。

### Wails 与生成代码

- 修改 Wails 服务 API 时，按需运行 `make bindings` 并检查前端编译。
- 修改 sqlc 源文件时，运行 `make sqlc`，并确认生成代码没有未预期的差异。
- 不要声称没有运行的检查已经通过。
- 如果检查受操作系统、缺少 Wails CLI、平台 SDK 或 sidecar 依赖限制而无法运行，说明具体原因。

## 测试要求

- 修复 bug 时，尽量添加能复现原问题的回归测试。
- 新增业务逻辑时，为主要行为、错误路径和重要边界条件增加测试。
- 测试应验证可观察行为，而不是只验证实现细节。
- 修改数据库逻辑时，优先覆盖查询结果、边界条件和迁移兼容性。
- 修改前端交互时，检查正常流程、空状态、错误状态和禁用/加载状态。

## 安全与隐私

- 不要提交密钥、访问令牌、个人信息或本地环境配置。
- 不要在日志、错误信息或测试快照中暴露用户敏感数据。
- 对外部输入、文件路径、URL 和进程参数进行必要校验。
- 对可能删除、覆盖或迁移用户数据的操作采取谨慎、可验证的方式。
- 不执行与任务无关的破坏性命令，不随意删除构建、数据库或用户数据文件。

## 完成任务时的最终回复

简要说明：

1. 改了哪些内容，以及这样做的原因。
2. 运行了哪些测试或检查，以及结果。
3. 哪些检查未运行、未通过或受环境限制。
4. 仍存在的风险或需要后续处理的事项。
