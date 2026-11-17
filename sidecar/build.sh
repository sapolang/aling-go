#!/bin/bash
set -e
cd "$(dirname "$0")"
source ./versions.sh
JOBS=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)

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
