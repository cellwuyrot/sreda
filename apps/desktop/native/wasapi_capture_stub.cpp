// Non-Windows stub — exports empty module so the build doesn't fail on macOS/Linux.
#include <napi.h>
Napi::Object Init(Napi::Env env, Napi::Object exports) { return exports; }
NODE_API_MODULE(wasapi_capture, Init)
