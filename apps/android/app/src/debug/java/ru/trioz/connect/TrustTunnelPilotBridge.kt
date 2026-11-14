package ru.trioz.connect

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.net.VpnService
import android.webkit.WebView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

/** Debug only. Same-origin main frame, plus a server-authorized profile. */
internal class TrustTunnelPilotBridge(private val activity: MainActivity) {
    private var pending: String? = null
    private var generation = 0L
    private var permissionInFlight = false
    private val permission = activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val profile = pending
        pending = null
        permissionInFlight = false
        if (profile == null) return@registerForActivityResult
        if (result.resultCode != Activity.RESULT_OK) {
            TrustTunnelPilotService.reportFailure("Разрешение VPN не выдано")
        } else start(profile)
    }
    fun busy(): Boolean = permissionInFlight || TrustTunnelPilotService.state in setOf("connecting", "on", "disconnecting")
    private fun snapshot() = JSONObject().put("state", TrustTunnelPilotService.state)
        .put("error", TrustTunnelPilotService.error ?: JSONObject.NULL)
    private fun start(profile: String) {
        if (activity.awgBusy() || !VpnAdmissionPolicy.check(activity).allowed || VpnService.prepare(activity) != null) {
            TrustTunnelPilotService.reportFailure("VPN занят или системное разрешение отозвано")
            return
        }
        try {
            activity.startForegroundService(Intent(activity, TrustTunnelPilotService::class.java)
                .setAction(TrustTunnelPilotService.ACTION_START).putExtra(TrustTunnelPilotService.EXTRA_PROFILE, profile))
        } catch (_: Exception) { TrustTunnelPilotService.reportFailure("Android не разрешил запуск VPN") }
    }
    fun install(view: WebView) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
        WebViewCompat.addWebMessageListener(view, "TriozTrustTunnelPilotBridge", setOf(Config.appUrl)) { _, msg, origin, mainFrame, reply ->
            if (!mainFrame || !Config.isTrustedOrigin(origin.toString()) || msg.data.orEmpty().length > 12000) return@addWebMessageListener
            var id = ""
            try {
                val req = JSONObject(msg.data.orEmpty()); id = req.getString("id")
                require(id.matches(Regex("[A-Za-z0-9-]{1,80}")))
                when (req.getString("op")) {
                    "status" -> Unit
                    "down" -> {
                        pending = null
                        generation++
                        if (TrustTunnelPilotService.state in setOf("connecting", "on", "disconnecting")) {
                            activity.startService(Intent(activity, TrustTunnelPilotService::class.java).setAction(TrustTunnelPilotService.ACTION_STOP))
                        } else TrustTunnelPilotService.reportOff()
                    }
                    "up" -> {
                        val profile = req.getString("config")
                        check(TrustTunnelPilotProfile.accepts(profile)) { "Неверный профиль VPN" }
                        check(!busy() && !activity.awgBusy()) { "Сначала отключите другое VPN-соединение" }
                        val admission = VpnAdmissionPolicy.check(activity)
                        check(admission.allowed) { "Локальная политика VPN не разрешает подключение" }
                        TrustTunnelPilotService.reserve()
                        val token = ++generation
                        AlertDialog.Builder(activity).setTitle("VPN-соединение TrustTunnel")
                            .setMessage("TrustTunnel доступен по подписке. При отключении VPN Android может использовать обычную сеть. Продолжить?")
                            .setPositiveButton("Продолжить") { _, _ ->
                                if (token != generation) return@setPositiveButton
                                if (activity.awgBusy() || !VpnAdmissionPolicy.check(activity).allowed) {
                                    TrustTunnelPilotService.reportFailure("VPN занят или локальный допуск отозван")
                                } else {
                                    val consent = VpnService.prepare(activity)
                                    if (consent != null) {
                                        pending = profile; permissionInFlight = true
                                        try { permission.launch(consent) } catch (_: Exception) { pending = null; permissionInFlight = false; TrustTunnelPilotService.reportFailure("Не удалось запросить разрешение VPN") }
                                    } else start(profile)
                                }
                            }.setNegativeButton("Отмена") { _, _ -> if (token == generation) TrustTunnelPilotService.reportOff() }
                            .setOnCancelListener { if (token == generation) TrustTunnelPilotService.reportOff() }.show()
                    }
                    else -> throw IllegalArgumentException("Неизвестная операция")
                }
                reply.postMessage(JSONObject().put("id", id).put("result", snapshot()).toString())
            } catch (_: Exception) {
                reply.postMessage(JSONObject().put("id", id).put("error", "Не удалось выполнить операцию VPN").toString())
            }
        }
    }
}
