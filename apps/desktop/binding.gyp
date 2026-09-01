{
  "targets": [{
    "target_name": "wasapi_capture",
    "conditions": [["OS=='win'", {
      "sources": ["native/wasapi_capture.cpp"],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include_dir\")"
      ],
      "libraries": ["-lole32", "-lwinmm", "-luuid", "-lmfuuid"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS", "UNICODE", "_UNICODE"],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 0,
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
