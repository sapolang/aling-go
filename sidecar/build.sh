#!/bin/bash
set -e
cd "$(dirname "$0")"
JOBS=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)

# 固定 whisper.cpp 稳定版本。升级时改这里即可，CI 缓存 key 基于本文件哈希会自动失效。
# 不要用 main：其 Metal shader 源码可能与旧版 macOS 的 Metal 编译器不兼容，
# 运行时编译失败会导致 sidecar 直接 abort。
WHISPER_CPP_REF="${WHISPER_CPP_REF:-v1.9.5}"

# ffmpeg 同样固定到官方稳定发布版，并校验下载完整性
FFMPEG_VERSION="${FFMPEG_VERSION:-8.1.2}"
FFMPEG_SHA256="${FFMPEG_SHA256:-464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c}"

need_whisper_build() {
    [ -f "whisper-sidecar" ] || return 0
    [ -d ".whisper-cpp" ] || return 1
    [ "$(git -C .whisper-cpp describe --tags --exact-match 2>/dev/null)" != "$WHISPER_CPP_REF" ] && return 0
    return 1
}

if need_whisper_build; then
    if [ ! -d ".whisper-cpp" ]; then
        git clone --depth 1 --branch "$WHISPER_CPP_REF" https://github.com/ggerganov/whisper.cpp.git .whisper-cpp
    fi
    git -C .whisper-cpp fetch --depth 1 origin tag "$WHISPER_CPP_REF"
    git -C .whisper-cpp checkout -f "tags/$WHISPER_CPP_REF"

    cd .whisper-cpp
    rm -rf build && cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF
    cmake --build build --target whisper-cli -- -j "$JOBS"
    cp build/bin/whisper-cli ../whisper-sidecar
    cd ..
    echo "whisper-sidecar built ($WHISPER_CPP_REF)"
else
    echo "whisper-sidecar already built from $WHISPER_CPP_REF, skipping"
fi

# ---- minimal static ffmpeg ----
if [ ! -f "ffmpeg" ]; then
    echo "Building minimal ffmpeg..."
    if [ ! -d ".ffmpeg-src" ]; then
        TARBALL="/tmp/ffmpeg-${FFMPEG_VERSION}.tar.xz"
        curl -fSL "https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz" -o "$TARBALL"
        echo "${FFMPEG_SHA256}  ${TARBALL}" | shasum -a 256 -c - || {
            rm -f "$TARBALL"
            echo "ffmpeg 压缩包校验失败" >&2
            exit 1
        }
        tar xf "$TARBALL" -C /tmp
        mv "/tmp/ffmpeg-${FFMPEG_VERSION}" .ffmpeg-src
        rm -f "$TARBALL"
    fi

    cd .ffmpeg-src
    ./configure \
        --disable-everything \
        --enable-ffmpeg \
        --enable-avformat --enable-avcodec --enable-avutil \
        --enable-swresample --enable-swscale \
        --enable-protocol=file \
        --enable-demuxer='mov,mp4,matroska,avi,wav,aac,mp3,flac,ogg' \
        --enable-decoder='h264,hevc,aac,mp3,vorbis,opus,pcm_s16le,pcm_f32le,flac' \
        --enable-encoder='mjpeg,pcm_s16le' \
        --enable-muxer='image2,wav' \
        --enable-parser='h264,hevc,aac,mp3' \
        --enable-filter='scale,format,aresample' \
        --disable-autodetect --disable-asm \
        --enable-small
    make -j "$JOBS"
    cp ffmpeg ../ffmpeg
    strip ../ffmpeg
    cd ..
    rm -rf .ffmpeg-src /tmp/ffmpeg-install
    echo "minimal ffmpeg built ($(ls -lh ffmpeg | awk '{print $5}'))"
fi

echo "Done"
