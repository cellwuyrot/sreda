# The app is a thin WebView shell — there is no obfuscation-sensitive logic and
# minification is disabled by default. Keep the JavaScript bridge annotation so
# that, if you ever add an @JavascriptInterface method, R8 does not strip it.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
