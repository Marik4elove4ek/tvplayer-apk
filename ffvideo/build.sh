#!/bin/bash
# Сборка видеодекодера FFmpeg (H.264, HEVC, MPEG-2) для ExoPlayer.
# FFmpeg собирается статически и прячется внутри liblupovideo.so,
# поэтому не мешает FFmpeg, который есть внутри MPV.
set -e
FF_VERSION=6.1.2
ROOT=$(cd "$(dirname "$0")" && pwd)
OUT=$ROOT/out
NDK=${ANDROID_NDK_LATEST_HOME:-$ANDROID_NDK_HOME}
TC=$NDK/toolchains/llvm/prebuilt/linux-x86_64
API=23
mkdir -p "$ROOT/build"
cd "$ROOT/build"
if [ ! -d "ffmpeg-$FF_VERSION" ]; then
  curl -sSfL "https://ffmpeg.org/releases/ffmpeg-$FF_VERSION.tar.xz" | tar xJ
fi
for ABI in arm64-v8a armeabi-v7a; do
  case $ABI in
    arm64-v8a) T=aarch64-linux-android; ARCH=aarch64; CPU=armv8-a; EXTRA="" ;;
    armeabi-v7a) T=armv7a-linux-androideabi; ARCH=arm; CPU=armv7-a; EXTRA="--disable-asm" ;;
  esac
  CC=$TC/bin/${T}${API}-clang
  PREFIX=$ROOT/build/$ABI
  if [ ! -f "$PREFIX/lib/libavcodec.a" ]; then
    pushd "ffmpeg-$FF_VERSION"
    make distclean >/dev/null 2>&1 || true
    ./configure --prefix="$PREFIX" --enable-cross-compile --target-os=android \
      --arch=$ARCH --cpu=$CPU --cc="$CC" --cxx="${CC}++" \
      --nm="$TC/bin/llvm-nm" --ar="$TC/bin/llvm-ar" --ranlib="$TC/bin/llvm-ranlib" --strip="$TC/bin/llvm-strip" \
      --enable-static --disable-shared --enable-pic \
      --disable-everything --disable-programs --disable-doc --disable-debug \
      --disable-avdevice --disable-avformat --disable-avfilter --disable-swresample --disable-postproc \
      --disable-network --disable-autodetect --disable-vulkan --enable-pthreads \
      --enable-avcodec --enable-avutil --enable-swscale \
      --enable-decoder=h264,hevc,mpeg2video,mpeg1video \
      --enable-parser=h264,hevc,mpegvideo \
      --extra-cflags="-O3 -fPIC" $EXTRA
    make -j"$(nproc)"
    make install
    popd
  fi
  mkdir -p "$OUT/jniLibs/$ABI"
  "${CC}++" -shared -fPIC -O2 -std=c++17 -I"$PREFIX/include" "$ROOT"/jni/*.cpp \
    -o "$OUT/jniLibs/$ABI/liblupovideo.so" \
    "$PREFIX/lib/libswscale.a" "$PREFIX/lib/libavcodec.a" "$PREFIX/lib/libavutil.a" \
    -landroid -llog -lm -static-libstdc++ \
    -Wl,--exclude-libs,ALL -Wl,-Bsymbolic -Wl,--gc-sections -Wl,-z,max-page-size=16384
  "$TC/bin/llvm-strip" --strip-unneeded "$OUT/jniLibs/$ABI/liblupovideo.so"
done
ls -la "$OUT"/jniLibs/*
