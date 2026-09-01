/**
 * WASAPI-SS: Windows Process Loopback Capture (Electron N-API native addon).
 *
 * Захватывает системный аудио-выход, исключая всё дерево процессов указанного PID.
 * Работает на Windows 10 2004 (20H1) и выше.
 *
 * API:
 *   start(excludePid: number, onChunk: (data: Float32Array) => void,
 *         onReady: (sampleRate: number, channels: number) => void,
 *         onError: (msg: string) => void) → void
 *   stop() → void
 */

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <initguid.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <audiopolicy.h>
#include <functiondiscoverykeys_devpkey.h>
#include <synchapi.h>
#include <ole2.h>
#include <napi.h>
#include <thread>
#include <atomic>
#include <vector>
#include <cstdint>
#include <memory>

// ── Process Loopback types (Windows 10 20H1+ SDK; guard duplicate defs) ──────
#ifndef AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK
typedef enum AUDIOCLIENT_ACTIVATION_TYPE {
    AUDIOCLIENT_ACTIVATION_TYPE_DEFAULT          = 0,
    AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK = 1,
} AUDIOCLIENT_ACTIVATION_TYPE;

typedef enum PROCESS_LOOPBACK_MODE {
    PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE = 0,
    PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE = 1,
} PROCESS_LOOPBACK_MODE;

typedef struct AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
    DWORD                TargetProcessId;
    PROCESS_LOOPBACK_MODE ProcessLoopbackMode;
} AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS;

typedef struct AUDIOCLIENT_ACTIVATION_PARAMS {
    AUDIOCLIENT_ACTIVATION_TYPE ActivationType;
    union {
        AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS ProcessLoopbackParams;
    };
} AUDIOCLIENT_ACTIVATION_PARAMS;
#endif

#ifndef VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK
#  define VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK L"VAD\\Process_Loopback"
#endif

// ── ActivateAudioInterfaceAsync declaration (may not be in older SDK headers) ──
extern "C" {
typedef HRESULT (WINAPI *PFN_ActivateAudioInterfaceAsync)(
    LPCWSTR,
    REFIID,
    PROPVARIANT*,
    IActivateAudioInterfaceCompletionHandler*,
    IActivateAudioInterfaceAsyncOperation**);
}

// ── IActivateAudioInterfaceCompletionHandler ──────────────────────────────────
struct ActivationHandler : public IActivateAudioInterfaceCompletionHandler {
    volatile LONG   ref_         = 1;
    HANDLE          evt_         = nullptr;
    IAudioClient*   client_      = nullptr;
    HRESULT         result_      = E_FAIL;

    ActivationHandler() { evt_ = CreateEventW(nullptr, TRUE, FALSE, nullptr); }
    ~ActivationHandler()  { if (evt_) CloseHandle(evt_); }

    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** ppv) override {
        if (riid == IID_IUnknown ||
            riid == __uuidof(IActivateAudioInterfaceCompletionHandler)) {
            *ppv = static_cast<IActivateAudioInterfaceCompletionHandler*>(this);
            InterlockedIncrement(&ref_);
            return S_OK;
        }
        *ppv = nullptr; return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef()  override { return InterlockedIncrement(&ref_); }
    ULONG STDMETHODCALLTYPE Release() override {
        ULONG n = InterlockedDecrement(&ref_);
        if (!n) delete this;
        return n;
    }
    HRESULT STDMETHODCALLTYPE ActivateCompleted(
        IActivateAudioInterfaceAsyncOperation* op) override
    {
        IUnknown* unk = nullptr;
        op->GetActivateResult(&result_, &unk);
        if (SUCCEEDED(result_) && unk) {
            unk->QueryInterface(__uuidof(IAudioClient), reinterpret_cast<void**>(&client_));
            unk->Release();
        }
        SetEvent(evt_);
        return S_OK;
    }
};

// ── Capture state ─────────────────────────────────────────────────────────────
static std::atomic<bool>    g_running{false};
static std::thread          g_thread;

// ── N-API thread-safe functions ───────────────────────────────────────────────
static Napi::ThreadSafeFunction g_tsfChunk;
static Napi::ThreadSafeFunction g_tsfReady;
static Napi::ThreadSafeFunction g_tsfError;

struct ChunkData {
    std::vector<float> samples; // interleaved
    uint32_t channels;
};
struct ReadyData { uint32_t sampleRate; uint32_t channels; };
struct ErrorData { std::string msg; };

static void CallChunk(Napi::Env env, Napi::Function cb, void*, ChunkData* d) {
    if (env == nullptr || !cb) { delete d; return; }
    size_t n = d->samples.size();
    auto arr = Napi::Float32Array::New(env, n);
    std::memcpy(arr.Data(), d->samples.data(), n * sizeof(float));
    cb.Call({ arr });
    delete d;
}
static void CallReady(Napi::Env env, Napi::Function cb, void*, ReadyData* d) {
    if (env == nullptr || !cb) { delete d; return; }
    cb.Call({ Napi::Number::New(env, d->sampleRate),
              Napi::Number::New(env, d->channels) });
    delete d;
}
static void CallError(Napi::Env env, Napi::Function cb, void*, ErrorData* d) {
    if (env == nullptr || !cb) { delete d; return; }
    cb.Call({ Napi::String::New(env, d->msg) });
    delete d;
}

// ── Capture thread ────────────────────────────────────────────────────────────
static void CaptureThread(DWORD excludePid) {
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);

    // --- runtime-load ActivateAudioInterfaceAsync (requires Win 10) ---
    HMODULE hMm = LoadLibraryW(L"mmdevapi.dll");
    if (!hMm) {
        g_tsfError.BlockingCall(new ErrorData{"mmdevapi.dll not found"}, CallError);
        g_tsfError.Release(); g_tsfReady.Release(); g_tsfChunk.Release();
        CoUninitialize(); return;
    }
    auto pfnActivate = reinterpret_cast<PFN_ActivateAudioInterfaceAsync>(
        GetProcAddress(hMm, "ActivateAudioInterfaceAsync"));
    if (!pfnActivate) {
        FreeLibrary(hMm);
        g_tsfError.BlockingCall(new ErrorData{"ActivateAudioInterfaceAsync not found (need Win10 2004+)"},
            CallError);
        g_tsfError.Release(); g_tsfReady.Release(); g_tsfChunk.Release();
        CoUninitialize(); return;
    }

    // --- Build activation params ---
    AUDIOCLIENT_ACTIVATION_PARAMS params{};
    params.ActivationType                                    = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
    params.ProcessLoopbackParams.TargetProcessId            = excludePid;
    params.ProcessLoopbackParams.ProcessLoopbackMode        = PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;

    PROPVARIANT pv{};
    PropVariantInit(&pv);
    pv.vt            = VT_BLOB;
    pv.blob.cbSize   = sizeof(params);
    pv.blob.pBlobData = reinterpret_cast<BYTE*>(&params);

    auto* handler = new ActivationHandler();
    IActivateAudioInterfaceAsyncOperation* asyncOp = nullptr;
    HRESULT hr = pfnActivate(
        VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
        __uuidof(IAudioClient),
        &pv,
        handler,
        &asyncOp);
    if (FAILED(hr)) {
        handler->Release();
        FreeLibrary(hMm);
        g_tsfError.BlockingCall(new ErrorData{"ActivateAudioInterfaceAsync failed"}, CallError);
        g_tsfError.Release(); g_tsfReady.Release(); g_tsfChunk.Release();
        CoUninitialize(); return;
    }

    // Wait for async activation (timeout 5s)
    DWORD waitRes = WaitForSingleObject(handler->evt_, 5000);
    if (asyncOp) { asyncOp->Release(); asyncOp = nullptr; }

    if (waitRes != WAIT_OBJECT_0 || FAILED(handler->result_) || !handler->client_) {
        handler->Release();
        FreeLibrary(hMm);
        g_tsfError.BlockingCall(new ErrorData{"Audio client activation failed"}, CallError);
        g_tsfError.Release(); g_tsfReady.Release(); g_tsfChunk.Release();
        CoUninitialize(); return;
    }

    IAudioClient*        client  = handler->client_;
    handler->client_ = nullptr;
    handler->Release();

    // --- Negotiate format: prefer 48kHz float32 stereo ---
    WAVEFORMATEX mixFmt{ WAVE_FORMAT_IEEE_FLOAT, 2, 48000,
        48000 * 2 * 4, 2 * 4, 32, 0 };
    constexpr REFERENCE_TIME refBuf = 200000; // 20ms in 100ns units
    hr = client->Initialize(
        AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK |  // Note: process loopback ignores LOOPBACK flag but it's harmless
        AUDCLNT_STREAMFLAGS_NOPERSIST,
        refBuf, 0, &mixFmt, nullptr);

    if (FAILED(hr)) {
        // Try whatever mix format the endpoint uses
        WAVEFORMATEX* pMix = nullptr;
        client->GetMixFormat(&pMix);
        if (pMix) {
            hr = client->Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                AUDCLNT_STREAMFLAGS_NOPERSIST,
                refBuf, 0, pMix, nullptr);
            if (SUCCEEDED(hr)) { mixFmt = *pMix; }
            CoTaskMemFree(pMix);
        }
    }

    if (FAILED(hr)) {
        client->Release();
        FreeLibrary(hMm);
        g_tsfError.BlockingCall(new ErrorData{"IAudioClient::Initialize failed"}, CallError);
        g_tsfError.Release(); g_tsfReady.Release(); g_tsfChunk.Release();
        CoUninitialize(); return;
    }

    uint32_t sr  = mixFmt.nSamplesPerSec;
    uint32_t ch  = mixFmt.nChannels;
    bool     f32 = (mixFmt.wFormatTag == WAVE_FORMAT_IEEE_FLOAT);

    IAudioCaptureClient* capture = nullptr;
    hr = client->GetService(__uuidof(IAudioCaptureClient),
                             reinterpret_cast<void**>(&capture));
    if (FAILED(hr)) {
        client->Release(); FreeLibrary(hMm);
        g_tsfError.BlockingCall(new ErrorData{"GetService(IAudioCaptureClient) failed"}, CallError);
        g_tsfError.Release(); g_tsfReady.Release(); g_tsfChunk.Release();
        CoUninitialize(); return;
    }

    hr = client->Start();
    if (FAILED(hr)) {
        capture->Release(); client->Release(); FreeLibrary(hMm);
        g_tsfError.BlockingCall(new ErrorData{"IAudioClient::Start failed"}, CallError);
        g_tsfError.Release(); g_tsfReady.Release(); g_tsfChunk.Release();
        CoUninitialize(); return;
    }

    // Notify JS: capture ready
    g_tsfReady.BlockingCall(new ReadyData{sr, ch}, CallReady);
    g_tsfReady.Release();

    // ── Capture loop (20ms sleep = 960 frames at 48kHz) ──────────────────
    constexpr DWORD SLEEP_MS = 20;
    while (g_running.load(std::memory_order_relaxed)) {
        Sleep(SLEEP_MS);

        UINT32 packetFrames = 0;
        HRESULT hrPkt = capture->GetNextPacketSize(&packetFrames);
        if (FAILED(hrPkt)) break;

        while (packetFrames > 0) {
            BYTE*  data    = nullptr;
            UINT32 frames  = 0;
            DWORD  flags   = 0;
            hr = capture->GetBuffer(&data, &frames, &flags, nullptr, nullptr);
            if (FAILED(hr)) break;

            auto* cd = new ChunkData();
            cd->channels = ch;
            size_t totalSamples = static_cast<size_t>(frames) * ch;
            cd->samples.resize(totalSamples);

            if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
                std::fill(cd->samples.begin(), cd->samples.end(), 0.0f);
            } else if (f32) {
                std::memcpy(cd->samples.data(), data, totalSamples * sizeof(float));
            } else if (mixFmt.wBitsPerSample == 16) {
                const int16_t* src = reinterpret_cast<const int16_t*>(data);
                constexpr float kScale = 1.0f / 32768.0f;
                for (size_t i = 0; i < totalSamples; ++i)
                    cd->samples[i] = static_cast<float>(src[i]) * kScale;
            } else {
                // Unsupported format — silence
                std::fill(cd->samples.begin(), cd->samples.end(), 0.0f);
            }

            capture->ReleaseBuffer(frames);
            g_tsfChunk.NonBlockingCall(cd, CallChunk);

            hrPkt = capture->GetNextPacketSize(&packetFrames);
            if (FAILED(hrPkt)) packetFrames = 0;
        }
    }

    client->Stop();
    capture->Release();
    client->Release();
    FreeLibrary(hMm);
    g_tsfChunk.Release();
    g_tsfError.Release();
    CoUninitialize();
}

// ── Exposed JS functions ───────────────────────────────────────────────────────
Napi::Value Start(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 4 ||
        !info[0].IsNumber()  ||
        !info[1].IsFunction() ||
        !info[2].IsFunction() ||
        !info[3].IsFunction())
    {
        Napi::TypeError::New(env, "start(excludePid, onChunk, onReady, onError)").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    if (g_running.load()) return env.Undefined(); // already running

    DWORD pid = static_cast<DWORD>(info[0].As<Napi::Number>().Uint32Value());

    g_tsfChunk = Napi::ThreadSafeFunction::New(
        env, info[1].As<Napi::Function>(), "wasapi_chunk", 0, 1);
    g_tsfReady = Napi::ThreadSafeFunction::New(
        env, info[2].As<Napi::Function>(), "wasapi_ready", 0, 1);
    g_tsfError = Napi::ThreadSafeFunction::New(
        env, info[3].As<Napi::Function>(), "wasapi_error", 0, 1);

    g_running.store(true, std::memory_order_relaxed);
    g_thread = std::thread(CaptureThread, pid);
    return env.Undefined();
}

Napi::Value Stop(const Napi::CallbackInfo& info) {
    g_running.store(false, std::memory_order_relaxed);
    if (g_thread.joinable()) g_thread.join();
    return info.Env().Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("start", Napi::Function::New(env, Start));
    exports.Set("stop",  Napi::Function::New(env, Stop));
    return exports;
}

NODE_API_MODULE(wasapi_capture, Init)
