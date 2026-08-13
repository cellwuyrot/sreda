package ru.trioz.connect

import android.Manifest
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
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
import ru.trioz.connect.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private val webView: WebView get() = binding.webView

    /** Set true once the first real page finished loading (dismisses the splash). */
    private var contentReady = false

    /**
     * FIX-SEC: на каком адресе сейчас страница — на нашем или на чужом.
     *
     * JavaScript-мост уведомлений виден ЛЮБОЙ странице в этом WebView — включая
     * стороннюю, куда могла увести цепочка переадресаций или встроенный фрейм.
     * Такая страница могла показывать системные уведомления от имени мессенджера
     * и читать токен доставки через pushToken(). Флаг обновляется в потоке UI, а
     * читается из потока JavaScript-моста — отсюда @Volatile.
     */
    @Volatile
    private var webOriginTrusted = false

    // ── File uploads (message attachments) ──────────────────────────────
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private val fileChooserLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val callback = fileChooserCallback ?: return@registerForActivityResult
            fileChooserCallback = null
            val uris: Array<Uri>? = if (result.resultCode == RESULT_OK) {
                WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
            } else {
                null
            }
            callback.onReceiveValue(uris)
        }

    // ── WebRTC (mic/camera) permission bridging ─────────────────────────
    private var pendingWebPermission: PermissionRequest? = null
    private val runtimePermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { grants ->
            val request = pendingWebPermission
            pendingWebPermission = null
            if (request == null) return@registerForActivityResult
            val granted = request.resources.filter { res ->
                when (res) {
                    PermissionRequest.RESOURCE_AUDIO_CAPTURE ->
                        grants[Manifest.permission.RECORD_AUDIO] == true
                    PermissionRequest.RESOURCE_VIDEO_CAPTURE ->
                        grants[Manifest.permission.CAMERA] == true
                    else -> true
                }
            }.toTypedArray()
            if (granted.isNotEmpty()) request.grant(granted) else request.deny()
        }

    // ── ANDROID-NOTIFY: системное разрешение на уведомления (Android 13+) ──
    private val notificationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { /* результат не нужен:
            веб-сторона просто перестанет получать системные тосты, если отказали */ }

    /** Запросить POST_NOTIFICATIONS, если он ещё не выдан (до Android 13 — no-op). */
    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (hasPermission(Manifest.permission.POST_NOTIFICATIONS)) return
        notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    // ── Geolocation (map sharing) permission bridging ───────────────────
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

    // ── Fullscreen <video> support ──────────────────────────────────────
    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        super.onCreate(savedInstanceState)
        splash.setKeepOnScreenCondition { !contentReady }

        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        configureWebView()
        registerBackNavigation()

        /* ANDROID-NOTIFY: канал уведомлений нужен до первого показа (Android 8+). */
        NotificationBridge.ensureChannel(this)

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
            contentReady = true
        } else {
            /* PUSH: приложение могли открыть нажатием на уведомление — тогда
               открываем сразу тот разговор, о котором оно было. Без этого человек
               попадал бы на общий экран и искал сообщение сам. */
            webView.loadUrl(linkFromIntent(intent) ?: Config.startUrl)
        }
    }

    /**
     * PUSH: приложение уже было открыто, и человек нажал на уведомление.
     *
     * launchMode=singleTask, поэтому нового экземпляра не создаётся — приходит
     * только новый intent. Переход выполняем через loadUrl, а не перезагрузкой
     * оболочки: страница остаётся живой, и разговор в голосовом канале не рвётся.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val url = linkFromIntent(intent) ?: return
        webView.loadUrl(url)
    }

    /**
     * Полный адрес из уведомления. null — уведомление без адреса или адрес чужой.
     *
     * Проверка обязательна: в intent может прийти что угодно, а WebView оболочки
     * открывает ТОЛЬКО свой origin и только разрешённые разделы (см. Config).
     * Иначе нажатие на подделанное уведомление увело бы оболочку на чужой сайт.
     */
    private fun linkFromIntent(source: Intent?): String? {
        val raw = source?.getStringExtra(EXTRA_LINK)?.trim().orEmpty()
        if (raw.isEmpty()) return null
        if (!raw.startsWith("/")) return null
        val url = Config.appUrl + raw
        return if (Config.isBlockedInApp(url)) null else url
    }

    @Suppress("SetJavaScriptEnabled")
    private fun configureWebView() {
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            /* FIX-SEC: было true. Оболочка работает с одним своим адресом, чужие
               cookie ей не нужны, а их приём — это слежка и лишняя поверхность
               для CSRF во встроенных фреймах. */
            setAcceptThirdPartyCookies(webView, false)
        }

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            /* FIX-SEC: было true при setSupportMultipleWindows(false) — сочетание
               бессмысленное: окна всё равно не открываются, а window.open() из
               любого скрипта обходит проверку «по жесту пользователя». */
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            // Voice channels autoplay remote audio without a tap.
            mediaPlaybackRequiresUserGesture = false
            loadWithOverviewMode = true
            useWideViewPort = true
            allowFileAccess = false
            allowContentAccess = false
            cacheMode = WebSettings.LOAD_DEFAULT
            /* FIX-EMOJI: системный масштаб шрифта сюда не пускаем.

               WebView по умолчанию берёт textZoom из настроек системы (Настройки →
               Экран → Размер шрифта) и масштабирует только текст. Картинки он не
               трогает вовсе. Эмодзи у нас — картинки 20–22px рядом с текстом,
               поэтому при системном увеличении шрифта (частая настройка, особенно
               130% и выше) текст растёт, а глиф остаётся прежним — и вся строка
               выглядит перекошенной. Именно поэтому «кривые эмодзи» видны в
               андроид-клиенте и не воспроизводятся в браузере на том же телефоне.

               Доступность от этого не страдает: размер текста чата настраивается в
               самом приложении (--tz-chat-body-size), и там он меняет всю строку
               целиком — вместе с глифами. */
            textZoom = 100
            // Identify the shell so the site can tell it apart from a plain
            // mobile browser, while keeping the mobile responsive layout.
            userAgentString = "$userAgentString ConnectAndroid/${BuildConfig.VERSION_NAME}"
        }

        webView.webViewClient = ConnectWebViewClient()
        webView.webChromeClient = ConnectWebChromeClient()

        webView.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            startDownload(url, userAgent, contentDisposition, mimeType)
        }

        /* ANDROID-NOTIFY: мост в системные уведомления. WebView не реализует Web
           Notifications API, поэтому веб-часть (lib/appNotify.ts) зовёт этот
           интерфейс — и сообщения видны в шторке и на экране блокировки. */
        webView.addJavascriptInterface(
            NotificationBridge(
                activity = this,
                /* FIX-SEC: мост работает только на нашем адресе. */
                originOk = { webOriginTrusted },
            ) { requestNotificationPermission() },
            NotificationBridge.JS_NAME,
        )
    }

    // ── Navigation policy (зеркалит десктоп-оболочку и apps/web/src/lib/shell.ts) ──
    private inner class ConnectWebViewClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url.toString()
            when {
                Config.isExternal(url) -> {
                    openExternally(url)
                    return true
                }
                Config.isBlockedInApp(url) -> {
                    view.loadUrl(Config.startUrl)
                    return true
                }
            }
            return false
        }

        /**
         * ANDROID-LOCK: страховка от SPA-навигации. Сайт — Next.js-приложение:
         * внутренние переходы выполняются через history.pushState и НЕ проходят
         * через shouldOverrideUrlLoading. Первая линия защиты — веб-гард
         * (AndroidShellGuard глушит клики по ссылкам вне /connect и прячет
         * сайтовые кнопки по классу tz-android), а этот хук — пос��едний рубеж:
         * если клиентский роутер всё же увёл страницу в сайтовый раздел,
         * возвращаем оболочку на стартовый экран мессенджера.
         */
        override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
            super.doUpdateVisitedHistory(view, url, isReload)
            webOriginTrusted = url != null && url.startsWith(Config.appUrl)
            if (isReload || url == null || !Config.isBlockedInApp(url)) return

            /* Возвращаемся мягко. Раньше здесь стоял loadUrl(startUrl): он
               перезагружает страницу целиком, а вместе с ней сносит дерево
               React с VoiceProvider — человека молча выбрасывало из голосового
               канала просто потому, что он открыл раздел вне мессенджера.
               Шаг назад по истории возвращает то же место без перезагрузки,
               и разговор продолжается. Полная загрузка остаётся запасным
               путём: если истории нет (переход был первым), возвращаться
               некуда. */
            if (view.canGoBack()) view.goBack() else view.loadUrl(Config.startUrl)
        }

        override fun onPageFinished(view: WebView, url: String?) {
            super.onPageFinished(view, url)
            webOriginTrusted = url != null && url.startsWith(Config.appUrl)
            contentReady = true
        }
    }

    // ── Media / file-chooser / fullscreen bridging ──────────────────────
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
            if (customView != null) {
                callback.onCustomViewHidden()
                return
            }
            customView = view
            customViewCallback = callback
            binding.fullscreenContainer.addView(
                view,
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
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

    /**
     * Grant a WebRTC media request, prompting for the matching Android runtime
     * permission first if it has not been granted yet.
     */
    private fun handleWebPermission(request: PermissionRequest) {
        // Only mic/camera come from same-origin voice channels; deny the rest.
        val wanted = request.resources.filter {
            it == PermissionRequest.RESOURCE_AUDIO_CAPTURE ||
                it == PermissionRequest.RESOURCE_VIDEO_CAPTURE
        }
        if (wanted.isEmpty()) {
            request.deny()
            return
        }

        val missing = mutableListOf<String>()
        if (wanted.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE) &&
            !hasPermission(Manifest.permission.RECORD_AUDIO)
        ) {
            missing.add(Manifest.permission.RECORD_AUDIO)
        }
        if (wanted.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE) &&
            !hasPermission(Manifest.permission.CAMERA)
        ) {
            missing.add(Manifest.permission.CAMERA)
        }

        if (missing.isEmpty()) {
            request.grant(wanted.toTypedArray())
        } else {
            pendingWebPermission = request
            runtimePermissionLauncher.launch(missing.toTypedArray())
        }
    }

    // ── Downloads (attachments, exports) ────────────────────────────────
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

    // ── Back button: navigate WebView history, then close fullscreen, then exit ──
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

    private fun hasPermission(permission: String): Boolean =
        ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

    private fun hasLocationPermission(): Boolean =
        hasPermission(Manifest.permission.ACCESS_FINE_LOCATION) ||
            hasPermission(Manifest.permission.ACCESS_COARSE_LOCATION)

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onPause() {
        super.onPause()
        webView.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }
}
