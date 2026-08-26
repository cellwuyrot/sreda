package ru.trioz.connect

import android.Manifest
import android.app.Activity
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.net.VpnService
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import org.json.JSONObject
import ru.trioz.connect.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private val webView: WebView get() = binding.webView

    private var contentReady = false

    @Volatile
    private var webOriginTrusted = false

    // ── File uploads ─────────────────────────────────────────────────────
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private val fileChooserLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val callback = fileChooserCallback ?: return@registerForActivityResult
            fileChooserCallback = null
            val uris: Array<Uri>? = if (result.resultCode == RESULT_OK) {
                WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
            } else null
            callback.onReceiveValue(uris)
        }

    // ── WebRTC (mic/camera) ───────────────────────────────────────────────
    private var pendingWebPermission: PermissionRequest? = null
    private val runtimePermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { grants ->
            val request = pendingWebPermission
            pendingWebPermission = null
            if (request == null) return@registerForActivityResult
            val granted = request.resources.filter { res ->
                when (res) {
                    PermissionRequest.RESOURCE_AUDIO_CAPTURE -> grants[Manifest.permission.RECORD_AUDIO] == true
                    PermissionRequest.RESOURCE_VIDEO_CAPTURE -> grants[Manifest.permission.CAMERA] == true
                    else -> true
                }
            }.toTypedArray()
            if (granted.isNotEmpty()) request.grant(granted) else request.deny()
        }

    // ── Notifications (Android 13+) ──────────────────────────────────────
    private val notificationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (hasPermission(Manifest.permission.POST_NOTIFICATIONS)) return
        notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    // ── Geolocation ───────────────────────────────────────────────────────
    private var pendingGeoOrigin: String? = null
    private var pendingGeoCallback: GeolocationPermissions.Callback? = null
    private val geoPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { grants ->
            val origin = pendingGeoOrigin
            val callback = pendingGeoCallback
            pendingGeoOrigin = null
            pendingGeoCallback = null
            val allowed = grants[Manifest.permission.ACCESS_FINE_LOCATION] == true ||
                grants[Manifest.permission.ACCESS_COARSE_LOCATION] == true
            callback?.invoke(origin, allowed, false)
        }

    // ── Fullscreen video ──────────────────────────────────────────────────
    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null

    // ── VPN-ANDROID: разрешение и запуск туннеля ─────────────────────────
    /**
     * Профиль, который ждёт разрешения VPN.
     * Если пользователь ещё не выдал разрешение, Android показывает диалог.
     * После получения разрешения запускаем сервис с этим профилем.
     */
    private var pendingVpnConfig: String? = null

    private val vpnPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            if (result.resultCode == Activity.RESULT_OK) {
                val config = pendingVpnConfig ?: return@registerForActivityResult
                pendingVpnConfig = null
                AmneziaVpnService.startUp(this, config)
            } else {
                pendingVpnConfig = null
                // Пользователь отказал — сообщаем об этом веб-части.
                notifyVpnState(VpnState.ERROR, null, "Разрешение VPN не выдано")
            }
        }

    companion object {
        /**
         * VPN-ANDROID: callback для уведомления WebView об изменении состояния.
         * Устанавливается в onCreate, очищается в onDestroy.
         * AmneziaVpnService вызывает его при каждом изменении статуса.
         */
        @Volatile
        var onVpnStateChanged: ((VpnState, String?, String?) -> Unit)? = null
    }

    // ── VPN public API (вызывается из VpnBridge через runOnUiThread) ──────

    /** Запустить туннель с готовым профилем WireGuard/AmneziaWG. */
    fun vpnUp(config: String) {
        val prepareIntent = VpnService.prepare(this)
        if (prepareIntent != null) {
            // Разрешения ещё нет — сохраняем профиль и показываем диалог.
            pendingVpnConfig = config
            vpnPermissionLauncher.launch(prepareIntent)
        } else {
            // Разрешение уже есть — запускаем сервис сразу.
            AmneziaVpnService.startUp(this, config)
        }
    }

    /** Остановить туннель. */
    fun vpnDown() {
        AmneziaVpnService.startDown(this)
    }

    /** Передать состояние туннеля в WebView через evaluateJavascript. */
    private fun notifyVpnState(state: VpnState, since: String?, error: String?) {
        val json = JSONObject().apply {
            put("state", state.jsonKey)
            put("since", since ?: JSONObject.NULL)
            put("error", error ?: JSONObject.NULL)
            put("backend", if (state == VpnState.ON || state == VpnState.CONNECTING) "amneziawg" else JSONObject.NULL)
            put("embedded", true)
        }.toString()
        // Экранируем для вставки в JS-строку.
        val escaped = json.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n")
        webView.evaluateJavascript("window.__androidVpnState && window.__androidVpnState(\"$escaped\")", null)
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────

    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        super.onCreate(savedInstanceState)
        splash.setKeepOnScreenCondition { !contentReady }

        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        configureWebView()
        registerBackNavigation()

        NotificationBridge.ensureChannel(this)

        // VPN-ANDROID: слушаем изменения состояния туннеля.
        onVpnStateChanged = { state, since, error ->
            runOnUiThread { notifyVpnState(state, since, error) }
        }

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
            contentReady = true
        } else {
            webView.loadUrl(linkFromIntent(intent) ?: Config.startUrl)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val url = linkFromIntent(intent) ?: return
        webView.loadUrl(url)
    }

    override fun onDestroy() {
        onVpnStateChanged = null
        webView.destroy()
        super.onDestroy()
    }

    private fun linkFromIntent(source: Intent?): String? {
        val raw = source?.getStringExtra(EXTRA_LINK)?.trim().orEmpty()
        if (raw.isEmpty()) return null
        if (!raw.startsWith("/")) return null
        val url = Config.appUrl + raw
        return if (Config.isBlockedInApp(url)) null else url
    }

    // ── WebView configuration ─────────────────────────────────────────────

    @Suppress("SetJavaScriptEnabled")
    private fun configureWebView() {
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, false)
        }

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            mediaPlaybackRequiresUserGesture = false
            loadWithOverviewMode = true
            useWideViewPort = true
            allowFileAccess = false
            allowContentAccess = false
            cacheMode = WebSettings.LOAD_DEFAULT
            textZoom = 100
            userAgentString = "$userAgentString ConnectAndroid/${BuildConfig.VERSION_NAME}"
        }

        webView.webViewClient = ConnectWebViewClient()
        webView.webChromeClient = ConnectWebChromeClient()

        webView.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            startDownload(url, userAgent, contentDisposition, mimeType)
        }

        // Мост уведомлений.
        webView.addJavascriptInterface(
            NotificationBridge(
                activity = this,
                originOk = { webOriginTrusted },
            ) { requestNotificationPermission() },
            NotificationBridge.JS_NAME,
        )

        // VPN-ANDROID: мост управления нативным туннелем.
        webView.addJavascriptInterface(
            VpnBridge(
                activity = this,
                originOk = { webOriginTrusted },
            ),
            VpnBridge.JS_NAME,
        )
    }

    // ── Navigation policy ─────────────────────────────────────────────────

    private inner class ConnectWebViewClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url.toString()
            when {
                Config.isExternal(url) -> { openExternally(url); return true }
                Config.isBlockedInApp(url) -> { view.loadUrl(Config.startUrl); return true }
            }
            return false
        }

        override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
            super.doUpdateVisitedHistory(view, url, isReload)
            webOriginTrusted = url != null && url.startsWith(Config.appUrl)
            if (isReload || url == null || !Config.isBlockedInApp(url)) return
            if (view.canGoBack()) view.goBack() else view.loadUrl(Config.startUrl)
        }

        override fun onPageFinished(view: WebView, url: String?) {
            super.onPageFinished(view, url)
            webOriginTrusted = url != null && url.startsWith(Config.appUrl)
            contentReady = true

            // VPN-ANDROID: при перезагрузке страницы отдаём актуальное состояние.
            if (webOriginTrusted) {
                notifyVpnState(AmneziaVpnService.state, AmneziaVpnService.since, AmneziaVpnService.lastError)
            }
        }
    }

    // ── Media / file-chooser / fullscreen ─────────────────────────────────

    private inner class ConnectWebChromeClient : WebChromeClient() {
        override fun onPermissionRequest(request: PermissionRequest) {
            runOnUiThread { handleWebPermission(request) }
        }

        override fun onShowFileChooser(
            webView: WebView,
            filePathCallback: ValueCallback<Array<Uri>>,
            fileChooserParams: FileChooserParams,
        ): Boolean {
            fileChooserCallback?.onReceiveValue(null)
            fileChooserCallback = filePathCallback
            return try {
                val intent = fileChooserParams.createIntent().apply {
                    if (fileChooserParams.mode == FileChooserParams.MODE_OPEN_MULTIPLE) {
                        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                    }
                }
                fileChooserLauncher.launch(intent)
                true
            } catch (_: ActivityNotFoundException) {
                fileChooserCallback = null
                false
            }
        }

        override fun onGeolocationPermissionsShowPrompt(
            origin: String,
            callback: GeolocationPermissions.Callback,
        ) {
            if (hasLocationPermission()) {
                callback.invoke(origin, true, false)
            } else {
                pendingGeoOrigin = origin
                pendingGeoCallback = callback
                geoPermissionLauncher.launch(
                    arrayOf(
                        Manifest.permission.ACCESS_FINE_LOCATION,
                        Manifest.permission.ACCESS_COARSE_LOCATION,
                    ),
                )
            }
        }

        override fun onShowCustomView(view: View, callback: CustomViewCallback) {
            if (customView != null) { callback.onCustomViewHidden(); return }
            customView = view
            customViewCallback = callback
            binding.fullscreenContainer.addView(
                view, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT,
            )
            binding.fullscreenContainer.visibility = View.VISIBLE
            binding.webView.visibility = View.GONE
        }

        override fun onHideCustomView() {
            val view = customView ?: return
            binding.fullscreenContainer.removeView(view)
            binding.fullscreenContainer.visibility = View.GONE
            binding.webView.visibility = View.VISIBLE
            customView = null
            customViewCallback?.onCustomViewHidden()
            customViewCallback = null
        }
    }

    private fun handleWebPermission(request: PermissionRequest) {
        val wanted = request.resources.filter {
            it == PermissionRequest.RESOURCE_AUDIO_CAPTURE ||
                it == PermissionRequest.RESOURCE_VIDEO_CAPTURE
        }
        if (wanted.isEmpty()) { request.deny(); return }
        val missing = mutableListOf<String>()
        if (wanted.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE) &&
            !hasPermission(Manifest.permission.RECORD_AUDIO)
        ) missing.add(Manifest.permission.RECORD_AUDIO)
        if (wanted.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE) &&
            !hasPermission(Manifest.permission.CAMERA)
        ) missing.add(Manifest.permission.CAMERA)
        if (missing.isEmpty()) request.grant(wanted.toTypedArray())
        else { pendingWebPermission = request; runtimePermissionLauncher.launch(missing.toTypedArray()) }
    }

    // ── Downloads ─────────────────────────────────────────────────────────

    private fun startDownload(url: String, userAgent: String?, contentDisposition: String?, mimeType: String?) {
        if (!url.startsWith("http")) return
        try {
            val fileName = URLUtil.guessFileName(url, contentDisposition, mimeType)
            val request = DownloadManager.Request(Uri.parse(url)).apply {
                setMimeType(mimeType)
                addRequestHeader("User-Agent", userAgent)
                addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url))
                setDescription(getString(R.string.download_in_progress))
                setTitle(fileName)
                setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
            }
            (getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(request)
            Toast.makeText(this, R.string.download_started, Toast.LENGTH_SHORT).show()
        } catch (_: Exception) {
            Toast.makeText(this, R.string.download_failed, Toast.LENGTH_SHORT).show()
        }
    }

    private fun openExternally(url: String) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(this, R.string.no_app_to_open_link, Toast.LENGTH_SHORT).show()
        }
    }

    // ── Back navigation ───────────────────────────────────────────────────

    private fun registerBackNavigation() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                when {
                    customView != null -> webView.webChromeClient?.onHideCustomView()
                    webView.canGoBack() -> webView.goBack()
                    else -> finish()
                }
            }
        })
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    private fun hasPermission(permission: String): Boolean =
        ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

    private fun hasLocationPermission(): Boolean =
        hasPermission(Manifest.permission.ACCESS_FINE_LOCATION) ||
            hasPermission(Manifest.permission.ACCESS_COARSE_LOCATION)

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onPause() { super.onPause(); webView.onPause() }
    override fun onResume() { super.onResume(); webView.onResume() }
}
