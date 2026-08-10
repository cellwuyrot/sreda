package ru.trioz.connect

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlin.math.absoluteValue

/**
 * PUSH: доставка уведомлений в ЗАКРЫТОЕ приложение.
 *
 * ── Что было сломано ────────────────────────────────────────────────────────
 *
 * Уведомления показывались только пока приложение открыто: сообщение приходило
 * живым соединением, и его показывал мост из веб-части (см. NotificationBridge).
 * Свернули приложение, система выгрузила процесс — и мессенджер молчал до
 * следующего запуска. Для мессенджера это отсутствие главного.
 *
 * ── Почему служба доставки, а не свой фоновый процесс ───────────────────────
 *
 * Держать соединение в фоне значит вечно висеть в шторке («приложение работает»),
 * жечь батарею — и всё равно быть выгруженным системой в режиме энергосбережения.
 * Служба доставки живёт в самой ОС: она получает сообщение и будит приложение
 * ровно на время показа уведомления.
 *
 * ── Почему сообщение приходит БЕЗ готового уведомления ──────────────────────
 *
 * Сервер присылает только данные, а показывает уведомление этот класс. Причина в
 * дублировании: когда приложение открыто, уведомление уже показывает веб-часть по
 * живому соединению. Если бы сервер присылал готовый блок уведомления, система
 * рисовала бы его сама, и человек с открытым приложением получал бы всё дважды.
 * Здесь же видно, на переднем плане приложение или нет (см. ConnectApp), и
 * лишнее уведомление просто не показывается.
 *
 * ── Чего здесь нет ──────────────────────────────────────────────────────────
 *
 * Ни переписки, ни вложений, ни чужих идентификаторов: только заголовок, короткая
 * выжимка и путь, куда открыть. Всё то же, что и так видно в шторке.
 */
class PushService : FirebaseMessagingService() {

    companion object {
        /** Где лежит адрес устройства: его читает веб-часть и привязывает к аккаунту. */
        private const val PREFS = "tz_push"
        private const val KEY_TOKEN = "token"

        fun storedToken(context: Context): String =
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_TOKEN, "") ?: ""

        fun storeToken(context: Context, token: String) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_TOKEN, token)
                .apply()
        }
    }

    /**
     * Адрес устройства выдан или обновлён.
     *
     * Отправить его на сервер отсюда нельзя: у нативного слоя нет сессии человека,
     * а тащить сюда работу с cookie значило бы завести второй способ авторизации.
     * Поэтому адрес просто сохраняется, а привязывает его страница при следующем
     * открытии приложения (см. apps/web/src/hooks/usePushDevice.ts).
     */
    override fun onNewToken(token: String) {
        storeToken(this, token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        /* Приложение на переднем плане — уведомление уже показала веб-часть по
           живому соединению. Второе уведомление о том же сообщении раздражает
           сильнее, чем отсутствие уведомления вообще. */
        if (ConnectApp.isForeground) return

        val data = message.data
        val title = data["title"]?.take(120)?.ifBlank { null } ?: getString(R.string.app_name)
        val body = data["body"]?.take(400).orEmpty()
        val tag = data["tag"]?.take(80).orEmpty()
        val link = data["link"]?.take(400).orEmpty()

        if (!NotificationManagerCompat.from(this).areNotificationsEnabled()) return

        /* Канал создаёт MainActivity при запуске, но сюда мы попадаем и при
           закрытом приложении — тогда его ещё нет. */
        NotificationBridge.ensureChannel(this)

        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            /* Куда открыть. MainActivity может этим воспользоваться; если нет —
               человек просто попадёт туда, где остановился. */
            if (link.isNotEmpty()) putExtra(EXTRA_LINK, link)
        }
        val pending = PendingIntent.getActivity(
            this,
            if (tag.isEmpty()) 0 else tag.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val notification = NotificationCompat.Builder(this, NotificationBridge.CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().setBigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setAutoCancel(true)
            .setContentIntent(pending)
            .build()

        /* Одна метка — одно уведомление: сообщения одной беседы обновляют своё,
           а не копятся десятком строк в шторке. */
        val id = if (tag.isEmpty()) 1 else tag.hashCode().absoluteValue
        try {
            NotificationManagerCompat.from(this).notify(tag, id, notification)
        } catch (_: SecurityException) {
            /* разрешение отозвали — показывать нечего */
        }
    }
}

/** Куда открыть приложение по нажатию на уведомление. */
const val EXTRA_LINK = "tz_link"
