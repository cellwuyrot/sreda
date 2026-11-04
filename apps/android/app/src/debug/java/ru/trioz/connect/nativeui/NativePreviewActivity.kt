package ru.trioz.connect.nativeui

import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import ru.trioz.connect.BuildConfig
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import kotlinx.coroutines.CancellationException
import org.json.JSONArray
import org.json.JSONObject

/** Debug-only, native vertical slice. Not the release launcher or a replacement for the existing client. */
class NativePreviewActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = getSharedPreferences("native_preview_theme", MODE_PRIVATE)
        setContent { NativePreview(prefs.getString("theme", "dark") ?: "dark") { prefs.edit().putString("theme", it).apply() } }
    }
}

internal data class Palette(val bg: Color, val surface: Color, val text: Color, val muted: Color, val accent: Color, val line: Color)
private fun palette(theme: String): Palette = when (theme) {
    "light" -> Palette(Color(0xfff5faf8), Color(0xffe7f0ed), Color(0xff172b2c), Color(0xff596e6d), Color(0xff007e7a), Color(0xffd4e5e0))
    "warm" -> Palette(Color(0xfffff9f1), Color(0xfff2e9dc), Color(0xff302b24), Color(0xff756c60), Color(0xff8b6436), Color(0xffe2d4c3))
    "mono" -> Palette(Color(0xff111111), Color(0xff242424), Color.White, Color(0xffaaaaaa), Color(0xffe0e0e0), Color(0xff343434))
    "mono-lite" -> Palette(Color(0xfffafafa), Color(0xffececec), Color(0xff181818), Color(0xff666666), Color(0xff333333), Color(0xffd8d8d8))
    else -> Palette(Color(0xff111a1d), Color(0xff223033), Color(0xfff0f4f4), Color(0xffa2b3b0), Color(0xff55d4c8), Color(0xff293637))
}
private sealed interface Screen {
    data object Groups : Screen; data object Friends : Screen; data object Dms : Screen; data object Settings : Screen
    data class Channels(val id: String, val name: String) : Screen
    data class Thread(val id: String, val title: String, val direct: Boolean) : Screen
    data object Admin : Screen
}
private sealed interface Load { data object Loading : Load; data class Data(val json: Any) : Load; data class Error(val message: String) : Load }
private fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }
private fun JSONObject.text(key: String, fallback: String = ""): String = optString(key, fallback).let { if (it == "null" || it.isBlank()) fallback else it }
internal fun preview(conversation: JSONObject): String {
    if (conversation.optBoolean("secure")) return "Защищённая переписка"
    val text = conversation.optJSONObject("lastMessage")?.text("content").orEmpty()
    return if (text.startsWith("e2ee:")) "Зашифрованное сообщение" else text.ifBlank { "Нет текстового сообщения" }
}
private fun screenPath(s: Screen): String? = when (s) {
    Screen.Groups -> "/api/groups"
    Screen.Friends -> "/api/friends"
    Screen.Dms -> "/api/dm"
    Screen.Admin -> "/api/admin/system-stats"
    is Screen.Channels -> "/api/groups/${Uri.encode(s.id)}"
    is Screen.Thread -> null
    Screen.Settings -> null
}

@Composable private fun NativePreview(initialTheme: String, saveTheme: (String) -> Unit) {
    var sessionGeneration by remember { mutableIntStateOf(0) }
    val api = remember(sessionGeneration) { NativeApi() }
    DisposableEffect(api) { onDispose { api.close() } }
    val scope = rememberCoroutineScope()
    var theme by remember { mutableStateOf(initialTheme) }
    val p = palette(theme)
    var user by remember { mutableStateOf<JSONObject?>(null) }
    var screen by remember { mutableStateOf<Screen>(Screen.Groups) }
    var priorGroup by remember { mutableStateOf<Screen.Channels?>(null) }
    var refresh by remember { mutableIntStateOf(0) }
    var load by remember { mutableStateOf<Load>(Load.Loading) }
    var toast by remember { mutableStateOf<String?>(null) }
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var signingIn by remember { mutableStateOf(false) }
    fun logout() {
        api.close(); user = null; screen = Screen.Groups; priorGroup = null
        username = ""; password = ""; toast = null; load = Load.Loading
        sessionGeneration++
    }
    fun back() { screen = when (screen) { is Screen.Thread -> priorGroup ?: Screen.Dms; is Screen.Channels, Screen.Admin -> Screen.Groups; else -> Screen.Groups } }
    BackHandler(user != null && screen !is Screen.Groups) { back() }
    LaunchedEffect(user) {
        val u = user ?: return@LaunchedEffect
        if (theme.startsWith("mono") && !u.optBoolean("isPremium") && u.text("role") != "ADMIN") { theme = "dark"; saveTheme(theme) }
    }
    LaunchedEffect(screen, refresh, user) {
        if (user == null) return@LaunchedEffect
        val path = screenPath(screen) ?: return@LaunchedEffect
        load = Load.Loading
        load = try {
            val text = api.get(path)
            val data: Any = if (text.trimStart().startsWith("[")) JSONArray(text) else JSONObject(text)
            val valid = when (screen) {
                Screen.Groups, Screen.Dms -> data is JSONArray
                Screen.Friends -> data is JSONObject && data.optJSONArray("friends") != null
                Screen.Admin -> data is JSONObject && data.optJSONObject("counts") != null
                is Screen.Channels -> data is JSONObject && data.optJSONArray("channels") != null
                is Screen.Thread -> data is JSONObject && data.optJSONArray("messages") != null
                else -> true
            }
            if (!valid) throw IllegalStateException("Сервер вернул неожиданный формат данных")
            Load.Data(data)
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) {
            if (e is NativeApiException && e.status == 401) logout()
            Load.Error(e.message ?: "Не удалось связаться с сервером")
        }
    }
    val colors = if (p.bg.luminance() < 0.5f) darkColorScheme(
        primary = p.accent, onPrimary = p.bg, background = p.bg, onBackground = p.text,
        surface = p.surface, onSurface = p.text, onSurfaceVariant = p.muted, outline = p.muted,
    ) else lightColorScheme(
        primary = p.accent, onPrimary = p.bg, background = p.bg, onBackground = p.text,
        surface = p.surface, onSurface = p.text, onSurfaceVariant = p.muted, outline = p.muted,
    )
    MaterialTheme(colorScheme = colors) {
        Surface(color = p.bg, modifier = Modifier.fillMaxSize()) {
            if (user == null) {
                Column(Modifier.fillMaxSize().statusBarsPadding().imePadding().padding(24.dp), verticalArrangement = Arrangement.Center) {
                    Text("Нативный Connect", color = p.text, fontSize = 26.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(8.dp))
                    Text("Тестовая сборка: вход действует до закрытия процесса. Данные действующего приложения не изменяются.", color = p.muted, fontSize = 14.sp)
                    Spacer(Modifier.height(18.dp))
                    OutlinedTextField(username, { username = it }, label = { Text("Email или имя пользователя") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(password, { password = it }, label = { Text("Пароль") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
                    Spacer(Modifier.height(14.dp))
                    Button(enabled = !signingIn && username.isNotBlank() && password.isNotEmpty(), onClick = {
                        signingIn = true; toast = null
                        scope.launch {
                            try { user = api.signIn(username.trim(), password); password = ""; screen = Screen.Groups }
                            catch (e: CancellationException) { throw e }
                            catch (e: Exception) { toast = e.message ?: "Ошибка входа"; password = "" }
                            finally { signingIn = false }
                        }
                    }) { Text(if (signingIn) "Вход…" else "Войти") }
                    toast?.let { Text(it, color = Color(0xffff8b87), modifier = Modifier.padding(top = 12.dp)) }
                    Text("Сервер: ${BuildConfig.APP_URL}", color = p.muted, fontSize = 12.sp)
                    Text("Вход через TZ ID и регистрация ещё не перенесены.", color = p.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 12.dp))
                }
            } else {
                Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
                    Column(Modifier.weight(1f).fillMaxWidth()) {
                        Row(Modifier.fillMaxWidth().heightIn(min = 58.dp).padding(horizontal = 18.dp), verticalAlignment = Alignment.CenterVertically) {
                            val title = when (val s = screen) { Screen.Groups -> ""; Screen.Friends -> "Друзья"; Screen.Dms -> "Сообщения"; Screen.Settings -> "Настройки"; is Screen.Channels -> s.name; is Screen.Thread -> s.title; Screen.Admin -> "Администрирование" }
                            if (screen is Screen.Channels || screen is Screen.Thread || screen is Screen.Admin) Text("‹", color = p.accent, fontSize = 30.sp, modifier = Modifier.clickable { back() }.padding(end = 12.dp))
                            Text(title, color = p.text, fontSize = 21.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                            if (screen != Screen.Settings && screen !is Screen.Thread) Text("Обновить", color = p.accent, fontSize = 13.sp, modifier = Modifier.clickable { refresh++ }.padding(8.dp))
                        }
                        Text("ТЕСТОВАЯ НАТИВНАЯ ВЕРСИЯ · НЕ ПОЛНЫЙ ПЕРЕНОС", color = p.muted, fontSize = 10.sp, modifier = Modifier.padding(horizontal = 18.dp, vertical = 4.dp))
                        if (screen is Screen.Settings) {
                            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = 18.dp, vertical = 6.dp)) {
                                item { NativeRow(user?.text("name", "Профиль") ?: "Профиль", "Аккаунт", p) {} }
                                item { Section("Тема оформления", p) }
                                items(listOf("dark" to "Тёмная", "light" to "Светлая", "warm" to "Светлая · тёплая", "mono" to "Монохромная", "mono-lite" to "Монохромная · светлая")) { (key, label) ->
                                    NativeRow(label, if (theme == key) "Выбрана" else if (key.startsWith("mono") && user?.optBoolean("isPremium") != true && user?.text("role") != "ADMIN") "Требуется Premium" else "", p) {
                                        if (key.startsWith("mono") && user?.optBoolean("isPremium") != true && user?.text("role") != "ADMIN") toast = "Монохромные темы доступны с Premium"
                                        else { theme = key; saveTheme(key) }
                                    }
                                }
                                item { Section("Приложение", p) }
                                item { NativeRow("Выйти из тестовой сессии", "Локальный выход; старая WebView-сессия не изменяется", p) { logout() } }
                                item { NativeRow("VPN", "Нативный экран ещё не подключён", p) { toast = "VPN пока не перенесён в тестовую нативную сборку" } }
                                if (user?.text("role") == "ADMIN") item { NativeRow("Админка", "Обзор статистики", p) { screen = Screen.Admin } }
                                item { Text("Дополнительные настройки, темы сообществ и оформление чата ещё не перенесены.", color = p.muted, fontSize = 13.sp, modifier = Modifier.padding(vertical = 16.dp)) }
                            }
                        } else if (screen is Screen.Thread) {
                            val thread = screen as Screen.Thread
                            key(thread.id, thread.direct, sessionGeneration) {
                                NativeThread(api, thread.id, thread.direct,
                                    user?.optBoolean("isPremium") == true || user?.text("role") == "ADMIN", p) { logout() }
                            }
                        } else when (val state = load) {
                            Load.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = p.accent) }
                            is Load.Error -> Column(Modifier.padding(24.dp)) { Text("Не удалось загрузить данные", color = p.text, fontWeight = FontWeight.Bold); Text(state.message, color = p.muted, modifier = Modifier.padding(vertical = 12.dp)); Button(onClick = { refresh++ }) { Text("Повторить") } }
                            is Load.Data -> Content(screen, state.json, p, { next ->
                                if (next is Screen.Thread) priorGroup = if (screen is Screen.Channels) screen as Screen.Channels else null
                                screen = next
                            }) { toast = it }
                        }
                    }
                    toast?.let { message -> Row(Modifier.fillMaxWidth().background(p.surface).clickable { toast = null }.padding(12.dp)) { Text(message, color = p.text, fontSize = 12.sp) } }
                    if (screen is Screen.Groups || screen is Screen.Friends || screen is Screen.Dms || screen is Screen.Settings) {
                        Row(Modifier.fillMaxWidth().heightIn(min = 62.dp).background(p.bg), horizontalArrangement = Arrangement.SpaceEvenly) {
                            listOf(Screen.Groups to "Сообщества", Screen.Friends to "Друзья", Screen.Dms to "Сообщения", Screen.Settings to "Профиль").forEach { (target, label) ->
                                Column(Modifier.weight(1f).clickable { screen = target; toast = null }.padding(vertical = 12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                                    Text(label, color = if (screen == target) p.accent else p.muted, fontSize = 10.sp)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
@Composable private fun Section(title: String, p: Palette) { Text(title.uppercase(), color = p.muted, fontSize = 11.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 16.dp, bottom = 6.dp)) }
@Composable private fun NativeRow(title: String, subtitle: String, p: Palette, onClick: () -> Unit) {
    Column(Modifier.fillMaxWidth().clickable(onClick = onClick)) {
        Row(Modifier.fillMaxWidth().heightIn(min = 68.dp).padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(40.dp).background(p.surface, CircleShape), contentAlignment = Alignment.Center) { Text(title.take(1).uppercase(), color = p.accent, fontWeight = FontWeight.Bold) }
            Column(Modifier.weight(1f).padding(start = 12.dp)) { Text(title, color = p.text, fontSize = 14.sp, fontWeight = FontWeight.SemiBold); if (subtitle.isNotBlank()) Text(subtitle, color = p.muted, fontSize = 12.sp, maxLines = 2) }
            Text("›", color = p.muted, fontSize = 20.sp)
        }
        HorizontalDivider(color = p.line)
    }
}
@Composable private fun Content(screen: Screen, json: Any, p: Palette, navigate: (Screen) -> Unit, note: (String) -> Unit) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = 18.dp, vertical = 4.dp)) {
        when (screen) {
            Screen.Groups -> {
                val rows = (json as? JSONArray)?.objects().orEmpty()
                item { Section("Ваши пространства", p) }
                if (rows.isEmpty()) item { Text("Список пуст. Сервер также может вернуть пустой список при ошибке — повторите позже.", color = p.muted, fontSize = 13.sp) }
                items(rows) { g -> val c = g.optJSONObject("_count"); NativeRow(g.text("name", "Сообщество"), "${c?.optInt("members") ?: 0} участников · ${c?.optInt("channels") ?: 0} каналов", p) { navigate(Screen.Channels(g.text("id"), g.text("name", "Сообщество"))) } }
                item { Section("Действия", p); NativeRow("Создать или присоединиться", "Пока не перенесено", p) { note("Создание и присоединение ещё не перенесены") } }
            }
            Screen.Friends -> {
                val data = json as? JSONObject; val rows = data?.optJSONArray("friends")?.objects().orEmpty(); val pending = data?.optJSONArray("pending")?.length() ?: 0
                item { Section("Друзья · ${rows.size}    Запросы · $pending", p) }
                if (rows.isEmpty()) item { Text("Друзей пока нет", color = p.muted) }
                items(rows) { f -> NativeRow(f.text("name", f.text("username", "Пользователь")), "@${f.text("username")}", p) { note("Профиль друга и быстрый переход в чат ещё не перенесены") } }
                item { Text("Поиск, заявки и добавление друзей ещё не перенесены.", color = p.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 18.dp)) }
            }
            Screen.Dms -> {
                val rows = (json as? JSONArray)?.objects().orEmpty()
                item { Section("Личные диалоги", p) }
                if (rows.isEmpty()) item { Text("Список пуст. При неполадке сервер также может вернуть пустой список.", color = p.muted, fontSize = 13.sp) }
                items(rows) { d -> val other = d.optJSONObject("other"); NativeRow(other?.text("name", "Пользователь") ?: "Пользователь", preview(d), p) {
                    if (d.optBoolean("secure")) note("Защищённая переписка пока не перенесена; ключи и данные исходного приложения не изменяются")
                    else navigate(Screen.Thread(d.text("id"), other?.text("name", "Переписка") ?: "Переписка", true))
                } }
                item { Text("Папки, сейф, поиск и создание переписок ещё не перенесены.", color = p.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 18.dp)) }
            }
            is Screen.Channels -> {
                val obj = json as? JSONObject; val rows = obj?.optJSONArray("channels")?.objects().orEmpty()
                item { Section("Каналы", p) }
                if (obj?.optBoolean("requireRules") == true && obj.optBoolean("rulesAccepted") != true) item { Text("Для работы с сообществом может потребоваться принять правила в существующей версии.", color = p.muted) }
                items(rows) { c -> val type = c.text("type", "TEXT"); NativeRow(c.text("name", "Канал"), if (type == "VOICE") "Голосовой канал · ещё не перенесён" else "Канал · $type", p) {
                    if (type == "TEXT" || type == "NEWS") navigate(Screen.Thread(c.text("id"), c.text("name", "Чат"), false))
                    else note("Этот тип канала пока не перенесён")
                } }
                item { Text("Настройки, дополнительные разделы и оформление сообщества ещё не перенесены.", color = p.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 18.dp)) }
            }
            is Screen.Thread -> Unit
            Screen.Admin -> {
                val obj = json as? JSONObject; val counts = obj?.optJSONObject("counts")
                item { Text("Только обзор. Остальные функции админки ещё не перенесены.", color = p.muted, fontSize = 13.sp, modifier = Modifier.padding(vertical = 8.dp)) }
                listOf("users" to "Пользователи", "groups" to "Сообщества", "channels" to "Каналы", "articles" to "Статьи", "services" to "Услуги", "serverNodes" to "Серверы").forEach { (key, label) ->
                    item { NativeRow(label, if (counts == null || counts.isNull(key)) "Недоступно" else counts.optInt(key).toString(), p) { note("Управление этим разделом пока не перенесено") } }
                }
                if (obj?.optBoolean("partial") == true) item { Text("Часть показателей недоступна на сервере", color = p.muted, fontSize = 12.sp) }
            }
            Screen.Settings -> Unit
        }
    }
}
