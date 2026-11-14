package ru.trioz.connect
import android.webkit.WebView
/** The pilot must not be included in Android release builds. */
internal class TrustTunnelPilotBridge(private val activity: MainActivity) {
    fun busy(): Boolean = false
    fun install(view: WebView) = Unit
}
