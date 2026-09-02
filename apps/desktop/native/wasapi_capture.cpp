/**
 * WASAPI Process Loopback capture
 * (PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE).
 *
 * Uses pure C N-API (node_api.h), no npm node-addon-api dependency.
 * node_api.h ships with Electron headers.
 *
 * Exports:
 *   start(excludePid, onChunk, onReady, onError): void
 *   stop(): void
 *
 * Note: uses __uuidof() instead of IID_* to avoid initguid/uuid.lib issues.
 */

#ifndef UNICODE
#define UNICODE
#endif
#define WIN32_LEAN_AND_MEAN
#define NAPI_VERSION 8

#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <audiopolicy.h>
#include <propkey.h>
#include <node_api.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>

// ---- WASAPI Process Loopback API (SDK < 10.0.20348) ------------------------

#ifndef AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK
typedef enum AUDIOCLIENT_ACTIVATION_TYPE_ {
    AUDIOCLIENT_ACTIVATION_TYPE_DEFAULT          = 0,
    AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK = 1
} AUDIOCLIENT_ACTIVATION_TYPE;
#define PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE 0
#define PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE 1
#endif

static const PCWSTR VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK = L"VAD\\Process_Loopback";

typedef struct AUDIOCLIENT_ACTIVATION_PARAMS_ {
    AUDIOCLIENT_ACTIVATION_TYPE ActivationType;
    struct {
        DWORD ProcessId;
        BOOL  Mode;
    } ProcessLoopbackParams;
} AUDIOCLIENT_ACTIVATION_PARAMS_;

// ---- Messages --------------------------------------------------------------

typedef enum { MSG_READY, MSG_CHUNK, MSG_ERROR } MsgType;

typedef struct AudioMsg_ {
    MsgType type;
    UINT32  sampleRate;
    UINT32  channels;
    float*  chunkData;
    size_t  chunkCount;
    char    errorText[256];
} AudioMsg;

// ---- Global state ----------------------------------------------------------

typedef struct Ctx_ {
    napi_ref onChunk;
    napi_ref onReady;
    napi_ref onError;
} Ctx;

static napi_threadsafe_function g_tsfn   = NULL;
static HANDLE                   g_thread = NULL;
static volatile LONG            g_stop   = 0;
static Ctx*                     g_ctx    = NULL;

// ---- ArrayBuffer finalizer -------------------------------------------------

static void FinalizeBuffer(napi_env, void* data, void*) { free(data); }

// ---- JS dispatch (runs on JS thread) ---------------------------------------

static void Dispatch(napi_env env, napi_value, void* rawCtx, void* rawData) {
    Ctx*      ctx = (Ctx*)rawCtx;
    AudioMsg* msg = (AudioMsg*)rawData;
    if (!env || !ctx || !msg) { free(msg); return; }

    napi_value global;
    napi_get_global(env, &global);

    switch (msg->type) {
    case MSG_READY: {
        napi_value fn, args[2];
        napi_get_reference_value(env, ctx->onReady, &fn);
        napi_create_uint32(env, msg->sampleRate, &args[0]);
        napi_create_uint32(env, msg->channels,   &args[1]);
        napi_call_function(env, global, fn, 2, args, NULL);
        break;
    }
    case MSG_CHUNK: {
        napi_value fn, ab;
        napi_get_reference_value(env, ctx->onChunk, &fn);
        napi_create_external_arraybuffer(
            env, msg->chunkData, msg->chunkCount * sizeof(float),
            FinalizeBuffer, NULL, &ab);
        napi_call_function(env, global, fn, 1, &ab, NULL);
        break;
    }
    case MSG_ERROR: {
        napi_value fn, str;
        napi_get_reference_value(env, ctx->onError, &fn);
        napi_create_string_utf8(env, msg->errorText, NAPI_AUTO_LENGTH, &str);
        napi_call_function(env, global, fn, 1, &str, NULL);
        break;
    }
    }
    free(msg);
}

// ---- TSFN finalizer --------------------------------------------------------

static void FinalizeCtx(napi_env env, void* rawCtx, void*) {
    Ctx* ctx = (Ctx*)rawCtx;
    if (!ctx) return;
    if (env) {
        if (ctx->onChunk) napi_delete_reference(env, ctx->onChunk);
        if (ctx->onReady) napi_delete_reference(env, ctx->onReady);
        if (ctx->onError) napi_delete_reference(env, ctx->onError);
    }
    free(ctx);
    g_ctx = NULL;
}

// ---- Send helpers ----------------------------------------------------------

static void SendMsg(AudioMsg* msg) {
    if (!g_tsfn) { free(msg); return; }
    if (napi_call_threadsafe_function(g_tsfn, msg, napi_tsfn_nonblocking) != napi_ok)
        free(msg);
}

static void SendError(const char* text) {
    AudioMsg* m = (AudioMsg*)calloc(1, sizeof(AudioMsg));
    if (!m) return;
    m->type = MSG_ERROR;
    strncpy(m->errorText, text, 255);
    SendMsg(m);
}

// ---- COM completion handler ------------------------------------------------

class CompletionHandler : public IActivateAudioInterfaceCompletionHandler {
public:
    LONG          refCount;
    HANDLE        hEvent;
    HRESULT       hrResult;
    IAudioClient* pClient;

    CompletionHandler()
        : refCount(1)
        , hEvent(CreateEvent(NULL, FALSE, FALSE, NULL))
        , hrResult(E_FAIL)
        , pClient(NULL)
    {}

    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** ppv) override {
        if (IsEqualIID(riid, __uuidof(IUnknown)) ||
            IsEqualIID(riid, __uuidof(IActivateAudioInterfaceCompletionHandler))) {
            *ppv = static_cast<IActivateAudioInterfaceCompletionHandler*>(this);
            AddRef();
            return S_OK;
        }
        *ppv = NULL;
        return E_NOINTERFACE;
    }

    ULONG STDMETHODCALLTYPE AddRef() override {
        return (ULONG)InterlockedIncrement(&refCount);
    }

    ULONG STDMETHODCALLTYPE Release() override {
        LONG r = InterlockedDecrement(&refCount);
        if (r == 0) { CloseHandle(hEvent); delete this; }
        return (ULONG)r;
    }

    HRESULT STDMETHODCALLTYPE ActivateCompleted(
        IActivateAudioInterfaceAsyncOperation* op) override
    {
        HRESULT hrAct = E_FAIL;
        IUnknown* pUnk = NULL;
        op->GetActivateResult(&hrAct, &pUnk);
        hrResult = hrAct;
        if (SUCCEEDED(hrAct) && pUnk) {
            pUnk->QueryInterface(__uuidof(IAudioClient), (void**)&pClient);
            pUnk->Release();
        }
        SetEvent(hEvent);
        return S_OK;
    }
};

// ---- Audio capture thread --------------------------------------------------

typedef struct ThreadArgs_ { DWORD excludePid; } ThreadArgs;

static DWORD WINAPI AudioThread(LPVOID param) {
    ThreadArgs* args = (ThreadArgs*)param;
    DWORD excludePid = args->excludePid;
    free(args);

    CoInitializeEx(NULL, COINIT_MULTITHREADED);

    AUDIOCLIENT_ACTIVATION_PARAMS_ ap = {};
    ap.ActivationType                  = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
    ap.ProcessLoopbackParams.ProcessId = excludePid;
    ap.ProcessLoopbackParams.Mode      = PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;

    PROPVARIANT pv;
    PropVariantInit(&pv);
    pv.vt             = VT_BLOB;
    pv.blob.cbSize    = sizeof(ap);
    pv.blob.pBlobData = (BYTE*)&ap;

    CompletionHandler* ch = new CompletionHandler();
    IActivateAudioInterfaceAsyncOperation* pOp = NULL;

    HRESULT hr = ActivateAudioInterfaceAsync(
        VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
        __uuidof(IAudioClient),
        &pv,
        static_cast<IActivateAudioInterfaceCompletionHandler*>(ch),
        &pOp);
    if (pOp) pOp->Release();

    if (SUCCEEDED(hr)) {
        WaitForSingleObject(ch->hEvent, 5000);
        hr = ch->hrResult;
    }

    IAudioClient* pClient = ch->pClient;
    if (pClient) pClient->AddRef();
    ch->Release();

    if (FAILED(hr) || !pClient) {
        char buf[128];
        snprintf(buf, sizeof(buf), "ActivateAudioInterfaceAsync failed: 0x%08X", (unsigned)hr);
        SendError(buf);
        CoUninitialize();
        return 1;
    }

    WAVEFORMATEX wfx = {};
    wfx.wFormatTag      = WAVE_FORMAT_IEEE_FLOAT;
    wfx.nChannels       = 2;
    wfx.nSamplesPerSec  = 48000;
    wfx.wBitsPerSample  = 32;
    wfx.nBlockAlign     = 8;
    wfx.nAvgBytesPerSec = 48000 * 8;

    hr = pClient->Initialize(
        AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
        2000000, 0, &wfx, NULL);
    if (FAILED(hr)) {
        char buf[128];
        snprintf(buf, sizeof(buf), "IAudioClient::Initialize failed: 0x%08X", (unsigned)hr);
        SendError(buf);
        pClient->Release();
        CoUninitialize();
        return 1;
    }

    HANDLE hEvent = CreateEvent(NULL, FALSE, FALSE, NULL);
    pClient->SetEventHandle(hEvent);

    IAudioCaptureClient* pCapture = NULL;
    pClient->GetService(__uuidof(IAudioCaptureClient), (void**)&pCapture);

    { AudioMsg* m = (AudioMsg*)calloc(1, sizeof(AudioMsg));
      m->type = MSG_READY; m->sampleRate = 48000; m->channels = 2; SendMsg(m); }

    pClient->Start();

    const UINT32 CHUNK  = 960 * 2;
    const UINT32 RING   = CHUNK * 8;
    float* ring     = (float*)calloc(RING, sizeof(float));
    UINT32 ringHead = 0;
    UINT32 ringFill = 0;

    while (!InterlockedCompareExchange(&g_stop, 0, 0)) {
        if (WaitForSingleObject(hEvent, 50) == WAIT_TIMEOUT) continue;
        if (InterlockedCompareExchange(&g_stop, 0, 0)) break;

        UINT32 packetSize = 0;
        pCapture->GetNextPacketSize(&packetSize);

        while (packetSize > 0) {
            BYTE*  data      = NULL;
            UINT32 numFrames = 0;
            DWORD  flags     = 0;
            hr = pCapture->GetBuffer(&data, &numFrames, &flags, NULL, NULL);
            if (FAILED(hr)) break;

            if (!(flags & AUDCLNT_BUFFERFLAGS_SILENT) && data && numFrames > 0) {
                const float* src    = (const float*)data;
                UINT32       srcLen = numFrames * 2;
                for (UINT32 i = 0; i < srcLen; i++) {
                    ring[ringHead] = src[i];
                    ringHead = (ringHead + 1) % RING;
                    if (ringFill < RING) ringFill++;
                }
                while (ringFill >= CHUNK) {
                    float* chunk = (float*)malloc(CHUNK * sizeof(float));
                    UINT32 tail  = (ringHead - ringFill % RING + RING) % RING;
                    for (UINT32 j = 0; j < CHUNK; j++)
                        chunk[j] = ring[(tail + j) % RING];
                    ringFill -= CHUNK;
                    AudioMsg* m = (AudioMsg*)calloc(1, sizeof(AudioMsg));
                    m->type = MSG_CHUNK; m->chunkData = chunk; m->chunkCount = CHUNK;
                    SendMsg(m);
                }
            }
            pCapture->ReleaseBuffer(numFrames);
            pCapture->GetNextPacketSize(&packetSize);
        }
    }

    free(ring);
    pClient->Stop();
    pCapture->Release();
    CloseHandle(hEvent);
    pClient->Release();
    CoUninitialize();
    return 0;
}

// ---- JS: start(excludePid, onChunk, onReady, onError) ----------------------

static napi_value JsStart(napi_env env, napi_callback_info info) {
    size_t argc = 4;
    napi_value argv[4];
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
    if (argc < 4) { napi_throw_error(env, NULL, "start requires 4 arguments"); return NULL; }

    uint32_t excludePid = 0;
    napi_get_value_uint32(env, argv[0], &excludePid);

    if (g_thread) {
        InterlockedExchange(&g_stop, 1);
        WaitForSingleObject(g_thread, 3000);
        CloseHandle(g_thread);
        g_thread = NULL;
        InterlockedExchange(&g_stop, 0);
    }
    if (g_tsfn) {
        napi_release_threadsafe_function(g_tsfn, napi_tsfn_release);
        g_tsfn = NULL;
    }

    Ctx* ctx = (Ctx*)calloc(1, sizeof(Ctx));
    napi_create_reference(env, argv[1], 1, &ctx->onChunk);
    napi_create_reference(env, argv[2], 1, &ctx->onReady);
    napi_create_reference(env, argv[3], 1, &ctx->onError);
    g_ctx = ctx;

    napi_value resourceName;
    napi_create_string_utf8(env, "WasapiCapture", NAPI_AUTO_LENGTH, &resourceName);
    napi_status st = napi_create_threadsafe_function(
        env, argv[1], NULL, resourceName,
        0, 1, ctx, FinalizeCtx, ctx, Dispatch, &g_tsfn);
    if (st != napi_ok || !g_tsfn) {
        napi_throw_error(env, NULL, "napi_create_threadsafe_function failed");
        return NULL;
    }

    ThreadArgs* ta = (ThreadArgs*)calloc(1, sizeof(ThreadArgs));
    ta->excludePid = excludePid;
    InterlockedExchange(&g_stop, 0);
    g_thread = CreateThread(NULL, 0, AudioThread, ta, 0, NULL);

    napi_value undef;
    napi_get_undefined(env, &undef);
    return undef;
}

// ---- JS: stop() ------------------------------------------------------------

static napi_value JsStop(napi_env env, napi_callback_info) {
    InterlockedExchange(&g_stop, 1);
    if (g_thread) {
        WaitForSingleObject(g_thread, 3000);
        CloseHandle(g_thread);
        g_thread = NULL;
    }
    if (g_tsfn) {
        napi_release_threadsafe_function(g_tsfn, napi_tsfn_release);
        g_tsfn = NULL;
    }
    InterlockedExchange(&g_stop, 0);
    napi_value undef;
    napi_get_undefined(env, &undef);
    return undef;
}

// ---- Module init -----------------------------------------------------------

static napi_value ModuleInit(napi_env env, napi_value exports) {
    napi_value fnStart, fnStop;
    napi_create_function(env, "start", NAPI_AUTO_LENGTH, JsStart, NULL, &fnStart);
    napi_create_function(env, "stop",  NAPI_AUTO_LENGTH, JsStop,  NULL, &fnStop);
    napi_set_named_property(env, exports, "start", fnStart);
    napi_set_named_property(env, exports, "stop",  fnStop);
    return exports;
}

NAPI_MODULE(wasapi_capture, ModuleInit)