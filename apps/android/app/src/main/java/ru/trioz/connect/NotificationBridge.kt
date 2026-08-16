package ru.trioz.connect

import android.Manifest
import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.webkit.JavascriptInterface
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import kotlin.math.absoluteValue

/**
 * ANDROID-NOTIFY: мост «веб-часть → системные уведомления Android».
 *
 * Веб-приложение показывало уведомления через Web Notifications API
 * (`new Notification(...)`), но **WebView его не реализует**: объекта
 * `Notification` внутри оболочки нет, поэтому сообщения приходили по Socket.IO
 * (звук играл), а система Android ничего не показывала — ни в шторке, ни на
 * экране блокировки.
 *
 * Этот класс регистрируется в WebView как `window.AndroidNotify` (см.
 * MainActivity.configureWebView) и постит настоящее уведомление через
 * NotificationManagerCompat. Веб-сторона зовёт его через фасад
 * `apps/web/src/lib/appNotify.ts`, который в обычном браузере остаётся на Web
 * Notifications.
 *
 * Безопасность: FIX-SEC. Раньше здесь было написано «интерфейс доступен только
 * странице нашего origin» — но это было не так. addJavascriptInterface вешает мост на
 * WebView целиком, а значит на ЛЮБОЙ документ, который там окажется: навигационные
 * правила разбирают клики и историю, но не цепочку переадресаций сервера и не
 * встроенные фреймы. Поэтому каждый метод теперь спрашивает originOk(): чужая
 * страница не покажет уведомление от имени мессенджера и не прочитает токен
 * доставки.
 */
class NotificationBridge(
    private val activity: Activity,
    /** На нашем ли адресе текущая страница; считает MainActivity. */
    private val originOk: () -> Boolean,
    /** Запрос POST_NOTIFICATIONS (Android 13+); реализует MainActivity. */
    private val requestPermission: () -> Unit,
) {

    companion object {
        const val CHANNEL_ID = "tz_connect_messages"
        const val JS_NAME = "AndroidNotify"

        /**
         * Канал уведомлений «Сообщения». Создаётся при старте (Android 8+
         * требует канал до первого уведомления; minSdk проекта — 26).
         */
        fun ensureChannel(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val manager = context.getSystemService(NotificationManager::class.java) ?: return
            if (manager.getNotificationChannel(CHANNEL_ID) != null) return
            val channel = NotificationChannel(
                CHANNEL_ID,
                context.getString(R.string.notification_channel_messages),
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = context.getString(R.string.notification_channel_messages_desc)
                enableVibration(true)
                setShowBadge(true)
            }
            manager.createNotificationChannel(channel)
        }
    }

    /** Показать уведомление о новом сообщении. Зовётся из JS. */
    @JavascriptInterface
    fun notify(title: String?, body: String?, tag: String?) {
        if (!originOk()) return
        val safeTitle = title?.take(120)?.ifBlank { null }
            ?: activity.getString(R.string.app_name)
        val safeBody = body?.take(400) ?: ""
        val safeTag = tag?.take(80).orEmpty()

        activity.runOnUiThread {
            if (!areNotificationsEnabled()) return@runOnUiThread

            // Тап по уведомлению возвращает в уже открытое приложение
            // (launchMode=singleTask, поэтому новый экземпляр не создаётся).
            val intent = Intent(activity, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val pending = PendingIntent.getActivity(
                activity,
                0,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )

            val notification = NotificationCompat.Builder(activity, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(safeTitle)
                .setContentText(safeBody)
                .setStyle(NotificationCompat.BigTextStyle().bigText(safeBody))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setDefaults(NotificationCompat.DEFAULT_ALL)
                .setAutoCancel(true)
                .setContentIntent(pending)
                .build()

            // Одинаковый tag (беседа/канал) обновляет своё уведомление, а не
            // плодит новые — как это делает Web Notifications API.
            val id = if (safeTag.isEmpty()) 1 else safeTag.hashCode().absoluteValue
            try {
                NotificationManagerCompat.from(activity).notify(safeTag, id, notification)
            } catch (_: SecurityException) {
                /* разрешение отозвали между проверкой и показом — игнорируем */
            }
        }
    }

    /** Разрешены ли уведомления (канал + системное разрешение). Зовётся из JS. */
    @JavascriptInterface
    fun areNotificationsEnabled(): Boolean {
        if (!originOk()) return false
        if (!NotificationManagerCompat.from(activity).areNotificationsEnabled()) return false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return ContextCompat.checkSelfPermission(
                activity,
                Manifest.permission.POST_NOTIFICATIONS,
            ) == PackageManager.PERMISSION_GRANTED
        }
        return true
    }

    /** Запросить системное разрешение на уведомления. Зовётся из JS. */
    @JavascriptInterface
    fun requestPermission() {
        if (!originOk()) return
        activity.runOnUiThread { requestPermission.invoke() }
    }

    /**
     * PUSH: адрес этого устройства в службе доставки. Зовётся из JS.
     *
     * Нужен, чтобы уведомления доходили в ЗАКРЫТОЕ приложение: до этого они
     * показывались только пока живо соединение, то есть пока приложение открыто.
     *
     * Отправляет адрес на сервер страница, а не оболочка (см.
     * apps/web/src/hooks/usePushDevice.ts): сессия человека есть у страницы, а
     * тащить работу с cookie в нативный слой значило бы завести второй способ
     * авторизации там, где он не нужен. Пустая строка — доставка на этом
     * устройстве недоступна (служба не настроена в сборке или ещё не выдала адрес).
     */
    @JavascriptInterface
    fun pushToken(): String = if (originOk()) PushTokens.stored(activity) else ""
}
