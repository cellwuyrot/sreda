package ru.trioz.connect

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.VpnService
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.adguard.trusttunnel.CertificateVerificator
import com.adguard.trusttunnel.VpnClient
import com.adguard.trusttunnel.VpnClientListener
import com.adguard.trusttunnel.VpnState as ClientState
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Experimental debug-only engine.
 * Credentials are kept in memory only; do not log, persist or export the config.
 * The controller must obtain user VPN permission and disallow simultaneous AWG.
 */
class TrustTunnelPilotService : VpnService(), VpnClientListener {
    companion object {
        const val ACTION_START = "ru.trioz.connect.TRUSTTUNNEL_PILOT_START"
        const val ACTION_STOP = "ru.trioz.connect.TRUSTTUNNEL_PILOT_STOP"
        const val EXTRA_PROFILE = "profile"
        private const val CHANNEL = "trusttunnel_pilot"
        private const val NOTIFICATION_ID = 7101
        @Volatile var state = "off"; private set
        @Volatile var error: String? = null; private set
        fun reserve() { state = "connecting"; error = null }
        fun reportFailure(message: String) { state = "error"; error = message }
        fun reportOff() { state = "off"; error = null }
    }
    private val worker = Executors.newSingleThreadScheduledExecutor()
    private var client: VpnClient? = null
    private var callback: ConnectivityManager.NetworkCallback? = null
    private var verifier: CertificateVerificator? = null
    @Volatile private var stopping = false

    override fun onCreate() {
        super.onCreate()
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL, "TrustTunnel: тест", NotificationManager.IMPORTANCE_LOW))
        worker.scheduleWithFixedDelay({
            try {
                if (client != null && (!VpnAdmissionPolicy.check(this).allowed || prepare(this) != null)) {
                    stopEngine("VPN-допуск или системное разрешение отозвано")
                }
            } catch (_: Exception) { stopEngine("Не удалось проверить VPN-допуск") }
        }, 3, 3, TimeUnit.SECONDS)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            worker.execute { stopEngine(null) }
            return START_NOT_STICKY
        }
        if (intent?.action != ACTION_START) { stopSelf(startId); return START_NOT_STICKY }
        val config = intent.getStringExtra(EXTRA_PROFILE)
        intent.removeExtra(EXTRA_PROFILE)
        val notification = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification).setContentTitle("TrioZ VPN: тест")
            .setContentText("Подключение TrustTunnel").setOngoing(true).setSilent(true).build()
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification,
            if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0)
        worker.execute {
            try {
                check(client == null && config != null && config.length <= 12000)
                stopping = false
                check(VpnAdmissionPolicy.check(this).allowed && prepare(this) == null)
                // The SDK can include parser diagnostics in log output; do not log pilot secrets.
                com.adguard.trusttunnel.Logger.setCallback { _, _ -> }
                // Do not pass an untrusted document to the upstream TOML parser:
                // its parser can log errors, potentially including secrets.
                check(TrustTunnelPilotProfile.accepts(config))
                val routes = checkNotNull(VpnClient.excludeCidr(
                    listOf("0.0.0.0/0", "2000::/3"),
                    listOf("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "0.0.0.0/8", "224.0.0.0/3")))
                val builder = Builder().setSession("TrioZ TrustTunnel: тест")
                    .setMtu(1350).addAddress("172.20.2.13", 32)
                    .addAddress("fdfd:29::2", 64) // Engine sockets are protected via protectSocket; app traffic uses VPN.
                // Mirrors the upstream adapter's empty dns_upstreams behavior.
                val dns = listOf("46.243.231.30", "46.243.231.31", "2a10:50c0::2:ff", "2a10:50c0::1:ff")
                dns.forEach { builder.addDnsServer(it) }
                routes.forEach { route ->
                    val parts = route.split('/')
                    require(parts.size == 2)
                    builder.addRoute(parts[0], parts[1].toInt())
                }
                verifier = CertificateVerificator()
                val tunFd = checkNotNull(builder.establish())
                try {
                    val next = VpnClient(config, this)
                    client = next
                    state = "connecting"; error = null
                    registerNetworkListener()
                    check(next.start(tunFd))
                } finally { try { tunFd.close() } catch (_: Exception) {} }
            } catch (_: Exception) {
                stopEngine("Не удалось запустить тестовый TrustTunnel")
            } catch (_: LinkageError) {
                stopEngine("Движок TrustTunnel недоступен в сборке")
            }
        }
        return START_NOT_STICKY
    }

    private fun registerNetworkListener() {
        val cm = getSystemService(ConnectivityManager::class.java)
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .addCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN).build()
        val listener = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) { worker.execute { client?.notifyNetworkChange(true) } }
            override fun onLost(network: Network) { worker.execute {
                val available = cm.allNetworks.any { n -> cm.getNetworkCapabilities(n)?.let {
                    it.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
                        it.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)
                } == true }
                client?.notifyNetworkChange(available)
            } }
        }
        cm.registerNetworkCallback(request, listener); callback = listener
    }

    override fun protectSocket(socket: Int): Boolean = protect(socket)
    override fun verifyCertificate(certificate: ByteArray?, rawChain: List<ByteArray?>?): Boolean =
        try { verifier?.verifyCertificate(certificate, rawChain) == true } catch (_: Exception) { false }
    override fun onConnectionInfo(info: String) { /* Never log connection metadata. */ }
    override fun onStateChanged(state: Int) {
        try {
            when (ClientState.getByCode(state)) {
                ClientState.CONNECTED -> { Companion.state = "on"; error = null }
                ClientState.CONNECTING, ClientState.RECOVERING, ClientState.WAITING_RECOVERY,
                ClientState.WAITING_FOR_NETWORK -> Companion.state = "connecting"
                ClientState.DISCONNECTED -> if (!stopping && !worker.isShutdown) worker.execute { stopEngine("Тестовый VPN отключён") }
            }
        } catch (_: Exception) { if (!worker.isShutdown) worker.execute { stopEngine("Ошибка состояния VPN") } }
    }
    private fun stopEngine(reason: String?, finish: Boolean = true) {
        callback?.let { try { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(it) } catch (_: Exception) {} }
        callback = null
        stopping = true
        val old = client; client = null
        try { old?.stop() } catch (_: Exception) {} finally { try { old?.close() } catch (_: Exception) {} }
        verifier = null; error = reason; state = if (reason == null) "off" else "error"
        stopForeground(STOP_FOREGROUND_REMOVE)
        if (finish) stopSelf()
    }
    override fun onRevoke() { if (!worker.isShutdown) worker.execute { stopEngine("Разрешение VPN отозвано") } }
    override fun onDestroy() {
        // Do not overwrite an error reported before service destruction.
        if (!worker.isShutdown) { worker.execute { stopEngine(error, finish = false) }; worker.shutdown() }
        super.onDestroy()
    }
}
