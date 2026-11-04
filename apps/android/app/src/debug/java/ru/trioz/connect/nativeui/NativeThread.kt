package ru.trioz.connect.nativeui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject

/** Memory-only drafts. No writes to legacy storage or plaintext DM sends. */
@Composable internal fun NativeThread(
    api: NativeApi, id: String, direct: Boolean, premium: Boolean, p: Palette,
    expired: () -> Unit,
) {
    var messages by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var cursor by remember { mutableStateOf<String?>(null) }
    var paused by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var sending by remember { mutableStateOf(false) }
    var loaded by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var draft by remember { mutableStateOf("") }
    var uncertain by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val list = rememberLazyListState()
    fun failure(e: Exception) {
        if (e is NativeApiException && e.status == 401) expired()
        else error = e.message ?: "Не удалось связаться с сервером"
    }
    suspend fun load(older: Boolean) {
        if (loading || sending) return
        loading = true; error = null
        try {
            val requested = if (older) cursor ?: return else null
            val page = parseMessagePage(api.get(historyPath(id, direct, requested)))
            // A repeated cursor would otherwise create an endless load loop.
            check(!older || page.cursor == null || page.cursor != requested) { "Сервер не продвинул страницу истории" }
            messages = if (older) mergeHistory(page.messages, messages) else page.messages
            cursor = page.cursor; paused = page.paused; loaded = true
            if (!older && messages.isNotEmpty()) list.scrollToItem(messages.lastIndex + 1)
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { failure(e) }
        finally { loading = false }
    }
    LaunchedEffect(api, id, direct) { load(false) }
    BackHandler(sending) { error = "Дождитесь результата отправки. При закрытии приложения результат может быть неизвестен." }
    Column(Modifier.fillMaxSize().imePadding().padding(horizontal = 18.dp)) {
        Text(if (direct) "Личные сообщения: только просмотр. Зашифрованный текст недоступен; отметка прочтения не отправляется."
            else "Текст канала · без вложений и realtime. Черновик хранится только до ухода с экрана.",
            color = p.muted, fontSize = 12.sp, modifier = Modifier.padding(vertical = 8.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            TextButton(enabled = !loading && !sending, onClick = { scope.launch { load(false) } }) { Text("Обновить последние") }
            if (loading) CircularProgressIndicator(Modifier.size(24.dp), color = p.accent, strokeWidth = 2.dp)
        }
        error?.let { Text(it, color = p.accent, fontSize = 13.sp, modifier = Modifier.padding(vertical = 6.dp)) }
        LazyColumn(state = list, modifier = Modifier.weight(1f).fillMaxWidth()) {
            item(key = "history-control") {
                if (cursor != null) TextButton(enabled = !loading && !sending, onClick = { scope.launch { load(true) } }) { Text("Загрузить более ранние") }
                else if (loaded) Text(if (messages.isEmpty()) "Сообщений пока нет" else "Начало доступной истории", color = p.muted, fontSize = 12.sp)
            }
            items(messages, key = { "message:${it.getString("id")}" }) { message ->
                Column(Modifier.fillMaxWidth().padding(vertical = 9.dp)) {
                    val author = message.optJSONObject("user")?.optString("name")?.takeUnless { it.isBlank() || it == "null" } ?: "Участник"
                    Text(author, color = p.accent, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                    Text(messageText(message), color = p.text, fontSize = 14.sp)
                }
            }
        }
        if (paused) Text("Сообщество приостановлено", color = p.muted, fontSize = 13.sp)
        if (!direct) {
            if (uncertain) {
                Text("Результат отправки неизвестен. Обновите последние сообщения и проверьте, не появился ли текст. Автоматического повтора нет.", color = p.accent, fontSize = 12.sp)
                TextButton(enabled = !loading, onClick = { uncertain = false; error = null }) { Text("История проверена — разрешить отправку") }
            }
            val validation = channelTextError(draft, premium)
            OutlinedTextField(value = draft, onValueChange = { draft = it }, enabled = !sending,
                label = { Text("Сообщение в канал") }, maxLines = 5,
                modifier = Modifier.fillMaxWidth(), isError = draft.isNotBlank() && validation != null,
                supportingText = { if (draft.isNotBlank() && validation != null) Text(validation) })
            Button(enabled = loaded && !paused && !sending && !loading && !uncertain && validation == null,
                modifier = Modifier.fillMaxWidth().padding(bottom = 6.dp), onClick = {
                    sending = true; error = null
                    val submitted = draft
                    scope.launch {
                        try {
                            val message = api.sendChannelText(id, submitted)
                            check(message.optString("id").isNotBlank()) { "Ответ отправки не содержит сообщения" }
                            messages = mergeHistory(messages, listOf(message)); draft = ""
                            list.scrollToItem(messages.lastIndex + 1)
                        } catch (e: CancellationException) { throw e }
                        catch (e: Exception) {
                            // Even HTTP 5xx can occur after the database write. Do not auto-repeat.
                            uncertain = e !is NativeApiException || e.status >= 500 || e.status in 300..399
                            failure(e)
                        } finally { sending = false }
                    }
                }) { Text(if (sending) "Отправка…" else "Отправить") }
        }
    }
}
