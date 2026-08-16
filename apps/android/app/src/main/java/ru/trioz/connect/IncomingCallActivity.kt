package ru.trioz.connect

import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.core.app.NotificationManagerCompat

/**
 * CALL: окно входящего вызова.
 *
 * ── Зачем отдельное нативное окно, а не страница ─────────────────────
 *
 * Страница в WebView живёт только пока приложение открыто. На закрытом
 * телефоне её нет вообще: процесс выгружен, соединение разорвано. Поэтому
 * вызов показывает нативное окно, которое система поднимает поверх блокировки
 * сама, — а сам разговор уже идёт в веб-части, куда окно и передаёт управление
 * после нажатия «Ответить».
 *
 * ── Почему разметка в коде ───────────────────────────────────
 *
 * Окно показывает имя, две кнопки и ничего больше. Отдельный файл разметки
 * ради трёх элементов только разносит одно поведение по двум местам.
 */
class IncomingCallActivity : ComponentActivity() {

    companion object {
        const val EXTRA_CALL_ID = "tz_call_id"
        const val EXTRA_CALLER = "tz_call_from"
        const val EXTRA_VIDEO = "tz_call_video"

        /** Идентификатор уведомления вызова — его же гасим после ответа. */
        const val NOTIFICATION_ID = 4711
    }

    private var callId: String = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        callId = intent.getStringExtra(EXTRA_CALL_ID).orEmpty()
        val caller = intent.getStringExtra(EXTRA_CALLER).orEmpty().ifBlank { getString(R.string.app_name) }
        val video = intent.getBooleanExtra(EXTRA_VIDEO, false)

        /* Снятие блокировки просим у системы, а не обходим её: код блокировки
           спрашивает сама ОС — приложение его не видит. */
        val keyguard = getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#12121C"))
            setPadding(48, 96, 48, 96)
        }

        root.addView(TextView(this).apply {
            text = if (video) "Видеовызов" else "Вам звонят"
            textSize = 15f
            setTextColor(Color.parseColor("#9AA4B2"))
            gravity = Gravity.CENTER
        })

        root.addView(TextView(this).apply {
            text = caller
            textSize = 28f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setPadding(0, 24, 0, 64)
        })

        val buttons = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
        }

        buttons.addView(Button(this).apply {
            text = "Отклонить"
            setOnClickListener { decline() }
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                .apply { marginEnd = 24 }
        })

        buttons.addView(Button(this).apply {
            text = "Ответить"
            setOnClickListener { accept(keyguard) }
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        })

        root.addView(buttons)
        setContentView(root)
    }

    /**
     * Ответить.
     *
     * Сама трубка берётся не здесь: у нативного слоя нет ни сессии, ни медиа-
     * соединения, и заводить здесь второй звонковый слой означало бы две
     * разные реализации одного звонка. Окно лишь открывает приложение на адресе
     * вызова; веб-часть подключается, получает текущий вызов и показывает своё
     * окно с микрофоном и камерой.
     */
    private fun accept(keyguard: KeyguardManager?) {
        NotificationManagerCompat.from(this).cancel(NOTIFICATION_ID)

        val open = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(EXTRA_LINK, "/connect?call=" + callId)
        }

        /* Телефон заблокирован — просим систему показать блокировку и открыть
           разговор СРАЗУ после разблокировки, без второго нажатия. */
        if (keyguard?.isKeyguardLocked == true) {
            keyguard.requestDismissKeyguard(this, object : KeyguardManager.KeyguardDismissCallback() {
                override fun onDismissSucceeded() {
                    startActivity(open)
                    finish()
                }

                override fun onDismissCancelled() {
                    /* Отказались разблокировать — окно вызова остаётся на месте. */
                }
            })
            return
        }

        startActivity(open)
        finish()
    }

    /**
     * Отклонить.
     *
     * Серверу отсюда ничего не сообщается — снова из-за отсутствия сессии в
     * нативном слое. Звонящий увидит «Нет ответа» по истечении гудка
     * (CALL_RING_MS на сервере), а не «Отклонён». Свой телефон при этом замолкает
     * сразу — что и нужно тому, кто нажал.
     */
    private fun decline() {
        NotificationManagerCompat.from(this).cancel(NOTIFICATION_ID)
        finish()
    }
}
