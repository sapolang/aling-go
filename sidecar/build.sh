#!/bin/bash
set -e
cd "$(dirname "$0")"
JOBS=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)

if [ ! -f "whisper-sidecar" ]; then
    if [ ! -d ".whisper-cpp" ]; then
        git clone --depth 1 https://github.com/ggerganov/whisper.cpp.git .whisper-cpp
    fi

    cd .whisper-cpp
    rm -rf build && cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF
    cmake --build build --target whisper-cli -- -j "$JOBS"
    cp build/bin/whisper-cli ../whisper-sidecar
    cd ..
    echo "whisper-sidecar built"
else
    echo "whisper-sidecar already exists, skipping"
fi

# ---- minimal static ffmpeg ----
if [ ! -f "ffmpeg" ]; then
    echo "Building minimal ffmpeg..."
    if [ ! -d ".ffmpeg-src" ]; then
        curl -fSL "https://ffmpeg.org/releases/ffmpeg-8.1.2.tar.xz" -o /tmp/ffmpeg.tar.xz
        tar xf /tmp/ffmpeg.tar.xz -C /tmp
        mv /tmp/ffmpeg-8.1.2 .ffmpeg-src
        rm -f /tmp/ffmpeg.tar.xz
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
        --enable-small --cc=clang
    make -j "$JOBS"
    cp ffmpeg ../ffmpeg
    strip ../ffmpeg
    cd ..
    rm -rf .ffmpeg-src /tmp/ffmpeg-install
    echo "minimal ffmpeg built ($(ls -lh ffmpeg | awk '{print $5}'))"
fi

echo "Done"
