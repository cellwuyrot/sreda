// WASAPI-SS stub для не-Windows платформ.
// Экспортирует {start, stop}, оба сразу выбрасывают Error.
#define NAPI_VERSION 8
#include <node_api.h>

static napi_value Unavailable(napi_env env, napi_callback_info) {
    napi_throw_error(env, nullptr, "WASAPI loopback is Windows-only");
    napi_value u; napi_get_undefined(env, &u); return u;
}

static napi_value ModuleInit(napi_env env, napi_value exports) {
    napi_value fn;
    napi_create_function(env, "start", NAPI_AUTO_LENGTH, Unavailable, nullptr, &fn);
    napi_set_named_property(env, exports, "start", fn);
    napi_create_function(env, "stop",  NAPI_AUTO_LENGTH, Unavailable, nullptr, &fn);
    napi_set_named_property(env, exports, "stop", fn);
    return exports;
}

NAPI_MODULE(wasapi_capture, ModuleInit)
