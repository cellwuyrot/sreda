package ru.trioz.connect.nativeui

import android.net.Uri
import org.json.JSONObject

internal fun historyPath(id: String, direct: Boolean, cursor: String? = null): String {
    require(id.isNotBlank())
    val base = if (direct) "/api/dm/${Uri.encode(id)}?limit=50" else "/api/messages?channelId=${Uri.encode(id)}&limit=50"
    return if (cursor.isNullOrBlank()) base else "$base&cursor=${Uri.encode(cursor)}"
}
internal data class MessagePage(val messages: List<JSONObject>, val cursor: String?, val paused: Boolean)
internal fun parseMessagePage(text: String): MessagePage {
    val data = JSONObject(text)
    val array = data.getJSONArray("messages")
    val messages = (0 until array.length()).map { array.getJSONObject(it).also { row -> require(row.optString("id").isNotBlank()) } }
    return MessagePage(messages, data.optString("nextCursor").takeUnless { it.isBlank() || it == "null" }, data.optBoolean("paused"))
}
/** Preserve server ordering and replace stale rows; never sort lexicographically by message ID. */
internal fun mergeHistory(older: List<JSONObject>, current: List<JSONObject>): List<JSONObject> =
    (older + current).associateBy { it.getString("id") }.values.toList()
internal fun messageText(message: JSONObject): String {
    val raw = message.optString("content").takeUnless { it == "null" }.orEmpty()
    return when {
        message.optBoolean("deleted") -> "Сообщение удалено"
        message.optBoolean("encrypted") || raw.startsWith("e2ee:") -> "Зашифрованное сообщение недоступно в тестовой версии"
        raw.isBlank() -> "Сообщение без текста или вложение"
        else -> raw
    }
}
internal fun channelTextError(text: String, premium: Boolean): String? {
    val maxChars = if (premium) 25000 else 12500
    val maxWords = if (premium) 4000 else 2000
    return when {
        text.isBlank() -> "Введите сообщение"
        text.trimStart().startsWith("e2ee:") -> "Зашифрованные сообщения здесь не поддерживаются"
        text.length > maxChars -> "Не более $maxChars знаков"
        text.trim().split(Regex("\\s+")).size > maxWords -> "Не более $maxWords слов"
        else -> null
    }
}
