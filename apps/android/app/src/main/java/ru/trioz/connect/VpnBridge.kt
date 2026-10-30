package ru.trioz.connect

import android.net.Uri
import androidx.webkit.WebViewFeature
import androidx.webkit.JavaScriptReplyProxy
import org.json.JSONObject

/** Main-frame + exact-origin WebMessage listener. No addJavascriptInterface for VPN. */
class VpnBridge(private val activity: MainActivity) {
    private var account = ""
    companion object { const val JS_NAME = "TriozVpnBridge" }
    fun receive(raw: String, source: Uri, mainFrame: Boolean, reply: JavaScriptReplyProxy) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
        if (!mainFrame || !Config.isTrustedOrigin(source.toString()) || raw.length > 40000) return
        var id = ""
        try {
            val request = JSONObject(raw)
            id = request.getString("id")
            require(id.matches(Regex("[A-Za-z0-9-]{1,80}")))
            val result: Any = when (request.getString("op")) {
                "status" -> AmneziaVpnService.snapshot()
                "admission" -> VpnAdmissionPolicy.check(activity).let {
                    JSONObject().put("allowed", it.allowed).put("message", it.message).put("version", it.version)
                }
                "publicKey" -> {
                    val admission = VpnAdmissionPolicy.check(activity)
                    check(admission.allowed) { admission.message }
                    val idScope = request.getString("account")
                    require(idScope.matches(Regex("[A-Za-z0-9_-]{1,128}")))
                    account = idScope
                    VpnKeyStore(activity).pair(account).publicKey.toBase64()
                }
                "up" -> {
                    val admission = VpnAdmissionPolicy.check(activity)
                    check(admission.allowed) { admission.message }
                    val config = request.getString("config")
                    VpnProfile.withNativeKey(config, VpnKeyStore(activity).pair(account).privateKey.toBase64())
                    activity.vpnUp(config, account)
                    JSONObject().put("state", "connecting").put("since", JSONObject.NULL).put("error", JSONObject.NULL)
                        .put("backend", "amneziawg").put("embedded", true)
                }
                "down" -> { activity.vpnDown(); AmneziaVpnService.snapshot() }
                else -> throw IllegalArgumentException("Unknown operation")
            }
            reply.postMessage(JSONObject().put("id", id).put("result", result).toString())
        } catch (e: Exception) {
            reply.postMessage(JSONObject().put("id", id).put("error", e.message?.take(500) ?: "Ошибка VPN").toString())
        }
    }
}
