package ru.trioz.connect.nativeui

import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.FormBody
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okio.BufferedSink
import okhttp3.Response
import org.json.JSONObject
import ru.trioz.connect.BuildConfig
import java.io.IOException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

// OkHttp may follow a 503 + Retry-After: 0 even with connection retry disabled.
// Mark writes one-shot so no HTTP follow-up can silently repeat a POST.
private fun RequestBody.singleUse(): RequestBody {
    val delegate = this
    return object : RequestBody() {
        override fun contentType() = delegate.contentType()
        override fun contentLength() = delegate.contentLength()
        override fun isOneShot() = true
        override fun writeTo(sink: BufferedSink) = delegate.writeTo(sink)
    }
}

internal class NativeApiException(val status: Int, message: String) : IOException(message)

/** Debug-only session. Never reads, writes or clears legacy WebView storage. */
internal class NativeApi(
    originUrl: String = BuildConfig.APP_URL,
    configure: OkHttpClient.Builder.() -> Unit = {},
) {
    private val origin = originUrl.trimEnd('/').toHttpUrl().also {
        require(it.isHttps && it.username.isEmpty() && it.password.isEmpty())
        require(it.encodedPath == "/" && it.query == null && it.fragment == null)
    }
    private val closed = AtomicBoolean(false)
    private fun sameOrigin(url: HttpUrl) = url.scheme == origin.scheme && url.host == origin.host && url.port == origin.port
    private val cookies = object : CookieJar {
        private val values = mutableListOf<Cookie>()
        @Synchronized override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
            if (closed.get() || !sameOrigin(url)) return
            val now = System.currentTimeMillis()
            for (cookie in cookies) {
                values.removeAll { it.name == cookie.name && it.domain == cookie.domain && it.path == cookie.path }
                if (cookie.expiresAt > now && cookie.matches(url)) values.add(cookie)
            }
        }
        @Synchronized override fun loadForRequest(url: HttpUrl): List<Cookie> {
            if (closed.get() || !sameOrigin(url)) return emptyList()
            val now = System.currentTimeMillis()
            values.removeAll { it.expiresAt <= now }
            return values.filter { it.matches(url) }
        }
        @Synchronized fun clear() { values.clear() }
    }
    private val client = OkHttpClient.Builder().apply(configure).cookieJar(cookies)
        .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
        .connectTimeout(15, TimeUnit.SECONDS).readTimeout(25, TimeUnit.SECONDS)
        .callTimeout(40, TimeUnit.SECONDS).build()

    internal fun url(path: String): HttpUrl {
        require(path.startsWith("/api/") && !path.contains('\\'))
        val result = origin.resolve(path) ?: throw IOException("Некорректный адрес")
        require(sameOrigin(result) && result.encodedPath.startsWith("/api/"))
        return result
    }
    private suspend fun execute(request: Request): String = suspendCancellableCoroutine { continuation ->
        check(!closed.get()) { "Тестовая сессия закрыта" }
        val call = client.newCall(request)
        continuation.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                if (continuation.isActive) continuation.resumeWithException(e)
            }
            override fun onResponse(call: Call, response: Response) {
                try {
                    val text = response.use {
                        val body = it.body ?: throw IOException("Сервер вернул пустой ответ")
                        // Bound debug memory consumption, including chunked/unknown-length responses.
                        val source = body.source()
                        source.request(4L * 1024 * 1024 + 1)
                        if (source.buffer.size > 4L * 1024 * 1024) throw IOException("Ответ сервера слишком большой")
                        val value = source.readUtf8()
                        if (!it.isSuccessful) {
                            val error = runCatching { JSONObject(value).optString("error") }.getOrDefault("")
                            throw NativeApiException(it.code, error.takeIf { e -> e.isNotBlank() && e.length < 300 } ?: "Ошибка сервера (${it.code})")
                        }
                        value
                    }
                    if (continuation.isActive) continuation.resume(text)
                } catch (e: Exception) {
                    if (continuation.isActive) continuation.resumeWithException(e)
                }
            }
        })
    }
    suspend fun get(path: String): String = execute(Request.Builder().url(url(path)).header("Accept", "application/json").build())

    /** Only community channels: no plaintext fallback for direct/secure conversations. No automatic retry. */
    suspend fun sendChannelText(channelId: String, text: String): JSONObject {
        require(channelId.isNotBlank() && text.isNotBlank())
        require(!text.trimStart().startsWith("e2ee:")) { "Зашифрованные сообщения здесь не поддерживаются" }
        val payload = JSONObject().put("channelId", channelId).put("content", text)
        return JSONObject(execute(Request.Builder().url(url("/api/messages"))
            .header("Accept", "application/json").header("Origin", origin.toString().trimEnd('/'))
            .post(payload.toString().toRequestBody("application/json; charset=utf-8".toMediaType()).singleUse()).build()))
    }

    suspend fun signIn(identifier: String, password: String): JSONObject {
        val csrf = JSONObject(get("/api/auth/csrf")).getString("csrfToken")
        val form = FormBody.Builder().add("csrfToken", csrf).add("email", identifier)
            .add("password", password).add("json", "true").add("callbackUrl", origin.toString()).build()
        execute(Request.Builder().url(url("/api/auth/callback/credentials")).post(form.singleUse()).build())
        val session = JSONObject(get("/api/auth/session"))
        val user = session.optJSONObject("user") ?: throw IOException("Не удалось войти. Проверьте логин и пароль.")
        if (user.optString("id").isBlank()) throw IOException("Сессия недоступна")
        return user
    }

    /** Call only when discarding this instance. A fresh login uses a fresh client. */
    fun close() {
        closed.set(true)
        client.dispatcher.cancelAll()
        cookies.clear()
        client.connectionPool.evictAll()
    }
}
