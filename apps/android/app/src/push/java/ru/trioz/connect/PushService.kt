package ru.trioz.connect

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
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

    /**
     * Адрес устройства выдан или обновлён.
     *
     * Отправить его на сервер отсюда нельзя: у нативного слоя нет сессии человека,
     * а тащить сюда работу с cookie значило бы завести второй способ авторизации.
     * Поэтому адрес просто сохраняется, а привязывает его страница при следующем
     * открытии приложения (см. apps/web/src/hooks/usePushDevice.ts).
     */
    override fun onNewToken(token: String) {
        PushTokens.store(this, token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        /* CALL: вызов разбирается ДО проверки переднего плана.

           Для сообщения выйти раньше правильно: открытое приложение покажет его
           само. Для вызова — нет: событие по живому соединению и доставленное
           сообщение идут разными путями и с разной скоростью, а терять вызов
           нельзя ни в одном состоянии приложения. Повтор здесь не страшен:
           окно вызова одно (launchMode=singleInstance), а уведомление идёт по
           постоянному идентификатору. */
        if (message.data["type"] == "call") {
            showIncomingCall(message.data)
            return
        }

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

    /**
     * CALL: показать входящий вызов.
     *
     * Главное здесь — setFullScreenIntent: именно он разворачивает окно вызова
     * поверх блокировки, как у телефонного звонка. Уведомление всё равно
     * строится полноценным: на активном экране система покажет его вместо
     * окна — выдергивать человека из того, что он делает, система отказывается.
     */
    private fun showIncomingCall(data: Map<String, String>) {
        val callId = data["callId"]?.take(64).orEmpty()
        if (callId.isEmpty()) return
        val caller = data["callerName"]?.take(120)?.ifBlank { null } ?: getString(R.string.app_name)
        val video = data["callVideo"] == "1"

        if (!NotificationManagerCompat.from(this).areNotificationsEnabled()) return
        ensureCallChannel()

        val full = Intent(this, IncomingCallActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            putExtra(IncomingCallActivity.EXTRA_CALL_ID, callId)
            putExtra(IncomingCallActivity.EXTRA_CALLER, caller)
            putExtra(IncomingCallActivity.EXTRA_VIDEO, video)
        }
        val pending = PendingIntent.getActivity(
            this,
            callId.hashCode(),
            full,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val notification = NotificationCompat.Builder(this, CALL_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(caller)
            .setContentText(if (video) "Видеовызов" else "Вам звонят")
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            /* setOngoing — вызов нельзя смахнуть случайным жестом. */
            .setOngoing(true)
            .setAutoCancel(false)
            .setContentIntent(pending)
            .setFullScreenIntent(pending, true)
            .build()

        try {
            NotificationManagerCompat.from(this)
                .notify(IncomingCallActivity.NOTIFICATION_ID, notification)
        } catch (_: SecurityException) {
            /* разрешение отозвали — показывать нечего */
        }
    }

    /**
     * Отдельная категория для звонков.
     *
     * Почему не общая с сообщениями: человек вправе приглушить переписку и
     * оставить звонки — или наоборот. В общей категории выбора не было бы.
     */
    private fun ensureCallChannel() {
        val manager = getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CALL_CHANNEL_ID) != null) return
        val channel = NotificationChannel(
            CALL_CHANNEL_ID,
            "Звонки",
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "Входящие вызовы в приложении"
            enableVibration(true)
            setBypassDnd(true)
            lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
        }
        manager.createNotificationChannel(channel)
    }
}
