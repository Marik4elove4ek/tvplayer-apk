// Видеодекодер FFmpeg для ExoPlayer.
// Основано на nextlib (https://github.com/anilbeesetti/nextlib), лицензия Apache 2.0.
#include <jni.h>
#include <android/log.h>
#include <android/native_window_jni.h>
#include <algorithm>
#include <cstdlib>
#include <cstring>

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavutil/error.h>
#include <libavutil/imgutils.h>
#include <libswscale/swscale.h>
}

#define LOG_TAG "lupovideo"
#define LOGE(...) ((void)__android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__))
#define ALIGN(x, a) (((x) + ((a) - 1)) & ~((a) - 1))

static const int VIDEO_DECODER_SUCCESS = 0;
static const int VIDEO_DECODER_ERROR_INVALID_DATA = -1;
static const int VIDEO_DECODER_ERROR_OTHER = -2;
static const int VIDEO_DECODER_ERROR_READ_FRAME = -3;


// Слабые устройства (телефон/планшет без аппаратного 4K): кадры выше этой высоты сразу уменьшаем
// (0 — не уменьшать). Так 4K 10 бит идёт программно: перевод цвета и вывод на экран — уже в Full HD
static volatile int g_maxOutHeight = 0;

static void logError(const char *where, int err) {
    char buf[256];
    av_strerror(err, buf, sizeof(buf));
    LOGE("Error in %s: %s", where, buf);
}

struct JniContext {
    ~JniContext() {
        if (native_window) ANativeWindow_release(native_window);
        if (swsContext) sws_freeContext(swsContext);
        if (rgbContext) sws_freeContext(rgbContext);
        if (yuvFrame) av_frame_free(&yuvFrame);
    }

    bool MaybeAcquireNativeWindow(JNIEnv *env, jobject new_surface) {
        if (surface == new_surface && native_window) return true;
        if (native_window) ANativeWindow_release(native_window);
        native_window_width = 0;
        native_window_height = 0;
        native_window = ANativeWindow_fromSurface(env, new_surface);
        if (!native_window) {
            surface = nullptr;
            return false;
        }
        surface = new_surface;
        return true;
    }

    jfieldID data_field{};
    jfieldID yuvPlanes_field{};
    jfieldID yuvStrides_field{};
    jmethodID init_for_yuv_frame_method{};
    jmethodID init_method{};

    AVCodecContext *codecContext{};
    // Перевод кадра в обычный 8-битный YUV 4:2:0 (если декодер выдал другой формат)
    SwsContext *swsContext{};
    AVFrame *yuvFrame{};
    // Перевод кадра в RGBA для экрана
    SwsContext *rgbContext{};

    ANativeWindow *native_window = nullptr;
    jobject surface = nullptr;
    int native_window_width = 0;
    int native_window_height = 0;
};

static AVCodec *findCodec(JNIEnv *env, jstring codecName) {
    if (!codecName) return nullptr;
    const char *name = env->GetStringUTFChars(codecName, nullptr);
    auto *codec = const_cast<AVCodec *>(avcodec_find_decoder_by_name(name));
    env->ReleaseStringUTFChars(codecName, name);
    return codec;
}

static void releaseCodec(AVCodecContext *context) {
    if (!context) return;
    av_freep(&context->extradata);
    avcodec_free_context(&context);
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_iptv_player_ffvideo_FfVideoLibrary_ffmpegGetVersion(JNIEnv *env, jclass) {
    return env->NewStringUTF(LIBAVCODEC_IDENT);
}

extern "C" JNIEXPORT void JNICALL
Java_com_iptv_player_ffvideo_FfVideoLibrary_ffmpegSetMaxOutputHeight(JNIEnv *, jclass, jint height) {
    g_maxOutHeight = height;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_iptv_player_ffvideo_FfVideoLibrary_ffmpegHasDecoder(JNIEnv *env, jclass, jstring codecName) {
    return findCodec(env, codecName) != nullptr;
}

extern "C" JNIEXPORT jlong JNICALL
Java_com_iptv_player_ffvideo_FfVideoDecoder_ffmpegInitialize(JNIEnv *env, jobject, jstring codecName,
                                                             jbyteArray extraData, jint threads) {
    AVCodec *codec = findCodec(env, codecName);
    if (!codec) {
        LOGE("Codec not found.");
        return 0L;
    }
    AVCodecContext *ctx = avcodec_alloc_context3(codec);
    if (!ctx) return 0L;
    if (extraData) {
        jsize size = env->GetArrayLength(extraData);
        ctx->extradata_size = size;
        ctx->extradata = (uint8_t *) av_mallocz(size + AV_INPUT_BUFFER_PADDING_SIZE);
        if (!ctx->extradata) {
            releaseCodec(ctx);
            return 0L;
        }
        env->GetByteArrayRegion(extraData, 0, size, (jbyte *) ctx->extradata);
    }
    ctx->thread_count = threads;
    ctx->thread_type = FF_THREAD_FRAME | FF_THREAD_SLICE;
    ctx->err_recognition = AV_EF_IGNORE_ERR;
    int result = avcodec_open2(ctx, codec, nullptr);
    if (result < 0) {
        logError("avcodec_open2", result);
        releaseCodec(ctx);
        return 0L;
    }
    auto *jni = new JniContext();
    jni->codecContext = ctx;
    jclass cls = env->FindClass("androidx/media3/decoder/VideoDecoderOutputBuffer");
    jni->data_field = env->GetFieldID(cls, "data", "Ljava/nio/ByteBuffer;");
    jni->yuvStrides_field = env->GetFieldID(cls, "yuvStrides", "[I");
    jni->yuvPlanes_field = env->GetFieldID(cls, "yuvPlanes", "[Ljava/nio/ByteBuffer;");
    jni->init_for_yuv_frame_method = env->GetMethodID(cls, "initForYuvFrame", "(IIIII)Z");
    jni->init_method = env->GetMethodID(cls, "init", "(JILjava/nio/ByteBuffer;)V");
    return (jlong) jni;
}

extern "C" JNIEXPORT jlong JNICALL
Java_com_iptv_player_ffvideo_FfVideoDecoder_ffmpegReset(JNIEnv *, jobject, jlong jContext) {
    auto *jni = reinterpret_cast<JniContext *>(jContext);
    if (!jni || !jni->codecContext) return 0L;
    avcodec_flush_buffers(jni->codecContext);
    return (jlong) jni;
}

extern "C" JNIEXPORT void JNICALL
Java_com_iptv_player_ffvideo_FfVideoDecoder_ffmpegRelease(JNIEnv *, jobject, jlong jContext) {
    auto *jni = reinterpret_cast<JniContext *>(jContext);
    if (!jni) return;
    releaseCodec(jni->codecContext);
    jni->codecContext = nullptr;
    delete jni;
}

extern "C" JNIEXPORT jint JNICALL
Java_com_iptv_player_ffvideo_FfVideoDecoder_ffmpegSendPacket(JNIEnv *env, jobject, jlong jContext,
                                                             jobject encodedData, jint length, jlong inputTime) {
    auto *jni = reinterpret_cast<JniContext *>(jContext);
    AVPacket *packet = av_packet_alloc();
    if (!packet) return VIDEO_DECODER_ERROR_OTHER;
    packet->data = (uint8_t *) env->GetDirectBufferAddress(encodedData);
    packet->size = length;
    packet->pts = inputTime;
    int result = avcodec_send_packet(jni->codecContext, packet);
    packet->data = nullptr;
    packet->size = 0;
    av_packet_free(&packet);
    if (result) {
        if (result == AVERROR_INVALIDDATA) return VIDEO_DECODER_ERROR_INVALID_DATA;
        if (result == AVERROR(EAGAIN)) return VIDEO_DECODER_ERROR_READ_FRAME;
        logError("avcodec_send_packet", result);
        return VIDEO_DECODER_ERROR_OTHER;
    }
    return VIDEO_DECODER_SUCCESS;
}

extern "C" JNIEXPORT jint JNICALL
Java_com_iptv_player_ffvideo_FfVideoDecoder_ffmpegReceiveFrame(JNIEnv *env, jobject, jlong jContext,
                                                               jint outputMode, jobject outputBuffer,
                                                               jboolean decodeOnly) {
    auto *jni = reinterpret_cast<JniContext *>(jContext);
    AVFrame *frame = av_frame_alloc();
    if (!frame) return VIDEO_DECODER_ERROR_OTHER;
    int result = avcodec_receive_frame(jni->codecContext, frame);
    if (decodeOnly || result == AVERROR(EAGAIN)) {
        av_frame_free(&frame);
        return VIDEO_DECODER_ERROR_INVALID_DATA;
    }
    if (result) {
        av_frame_free(&frame);
        if (result == AVERROR_EOF) return VIDEO_DECODER_ERROR_INVALID_DATA;
        logError("avcodec_receive_frame", result);
        return VIDEO_DECODER_ERROR_OTHER;
    }

    // Не 8-битный 4:2:0 (например, 10 бит или 4:2:2) — переводим в 8-битный 4:2:0.
    // Слишком большой кадр (4K на слабом устройстве) — заодно уменьшаем, одним проходом
    AVFrame *src = frame;
    int outW = frame->width;
    int outH = frame->height;
    const int maxH = g_maxOutHeight;
    const bool shrink = maxH > 0 && frame->height > maxH;
    if (shrink) {
        outH = maxH & ~1;
        outW = ((int) ((long long) frame->width * outH / frame->height)) & ~1;
        // Без фильтра сглаживания блоков декодирование 4K заметно быстрее (на уменьшенной картинке не видно)
        if (jni->codecContext->skip_loop_filter != AVDISCARD_ALL) jni->codecContext->skip_loop_filter = AVDISCARD_ALL;
    }
    if (shrink || (frame->format != AV_PIX_FMT_YUV420P && frame->format != AV_PIX_FMT_YUVJ420P)) {
        jni->swsContext = sws_getCachedContext(jni->swsContext, frame->width, frame->height,
                                               (AVPixelFormat) frame->format, outW, outH,
                                               AV_PIX_FMT_YUV420P, SWS_FAST_BILINEAR, nullptr, nullptr, nullptr);
        if (!jni->yuvFrame || jni->yuvFrame->width != outW || jni->yuvFrame->height != outH) {
            if (jni->yuvFrame) av_frame_free(&jni->yuvFrame);
            jni->yuvFrame = av_frame_alloc();
            jni->yuvFrame->format = AV_PIX_FMT_YUV420P;
            jni->yuvFrame->width = outW;
            jni->yuvFrame->height = outH;
            if (av_frame_get_buffer(jni->yuvFrame, 32) < 0) {
                av_frame_free(&frame);
                return VIDEO_DECODER_ERROR_OTHER;
            }
        }
        if (!jni->swsContext) {
            av_frame_free(&frame);
            return VIDEO_DECODER_ERROR_OTHER;
        }
        sws_scale(jni->swsContext, frame->data, frame->linesize, 0, frame->height,
                  jni->yuvFrame->data, jni->yuvFrame->linesize);
        src = jni->yuvFrame;
    }

    env->CallVoidMethod(outputBuffer, jni->init_method, frame->pts, outputMode, nullptr);
    jboolean ok = env->CallBooleanMethod(outputBuffer, jni->init_for_yuv_frame_method,
                                         src->width, src->height, src->linesize[0], src->linesize[1], 0);
    if (env->ExceptionCheck() || !ok) {
        av_frame_free(&frame);
        return VIDEO_DECODER_ERROR_OTHER;
    }
    jobject dataObject = env->GetObjectField(outputBuffer, jni->data_field);
    auto *data = reinterpret_cast<uint8_t *>(env->GetDirectBufferAddress(dataObject));
    const int uvHeight = (src->height + 1) / 2;
    const size_t yLength = (size_t) src->linesize[0] * src->height;
    const size_t uvLength = (size_t) src->linesize[1] * uvHeight;
    memcpy(data, src->data[0], yLength);
    memcpy(data + yLength, src->data[1], uvLength);
    memcpy(data + yLength + uvLength, src->data[2], uvLength);
    av_frame_free(&frame);
    return VIDEO_DECODER_SUCCESS;
}

extern "C" JNIEXPORT jint JNICALL
Java_com_iptv_player_ffvideo_FfVideoDecoder_ffmpegRenderFrame(JNIEnv *env, jobject, jlong jContext,
                                                              jobject surface, jobject outputBuffer,
                                                              jint width, jint height) {
    auto *jni = reinterpret_cast<JniContext *>(jContext);
    if (!jni->MaybeAcquireNativeWindow(env, surface)) return VIDEO_DECODER_ERROR_OTHER;
    // Вывод в RGBA: этот формат принимает любой экран (YV12 на части телефонов даёт чёрный экран)
    if (jni->native_window_width != width || jni->native_window_height != height) {
        if (ANativeWindow_setBuffersGeometry(jni->native_window, width, height, WINDOW_FORMAT_RGBA_8888)) {
            LOGE("setBuffersGeometry failed");
            return VIDEO_DECODER_ERROR_OTHER;
        }
        jni->native_window_width = width;
        jni->native_window_height = height;
    }
    jni->rgbContext = sws_getCachedContext(jni->rgbContext, width, height, AV_PIX_FMT_YUV420P,
                                           width, height, AV_PIX_FMT_RGBA, SWS_FAST_BILINEAR,
                                           nullptr, nullptr, nullptr);
    if (!jni->rgbContext) return VIDEO_DECODER_ERROR_OTHER;

    ANativeWindow_Buffer buffer;
    int result = ANativeWindow_lock(jni->native_window, &buffer, nullptr);
    if (result == -19) {
        // Поверхность уже уничтожена (например, свернули приложение)
        jni->surface = nullptr;
        return VIDEO_DECODER_SUCCESS;
    } else if (result || buffer.bits == nullptr) {
        LOGE("ANativeWindow_lock failed: %d", result);
        return VIDEO_DECODER_ERROR_OTHER;
    }

    jobjectArray planes = (jobjectArray) env->GetObjectField(outputBuffer, jni->yuvPlanes_field);
    uint8_t *src[4] = {
        (uint8_t *) env->GetDirectBufferAddress(env->GetObjectArrayElement(planes, 0)),
        (uint8_t *) env->GetDirectBufferAddress(env->GetObjectArrayElement(planes, 1)),
        (uint8_t *) env->GetDirectBufferAddress(env->GetObjectArrayElement(planes, 2)),
        nullptr};
    jintArray stridesArray = (jintArray) env->GetObjectField(outputBuffer, jni->yuvStrides_field);
    jint *strides = env->GetIntArrayElements(stridesArray, nullptr);
    int srcStride[4] = {strides[0], strides[1], strides[2], 0};
    env->ReleaseIntArrayElements(stridesArray, strides, JNI_ABORT);

    uint8_t *dst[4] = {(uint8_t *) buffer.bits, nullptr, nullptr, nullptr};
    int dstStride[4] = {buffer.stride * 4, 0, 0, 0};
    sws_scale(jni->rgbContext, src, srcStride, 0, std::min(height, (int) buffer.height), dst, dstStride);

    if (ANativeWindow_unlockAndPost(jni->native_window)) return VIDEO_DECODER_ERROR_OTHER;
    return VIDEO_DECODER_SUCCESS;
}
