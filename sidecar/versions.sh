# sidecar 依赖版本集中维护，macOS / Windows 构建脚本共同 source，避免版本漂移。
# 升级时改这里即可，CI 缓存 key 基于本文件哈希会自动失效。
#
# whisper.cpp 固定稳定 tag：不要用 main，其 Metal shader 源码可能与旧版 macOS 的
# Metal 编译器不兼容，运行时编译失败会导致 sidecar 直接 abort。
WHISPER_CPP_REF="${WHISPER_CPP_REF:-v1.9.5}"

# ffmpeg 固定到官方稳定发布版，并校验下载完整性
FFMPEG_VERSION="${FFMPEG_VERSION:-8.1.2}"
FFMPEG_SHA256="${FFMPEG_SHA256:-464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c}"
