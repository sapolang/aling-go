#!/bin/bash
# 在 MSYS2 MINGW64 bash 下构建 Windows sidecar：
#   sidecar/ffmpeg.exe、sidecar/whisper-sidecar.exe
# 依赖 MSYS2 包：mingw-w64-x86_64-toolchain、mingw-w64-x86_64-cmake、make、curl、xz
set -e
cd "$(dirname "$0")"
source ./versions.sh
JOBS=$(nproc 2>/dev/null || echo 4)

need_whisper_build() {
    [ -f "whisper-sidecar.exe" ] || return 0
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
    rm -rf build
    # GGML_NATIVE=OFF：不针对 CI runner 的 CPU 指令集优化，避免在用户机器上非法指令崩溃
    # GGML_OPENMP=OFF：避免依赖 libgomp 运行时 DLL
    cmake -B build -G "MSYS Makefiles" \
        -DCMAKE_BUILD_TYPE=Release \
        -DBUILD_SHARED_LIBS=OFF \
        -DGGML_NATIVE=OFF \
        -DGGML_OPENMP=OFF \
        -DGGML_STATIC=ON \
        -DCMAKE_EXE_LINKER_FLAGS=-static
    cmake --build build --target whisper-cli -j "$JOBS"
    cp build/bin/whisper-cli.exe ../whisper-sidecar.exe
    cd ..
    echo "whisper-sidecar.exe built ($WHISPER_CPP_REF)"
else
    echo "whisper-sidecar.exe already built from $WHISPER_CPP_REF, skipping"
fi

# ---- minimal static ffmpeg ----
if [ ! -f "ffmpeg.exe" ]; then
    echo "Building minimal ffmpeg for Windows..."
    if [ ! -d ".ffmpeg-src" ]; then
        TARBALL="/tmp/ffmpeg-${FFMPEG_VERSION}.tar.xz"
        curl -fSL "https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz" -o "$TARBALL"
        echo "${FFMPEG_SHA256}  ${TARBALL}" | sha256sum -c - || {
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
        --extra-ldflags=-static \
        --enable-small
    make -j "$JOBS"
    cp ffmpeg.exe ../ffmpeg.exe
    strip ../ffmpeg.exe
    cd ..
    rm -rf .ffmpeg-src
    echo "minimal ffmpeg.exe built ($(ls -lh ffmpeg.exe | awk '{print $5}'))"
fi

# ---- yt-dlp standalone ----
need_yt_dlp_download() {
    [ -f "yt-dlp.exe" ] || return 0
    [ "$(./yt-dlp.exe --version 2>/dev/null | tr -d '\r')" != "$YT_DLP_VERSION" ] && return 0
    return 1
}

if need_yt_dlp_download; then
    echo "Downloading yt-dlp $YT_DLP_VERSION..."
    YT_DLP_TMP=".yt-dlp.exe.download"
    if ! curl -fSL "https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/yt-dlp.exe" -o "$YT_DLP_TMP"; then
        rm -f "$YT_DLP_TMP"
        exit 1
    fi
    echo "${YT_DLP_WINDOWS_SHA256}  ${YT_DLP_TMP}" | sha256sum -c - || {
        rm -f "$YT_DLP_TMP"
        echo "yt-dlp 校验失败" >&2
        exit 1
    }
    mv -f "$YT_DLP_TMP" yt-dlp.exe
    echo "yt-dlp $YT_DLP_VERSION downloaded"
else
    echo "yt-dlp $YT_DLP_VERSION already present, skipping"
fi

echo "Done"
