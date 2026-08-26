package ru.trioz.connect

import android.webkit.JavascriptInterface
import org.json.JSONObject

/**
 * VPN-ANDROID: JavaScript-мост для управления нативным VPN-туннелем.
 *
 * Зеркалит `window.triozDesktop.vpn` из десктоп-оболочки:
 *   up(config)  — поднять туннель по готовому профилю WireGuard/AmneziaWG
 *   down()      — снять туннель
 *   status()    — текущее состояние (синхронно, строка JSON)
 *
 * Мост работает только на нашем origin (см. originOk). Стороннее
 * iframe или перехваченная страница не получат доступа к управлению VPN.
 *
 * Вызовы приходят из потока JS-движка, поэтому все изменения состояния
 * делаем через Handler/runOnUiThread в MainActivity.
 */
class VpnBridge(
    private val activity: MainActivity,
    private val originOk: () -> Boolean,
) {
    companion object {
        const val JS_NAME = "TriozVpnBridge"
    }

    /**
     * Поднять туннель. Принимает готовый профиль WireGuard/AmneziaWG
     * (строка .conf с приватным ключом). Возвращает JSON-состояние.
     *
     * Если у приложения ещё нет разрешения VPN, MainActivity покажет
     * системный диалог и дождётся ответа пользователя.
     */
    @JavascriptInterface
    fun up(config: String): String {
        if (!originOk()) return errorJson("Доступ запрещён")
        if (config.isBlank()) return errorJson("Профиль пуст")
        return try {
            activity.runOnUiThread { activity.vpnUp(config) }
            pendingJson()
        } catch (e: Exception) {
            errorJson(e.message ?: "Ошибка запуска VPN")
        }
    }

    /** Снять туннель. */
    @JavascriptInterface
    fun down(): String {
        if (!originOk()) return errorJson("Доступ запрещён")
        return try {
            activity.runOnUiThread { activity.vpnDown() }
            disconnectingJson()
        } catch (e: Exception) {
            errorJson(e.message ?: "Ошибка остановки VPN")
        }
    }

    /** Текущее состояние туннеля — синхронно. */
    @JavascriptInterface
    fun status(): String = buildStateJson(
        AmneziaVpnService.state,
        AmneziaVpnService.since,
        AmneziaVpnService.lastError,
    )

    // ── JSON helpers ─────────────────────────────────────────────────────

    private fun buildStateJson(st: VpnState, since: String?, error: String?): String =
        JSONObject().apply {
            put("state", st.jsonKey)
            put("since", since ?: JSONObject.NULL)
            put("error", error ?: JSONObject.NULL)
            put("backend", if (st == VpnState.ON || st == VpnState.CONNECTING) "amneziawg" else JSONObject.NULL)
            put("embedded", true)
        }.toString()

    private fun pendingJson() = buildStateJson(VpnState.CONNECTING, null, null)
    private fun disconnectingJson() = buildStateJson(VpnState.DISCONNECTING, null, null)
    private fun errorJson(msg: String) = buildStateJson(VpnState.ERROR, null, msg)
}
