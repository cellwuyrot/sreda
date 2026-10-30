package ru.trioz.connect

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.VpnService
import android.os.Build
import android.os.IBinder
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import org.amnezia.awg.backend.GoBackend
import org.amnezia.awg.backend.Tunnel
import org.amnezia.awg.backend.TunnelActionHandler
import org.json.JSONObject
import java.time.Instant
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

/** Foreground controller. The library's protected VpnService owns TUN/socket protection. */
class AmneziaVpnService : Service() {
    companion object {
        private const val CHANNEL = "vpn_tunnel"
        private const val NOTIFICATION = 7001
        private const val UP = "ru.trioz.connect.VPN_UP"
        private const val DOWN = "ru.trioz.connect.VPN_DOWN"
        @Volatile var state = VpnState.OFF; private set
        @Volatile var since: String? = null; private set
        @Volatile var lastError: String? = null; private set
        @Volatile private var rx = 0L
        @Volatile private var tx = 0L
        @Volatile private var handshake = 0L
        fun snapshot() = JSONObject().put("state", state.jsonKey).put("since", since ?: JSONObject.NULL)
            .put("error", lastError ?: JSONObject.NULL).put("backend", "amneziawg").put("embedded", true)
            .put("rxBytes", rx).put("txBytes", tx).put("lastHandshakeMs", handshake)
        fun report(s: VpnState, error: String? = null) {
            state = s; lastError = error
            if (s == VpnState.ON && since == null) since = Instant.now().toString()
            if (s == VpnState.OFF || s == VpnState.ERROR) since = null
            MainActivity.onVpnStateChanged?.invoke(s, since, error)
        }
        fun startUp(context: Context, config: String, account: String) {
            val intent = Intent(context, AmneziaVpnService::class.java).setAction(UP).putExtra("config", config).putExtra("account", account)
            context.startForegroundService(intent)
        }
        fun startDown(context: Context) {
            if (state == VpnState.OFF || state == VpnState.ERROR) { report(VpnState.OFF); return }
            context.startService(Intent(context, AmneziaVpnService::class.java).setAction(DOWN))
        }
    }
    private val worker = Executors.newSingleThreadScheduledExecutor()
    private val generation = AtomicLong()
    private var backend: GoBackend? = null
    private var tunnel: Tunnel? = null
    private var started = 0L
    private var stopping = false
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onCreate() {
        super.onCreate()
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL, "VPN-соединение", NotificationManager.IMPORTANCE_LOW))
        worker.scheduleWithFixedDelay({ monitor() }, 2, 3, TimeUnit.SECONDS)
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val command = generation.incrementAndGet()
        when (intent?.action) {
            UP -> {
                report(VpnState.CONNECTING)
                ServiceCompat.startForeground(this, NOTIFICATION, notification("Подключение VPN…"),
                    if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0)
                val raw = intent.getStringExtra("config").orEmpty()
                worker.execute {
                    if (command != generation.get()) return@execute
                    try {
                        val admission = VpnAdmissionPolicy.check(this)
                        check(admission.allowed) { admission.message }
                        check(VpnService.prepare(this) == null) { "Нет системного разрешения VPN" }
                        stopBackend()
                        val cfg = VpnProfile.withNativeKey(raw, VpnKeyStore(this).pair(intent.getStringExtra("account").orEmpty()).privateKey.toBase64())
                        val hooks = object : TunnelActionHandler {
                            override fun runPreUp(scripts: Collection<String>) { check(scripts.isEmpty()) }
                            override fun runPostUp(scripts: Collection<String>) { check(scripts.isEmpty()) }
                            override fun runPreDown(scripts: Collection<String>) { check(scripts.isEmpty()) }
                            override fun runPostDown(scripts: Collection<String>) { check(scripts.isEmpty()) }
                        }
                        val be = GoBackend(this, hooks)
                        val tun = object : Tunnel {
                            override fun getName() = "trioz"
                            override fun isIpv4ResolutionPreferred() = true
                            override fun isMetered() = true
                            override fun onStateChange(newState: Tunnel.State) {
                                if (newState == Tunnel.State.DOWN && !stopping && !worker.isShutdown)
                                    worker.execute { if (tunnel === this) fail("Системное VPN-соединение остановлено") }
                            }
                        }
                        backend = be; tunnel = tun
                        rx = 0; tx = 0; handshake = 0; since = null
                        started = SystemClock.elapsedRealtime()
                        check(be.setState(tun, Tunnel.State.UP, cfg) == Tunnel.State.UP)
                        // ON is reported only after a fresh authenticated handshake, not interface creation.
                        if (command != generation.get()) stopBackend()
                    } catch (_: Exception) {
                        if (command == generation.get()) fail("Не удалось запустить VPN. Проверьте допуск, разрешение и доступность сервера.")
                    }
                }
            }
            DOWN -> {
                report(VpnState.DISCONNECTING)
                worker.execute { stopBackend(); report(VpnState.OFF); finishService() }
            }
            else -> { report(VpnState.OFF); stopSelf() }
        }
        return START_NOT_STICKY
    }
    private fun monitor() {
        if (backend == null || tunnel == null) return
        try {
            val admission = VpnAdmissionPolicy.check(this)
            if (!admission.allowed) { fail(admission.message); return }
            if (VpnService.prepare(this) != null) { fail("Разрешение VPN отозвано системой"); return }
            val stats = backend!!.getStatistics(tunnel!!)
            rx = stats.totalRx(); tx = stats.totalTx()
            handshake = stats.peers().mapNotNull { stats.peer(it)?.latestHandshakeEpochMillis() }.maxOrNull() ?: 0
            val recent = handshake > 0 && System.currentTimeMillis() - handshake in 0..180000
            if (recent) {
                started = SystemClock.elapsedRealtime()
                if (state != VpnState.ON) {
                    report(VpnState.ON)
                    getSystemService(NotificationManager::class.java).notify(NOTIFICATION, notification("VPN: рукопожатие подтверждено"))
                }
            } else {
                if (SystemClock.elapsedRealtime() - started > 60000) { fail("Сервер не подтвердил VPN-соединение. Проверьте сеть или смените сервер."); return }
                if (state != VpnState.CONNECTING) report(VpnState.CONNECTING)
            }
        } catch (_: Exception) { fail("Ошибка проверки VPN-соединения") }
    }
    private fun stopBackend() {
        stopping = true
        try { tunnel?.let { backend?.setState(it, Tunnel.State.DOWN, null) } } catch (_: Exception) { }
        finally { backend = null; tunnel = null; stopping = false }
    }
    private fun fail(message: String) {
        stopBackend()
        report(VpnState.ERROR, message)
        finishService()
    }
    private fun finishService() { stopForeground(STOP_FOREGROUND_REMOVE); stopSelf() }
    override fun onDestroy() {
        generation.incrementAndGet()
        worker.execute { stopBackend(); if (state != VpnState.ERROR) report(VpnState.OFF) }
        worker.shutdown()
        super.onDestroy()
    }
    private fun notification(text: String): Notification {
        val tap = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val stop = PendingIntent.getService(this, 1, Intent(this, AmneziaVpnService::class.java).setAction(DOWN), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        return NotificationCompat.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("TrioZ VPN").setContentText(text).setContentIntent(tap).setOngoing(true)
            .setSilent(true).addAction(0, "Отключить", stop).build()
    }
}
enum class VpnState(val jsonKey: String) { OFF("off"), CONNECTING("connecting"), ON("on"), DISCONNECTING("disconnecting"), ERROR("error") }
