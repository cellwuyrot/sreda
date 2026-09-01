{
  "targets": [{
    "target_name": "wasapi_capture",
    "conditions": [["OS=='win'", {
      "sources": ["native/wasapi_capture.cpp"],
      "libraries": ["-lole32", "-lwinmm", "-luuid", "-lmfuuid"],
      "defines": ["UNICODE", "_UNICODE", "NAPI_VERSION=8"],
      "include_dirs": [],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 1,
          "AdditionalOptions": ["/std:c++17"]
        },
        "VCLinkerTool": {
          "AdditionalDependencies": [
            "ole32.lib", "uuid.lib", "winmm.lib", "mfuuid.lib"
          ]
        }
      }
    }, {
      "sources": ["native/wasapi_capture_stub.cpp"]
    }]]
  }]
}
