package ru.trioz.connect

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import org.amnezia.awg.GoBackend
import org.amnezia.awg.config.Config
import java.io.StringReader
import java.time.Instant

/**
 * VPN-ANDROID: нативный VPN-сервис на основе AmneziaWG Go-бэкенда.
 *
 * Архитектура повторяет десктоп-оболочку:
 *   1. Веб-часть собирает профиль (с приватным ключом устройства).
 *   2. JavaScript-мост VpnBridge передаёт его сюда.
 *   3. Сервис поднимает AmneziaWG-туннель через GoBackend.
 *   4. Изменения состояния уходят обратно в WebView через
 *      evaluateJavascript (аналог IPC.VPN_STATE в десктопе).
 *
 * Приватный ключ живёт только в памяти сервиса и нигде не записывается.
 */
class AmneziaVpnService : VpnService() {

    companion object {
        private const val TAG = "AmneziaVpnService"
        private const val NOTIF_CHANNEL = "vpn_tunnel"
        private const val NOTIF_ID = 7001

        const val ACTION_UP = "ru.trioz.connect.VPN_UP"
        const val ACTION_DOWN = "ru.trioz.connect.VPN_DOWN"
        const val EXTRA_CONFIG = "config"

        /**
         * Публичное состояние — читается VpnBridge синхронно.
         * Обновляется только из основного потока сервиса.
         */
        @Volatile var state: VpnState = VpnState.OFF
        @Volatile var since: String? = null
        @Volatile var lastError: String? = null

        /** Запустить туннель — вызывается из MainActivity после получения разрешения. */
        fun startUp(context: Context, config: String) {
            val intent = Intent(context, AmneziaVpnService::class.java).apply {
                action = ACTION_UP
                putExtra(EXTRA_CONFIG, config)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        /** Остановить туннель. */
        fun startDown(context: Context) {
            context.startService(
                Intent(context, AmneziaVpnService::class.java).apply { action = ACTION_DOWN },
            )
        }
    }

    private var backend: GoBackend? = null
    private var tunnel: TriozTunnel? = null

    // ── Lifecycle ────────────────────────────────────────────────────────

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_UP -> {
                val config = intent.getStringExtra(EXTRA_CONFIG) ?: ""
                if (config.isNotBlank()) bringUp(config)
            }
            ACTION_DOWN -> bringDown()
            else -> bringDown()
        }
        return START_NOT_STICKY
    }

    override fun onRevoke() {
        // Система отозвала разрешение VPN (другое приложение попросило его).
        Log.i(TAG, "VPN permission revoked by system")
        bringDown()
    }

    override fun onDestroy() {
        bringDown()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // ── Tunnel lifecycle ─────────────────────────────────────────────────

    private fun bringUp(rawConfig: String) {
        setState(VpnState.CONNECTING, null, null)
        ensureNotifChannel()
        startForeground(NOTIF_ID, buildNotification(VpnState.CONNECTING))

        try {
            val cfg = Config.parse(StringReader(rawConfig))
            val tun = TriozTunnel(cfg.`interface`.name.ifBlank { "trioz" })
            tunnel = tun

            val be = GoBackend(this)
            backend = be

            // GoBackend.setState поднимает туннель:
            // создаёт VpnService.Builder, устанавливает адреса/DNS/маршруты,
            // запускает amneziawg-go в режиме в памяти.
            val fd = be.setState(tun, org.amnezia.awg.backend.Tunnel.State.UP, cfg)
            if (fd == null) {
                throw IllegalStateException("GoBackend вернул null — туннель не поднялся")
            }

            setState(VpnState.ON, Instant.now().toString(), null)
            startForeground(NOTIF_ID, buildNotification(VpnState.ON))
            Log.i(TAG, "AmneziaWG tunnel UP")
        } catch (e: Exception) {
            Log.e(TAG, "Tunnel UP failed", e)
            val msg = e.message ?: "Ошибка запуска туннеля"
            setState(VpnState.ERROR, null, msg)
            stopForeground(true)
            stopSelf()
        }
    }

    private fun bringDown() {
        if (state == VpnState.OFF) return
        setState(VpnState.DISCONNECTING, since, null)
        try {
            val be = backend
            val tun = tunnel
            if (be != null && tun != null) {
                be.setState(tun, org.amnezia.awg.backend.Tunnel.State.DOWN, null)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Tunnel DOWN error (ignored)", e)
        } finally {
            backend = null
            tunnel = null
            setState(VpnState.OFF, null, null)
            stopForeground(true)
            stopSelf()
            Log.i(TAG, "AmneziaWG tunnel DOWN")
        }
    }

    // ── State ────────────────────────────────────────────────────────────

    private fun setState(s: VpnState, sinceVal: String?, err: String?) {
        state = s
        since = sinceVal
        lastError = err
        // Уведомить WebView — MainActivity слушает через статический callback.
        MainActivity.onVpnStateChanged?.invoke(s, sinceVal, err)
    }

    // ── Notification ─────────────────────────────────────────────────────

    private fun ensureNotifChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(NOTIF_CHANNEL) != null) return
        nm.createNotificationChannel(
            NotificationChannel(NOTIF_CHANNEL, "VPN-туннель", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Статус защищённого соединения"
            },
        )
    }

    private fun buildNotification(vpnState: VpnState): Notification {
        val tapIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val (title, text) = when (vpnState) {
            VpnState.ON -> Pair("Соединение активно", "Трафик защищён AmneziaWG")
            VpnState.CONNECTING -> Pair("Подключение…", "Устанавливается защищённое соединение")
            VpnState.DISCONNECTING -> Pair("Отключение…", "")
            else -> Pair("VPN", "")
        }
        return NotificationCompat.Builder(this, NOTIF_CHANNEL)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentIntent(tapIntent)
            .setOngoing(true)
            .setSilent(true)
            .build()
    }
}

/**
 * Реализация интерфейса Tunnel, нужного GoBackend.
 * Хранит имя и отдаёт GoBackend'у при каждом вызове setState.
 */
private class TriozTunnel(private val name: String) : org.amnezia.awg.backend.Tunnel {
    override fun getName(): String = name
    override fun onStateChange(newState: org.amnezia.awg.backend.Tunnel.State) {
        // GoBackend сам обновляет состояние; нам дублировать не нужно.
    }
}

/** Состояние туннеля — зеркало VpnConnState из десктоп-оболочки. */
enum class VpnState(val jsonKey: String) {
    OFF("off"),
    CONNECTING("connecting"),
    ON("on"),
    DISCONNECTING("disconnecting"),
    ERROR("error"),
}
