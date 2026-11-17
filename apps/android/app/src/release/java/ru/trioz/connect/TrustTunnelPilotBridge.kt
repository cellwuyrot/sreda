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

/** Same-origin main-frame bridge for a server-authorized TrustTunnel profile. */
internal class TrustTunnelPilotBridge(private val activity: MainActivity) {
    private var pending: String? = null
    private var generation = 0L
    private var permissionInFlight = false
    private var settingsOpen = false
    private class UserVisibleFailure(message: String) : Exception(message)
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
        .put("confirmed", TrustTunnelPilotService.state == "on")
    private fun start(profile: String) {
        try {
            if (activity.awgBusy() || !VpnAdmissionPolicy.check(activity).allowed || VpnService.prepare(activity) != null) {
                TrustTunnelPilotService.reportFailure("VPN занят или системное разрешение отозвано")
                return
            }
            activity.startForegroundService(Intent(activity, TrustTunnelPilotService::class.java)
                .setAction(TrustTunnelPilotService.ACTION_START).putExtra(TrustTunnelPilotService.EXTRA_PROFILE, profile))
        } catch (_: Exception) { TrustTunnelPilotService.reportFailure("Android не разрешил запуск VPN") }
    }
    fun install(view: WebView) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
        WebViewCompat.addWebMessageListener(view, "TriozTrustTunnelPilotBridge", setOf(Config.appUrl)) { _, msg, origin, mainFrame, reply ->
            if (!mainFrame || !Config.isTrustedOrigin(origin.toString()) || msg.data.orEmpty().length > 12000) return@addWebMessageListener
            var id = ""
            var reservedByRequest = false
            try {
                val req = JSONObject(msg.data.orEmpty()); id = req.getString("id")
                require(id.matches(Regex("[A-Za-z0-9-]{1,80}")))
                when (req.getString("op")) {
                    "status" -> Unit
                    "settings" -> {
                        check(!busy() && !settingsOpen) { "Сначала отключите TrustTunnel" }
                        settingsOpen = true
                        try { TrustTunnelRoutingSettings.open(activity, { !busy() }, { settingsOpen = false }) }
                        catch (e: Exception) { settingsOpen = false; throw e }
                    }
                    "down" -> {
                        pending = null
                        generation++
                        if (TrustTunnelPilotService.state in setOf("connecting", "on", "disconnecting")) {
                            activity.startService(Intent(activity, TrustTunnelPilotService::class.java).setAction(TrustTunnelPilotService.ACTION_STOP))
                        } else TrustTunnelPilotService.reportOff()
                    }
                    "up" -> {
                        val profile = req.getString("config")
                        TrustTunnelStartGuard.failure(
                            profileValid = TrustTunnelPilotProfile.accepts(profile),
                            busy = busy() || settingsOpen || activity.awgBusy(),
                            admission = VpnAdmissionPolicy.check(activity),
                        )?.let { throw UserVisibleFailure(it) }
                        TrustTunnelPilotService.reserve()
                        reservedByRequest = true
                        val token = ++generation
                        AlertDialog.Builder(activity).setTitle("VPN-соединение TrustTunnel")
                            .setMessage("TrustTunnel доступен по подписке. При отключении VPN Android может использовать обычную сеть. Продолжить?")
                            .setPositiveButton("Продолжить") { _, _ ->
                                if (token != generation) return@setPositiveButton
                                if (activity.awgBusy() || !VpnAdmissionPolicy.check(activity).allowed) {
                                    TrustTunnelPilotService.reportFailure("VPN занят или локальный допуск отозван")
                                } else {
                                    try {
                                        val consent = VpnService.prepare(activity)
                                        if (consent != null) {
                                            pending = profile; permissionInFlight = true
                                            permission.launch(consent)
                                        } else start(profile)
                                    } catch (_: Exception) {
                                        pending = null; permissionInFlight = false
                                        TrustTunnelPilotService.reportFailure("Не удалось запросить разрешение VPN в Android")
                                    }
                                }
                            }.setNegativeButton("Отмена") { _, _ -> if (token == generation) TrustTunnelPilotService.reportOff() }
                            .setOnCancelListener { if (token == generation) TrustTunnelPilotService.reportOff() }.show()
                    }
                    else -> throw IllegalArgumentException("Неизвестная операция")
                }
                reply.postMessage(JSONObject().put("id", id).put("result", snapshot()).toString())
            } catch (e: Exception) {
                // Only explicitly whitelisted, credential-free text crosses the bridge.
                val message = (e as? UserVisibleFailure)?.message ?: "Не удалось выполнить операцию VPN"
                if (reservedByRequest) TrustTunnelPilotService.reportFailure(message)
                reply.postMessage(JSONObject().put("id", id).put("error", message).toString())
            }
        }
    }
}
