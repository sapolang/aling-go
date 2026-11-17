# Windows 发布构建设计（Issue #133）

日期：2026-11-17
状态：待评审

## 背景与意图

目前 GitHub Release 只发布 macOS 产物（DMG / zip / SHA256SUMS），Windows 用户拿不到可用安装包。本设计补齐 Windows 的构建、打包、发布和自动更新链路，使干净 Windows 11 机器可以直接下载安装并正常使用本地播放、字幕转录、封面截帧和离线词典。

## 目标

- Release 中新增可安装的 `aling-go-<version>-amd64-installer.exe`（NSIS）。
- 安装包内置 `ffmpeg.exe`、`whisper-sidecar.exe`、`dict.db`、`articles.db`，安装到 exe 同目录。
- Windows 上应用能从 exe 同目录找到上述资源。
- 同时发布仅含 `aling-go.exe` 的更新 zip，保留应用内自动更新。
- 安装范围为当前用户（`%LOCALAPPDATA%\Programs`），避免 UAC，并保证自动更新对 exe 有写权限。
- 所有 Windows 产物进入 `SHA256SUMS`。

## 非目标

- 不支持 Windows ARM64（本迭代只做 amd64）。
- 不做 MSIX。
- 不做代码签名（安装包会触发 SmartScreen 提示，仅记录风险）。
- 不重写 Wails updater，不支持“exe + 资源整包更新”。
- 不改数据库、用户数据目录或备份格式。

## 已确认的决策

1. **安装范围**：user scope。理由：普通权限可写，自动更新 helper 能替换 exe；machine scope 装到 Program Files 后普通权限更新会失败。
2. **自动更新**：发布 `aling-go-<version>-windows-amd64.zip`，zip 内只有 `aling-go.exe` 一个顶层条目。
3. **sidecar 获取方式**：CI 在 MSYS2 下现场编译精简静态 ffmpeg 和 whisper sidecar，并缓存产物。

## 关键约束（已核对代码/依赖）

- Wails v3 updater 的 `maybeExtractInto` 要求压缩包**恰好一个顶层条目**；Windows 上 `bundleTarget` 就是当前 exe。因此更新 zip 只能包含单个 exe。
- GitHub provider 的 `DefaultAssetMatcher` 按文件名包含平台和架构选择资产，会跳过 `-installer.`；所以 installer 与 zip 可共存，更新时会选 zip。
- `SHA256SUMS` 解析格式为每行 `<hex>  <文件名>`，按 basename 匹配。
- NSIS 模板 `wails.files` 宏只安装 exe，不会带资源；需要扩展 `project.nsi`。
- `windows-latest`（Server 2025）镜像已不再预装 NSIS，构建前需显式安装。
- Windows runner 预装 MSYS2（`C:\msys64`），但不在 PATH。
- 数据目录 `os.UserConfigDir()/com.aling-go` 在 Windows 即 `%APPDATA%\com.aling-go`，无需改动。

## 方案对比

### A. 完整发布链路（选用）

新增 Windows job，用 MSYS2 编译静态 sidecar，NSIS 打包 user-scope 安装程序，同时发布 exe-only zip。

- 优点：安装包小（精简 ffmpeg），自动更新可用，安装无需管理员。
- 代价：CI 最复杂，首次构建慢，需要维护 Windows 构建脚本。

### B. 下载预编译依赖

安装包直接内置官方完整 ffmpeg 和 whisper release。

- 优点：脚本最少。
- 代价：安装包 100MB+；依赖上游产物可用性和命名稳定性。

### C. 首次运行下载依赖

installer 只带 exe，运行时下载 sidecar 和 db。

- 优点：安装包最小。
- 代价：需要新增下载器、进度、校验和失败重试；离线不可用；与“干净机器装完即用”的验收目标冲突。

选择 A。

## 改动清单

### 1. 资源查找（Go）

文件：`internal/content/ffmpeg.go`、`internal/content/whisper_service.go`

- 新增纯函数，把 exe 目录候选路径插入查找列表，例如：
  - `ffmpeg.exe` / `ffmpeg`
  - `whisper-sidecar.exe` / `whisper-sidecar`
- 查找顺序建议：`dataDir/sidecar` → exe 目录 → `sidecar/` / cwd → macOS `Contents/Resources`。
  - `dataDir` 优先允许用户覆盖。
  - exe 目录优先于 cwd，避免从任意工作目录启动时找错。
- 保留现有 macOS 行为。
- 新增单元测试：给定临时 exe 目录并放入同名文件，断言能被找到；并断言候选列表包含 exe 目录。测试不依赖真实可执行文件，只验证路径组装和 `os.Stat`。

### 2. Windows sidecar 构建脚本

新增：`sidecar/versions.sh`

- 集中维护 `WHISPER_CPP_REF`、`FFMPEG_VERSION`、`FFMPEG_SHA256`，供 macOS 与 Windows 脚本共同 source，避免版本漂移。
- 保留环境变量覆盖能力。

修改：`sidecar/build.sh`

- 改为 source `versions.sh`，其余行为不变（仍需在 macOS 上产出 `sidecar/ffmpeg`、`sidecar/whisper-sidecar`）。

新增：`sidecar/build-windows.sh`

- 在 MSYS2 MINGW64 bash 下运行，输出 `sidecar/ffmpeg.exe`、`sidecar/whisper-sidecar.exe`。
- whisper.cpp：
  - 与 macOS 相同的 ref 和浅克隆缓存策略。
  - `cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF -DGGML_STATIC=ON -DCMAKE_EXE_LINKER_FLAGS=-static`
  - `GGML_NATIVE=OFF` 防止二进制针对 CI runner CPU 优化而在用户机器上崩溃。
  - `GGML_OPENMP=OFF` 避免 `libgomp` 运行时依赖。
  - 复制 `build/bin/whisper-cli.exe` 为 `whisper-sidecar.exe`。
- ffmpeg：
  - 与 macOS 相同的源码版本、SHA256 校验和精简 feature flags。
  - 增加 `--extra-ldflags=-static`，产出无 DLL 依赖的 `ffmpeg.exe`。
  - 用 `strip` 减小体积。

### 3. NSIS 安装包

修改：`build/windows/nsis/project.nsi`

- 在 `!insertmacro wails.files` 之后增加可选资源安装，用 `!ifdef` 保护，避免本地手动 makensis 时因缺少 define 失败：
  - `ffmpeg.exe`、`whisper-sidecar.exe` 来自 sidecar 目录。
  - `dict.db`、`articles.db` 来自仓库根目录。
- 输出文件名加入版本：`aling-go-${INFO_PRODUCTVERSION}-${ARCH}-installer.exe`，满足验收命名。

修改：`build/windows/Taskfile.yml`

- `create:nsis:installer` 调用 makensis 时传入：
  - `-DINFO_PRODUCTVERSION={{.APP_VERSION}}`
  - `-DARG_WAILS_SIDECAR_DIR={{.ROOT_DIR}}\sidecar`
  - `-DARG_WAILS_DATA_DIR={{.ROOT_DIR}}`
- 保留 `ARG_WAILS_*_BINARY`、`INSTALL_SCOPE` 现有逻辑。

修改：`Makefile`

- `exe` 目标改为调用 `wails3 task windows:package INSTALL_SCOPE=user`，并提示必须在 Windows + NSIS + sidecar 已构建的环境执行；不再声称只运行 `wails3 build` 就能得到安装程序。

### 4. Release workflow

修改：`.github/workflows/release.yml`

新增 `windows` job（`windows-latest`）：

1. checkout、setup-go、setup-node。
2. 从 tag 注入 `build/config.yml` 版本（与 macOS 相同）。
3. 缓存并安装 pinned Wails CLI。
4. 缓存 sidecar 产物（key 包含 `sidecar/versions.sh` 和 `sidecar/build-windows.sh` 哈希）。
5. `msys2/setup-msys2` 安装 MINGW64 工具链、cmake、make，运行 `bash sidecar/build-windows.sh`。
6. 用 Chocolatey 安装 NSIS。
7. 运行 `wails3 task windows:package INSTALL_SCOPE=user`。
8. 校验 `bin/aling-go-<version>-amd64-installer.exe` 存在。
9. 生成更新 zip：`Compress-Archive -Path bin\aling-go.exe -DestinationPath bin\aling-go-<version>-windows-amd64.zip`（保证唯一顶层条目）。
10. 生成 Windows 的 `SHA256SUMS`（installer + zip，GNU `sha256sum` 格式）。
11. 上传 artifact `aling-go-windows`。

修改 `release` job：

- `needs: [macos, windows]`。
- 下载两个 artifact。
- 合并校验和：`cat aling-go-macos/SHA256SUMS aling-go-windows/SHA256SUMS > SHA256SUMS`。
- 上传 Windows installer、Windows zip 和合并后的 `SHA256SUMS`。

### 5. CI 编译回归

修改：`.github/workflows/ci.yml`

- 在 `go-checks` 增加一次 Windows 交叉编译：
  `GOOS=windows CGO_ENABLED=0 go build -o "$RUNNER_TEMP/aling-go.exe" .`
- 只编译 main 包即可覆盖全部应用代码，成本很低。

### 6. 文档

修改：`README.md`

- 增加 Windows 构建/发布说明，明确：安装范围、内置资源位置、自动更新只更新 exe、sidecar/db 随安装包升级。

## 验证方式

本地（macOS，可执行）：

- `go test ./...`
- `go vet ./...`
- `GOOS=windows CGO_ENABLED=0 go build -o /tmp/aling-go.exe .`
- `make lint`
- 前端 `npm run build` / `npm run lint`（仅在改到前端时；本设计不改前端）
- `bash -n sidecar/build.sh sidecar/build-windows.sh sidecar/versions.sh`

CI/人工（需要 Windows 环境）：

- 用 `workflow_dispatch` 在分支上跑一次 Release，确认 Windows job 产出 installer 和 zip。
- 干净 Windows 11 手动验收：
  - 安装后启动，无缺失 DLL。
  - 本地文件播放、字幕转录（whisper）、封面截帧（ffmpeg）、词典查询。
  - 托盘、打开所在文件夹、窗口尺寸/全屏、快捷键。
  - 应用内检查更新能找到 Windows zip，并能下载、替换、重启。
- 注意：本机是 macOS，无法完成上面的实机验收；必须在结果中明确说明。

## 风险与后续

- **SmartScreen**：未签名安装包会提示“未知发布者”。需要后续购买签名证书，或接受该提示。
- **更新只替换 exe**：sidecar、词典和文章库不会通过应用内更新升级；如果某次更新必须换 sidecar，用户需要重新下载安装包。发布说明中应提示。
- **安装时应用在运行**：NSIS 覆盖 exe/资源可能失败或要求关闭程序；如实测有问题，再在 `project.nsi` 中加运行检测。
- **whisper 性能**：关闭 `GGML_NATIVE` 后不使用 AVX512 等特性，兼容性更好但比本机编译略慢。
- **构建时间**：ffmpeg + whisper 首次编译较慢，依赖缓存；缓存 key 必须包含脚本和版本文件。
- **NSIS 不在镜像中**：构建步骤必须显式安装，否则 job 直接失败。
- **校验和合并**：release job 必须只上传合并后的 `SHA256SUMS`，避免两个同名资产冲突。
