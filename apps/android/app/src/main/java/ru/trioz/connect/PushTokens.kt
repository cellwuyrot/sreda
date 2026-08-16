package ru.trioz.connect

import android.content.Context

/**
 * FIX-BOOT: адрес устройства для уведомлений и путь открытия из уведомления.
 *
 * Раньше и то и другое лежало в PushService — классе, который наследуется от
 * службы доставки. Из-за этого весь остальной код оказывался связан с ней:
 * собрать приложение без доставки было невозможно. Здесь — чистое хранилище
 * без единой внешней зависимости.
 */
object PushTokens {

    private const val PREFS = "tz_push"
    private const val KEY_TOKEN = "token"

    /** Адрес устройства; пустая строка — доставка не настроена. */
    fun stored(context: Context): String =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_TOKEN, "") ?: ""

    fun store(context: Context, token: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_TOKEN, token)
            .apply()
    }
}

/** Куда открыть приложение по нажатию на уведомление. */
const val EXTRA_LINK = "tz_link"

/** Категория уведомлений для входящих вызовов. */
const val CALL_CHANNEL_ID = "tz_connect_calls"
