package ru.trioz.connect.nativeui

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.FormBody
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import ru.trioz.connect.BuildConfig
import java.io.IOException
import java.util.concurrent.TimeUnit

/** A debug-only, memory-only session. It never reads, writes, or clears legacy WebView storage. */
internal class NativeApi {
    private val origin = BuildConfig.APP_URL.trimEnd('/').toHttpUrl().also {
        require(it.isHttps && it.username.isEmpty() && it.password.isEmpty())
    }
    private val cookies = object : CookieJar {
        private val values = mutableListOf<Cookie>()
        @Synchronized override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
            if (url.scheme != origin.scheme || url.host != origin.host || url.port != origin.port) return
            val now = System.currentTimeMillis()
            for (cookie in cookies) {
                values.removeAll { it.name == cookie.name && it.domain == cookie.domain && it.path == cookie.path }
                if (cookie.expiresAt > now && cookie.matches(url)) values.add(cookie)
            }
        }
        @Synchronized override fun loadForRequest(url: HttpUrl): List<Cookie> {
            if (url.scheme != origin.scheme || url.host != origin.host || url.port != origin.port) return emptyList()
            val now = System.currentTimeMillis()
            values.removeAll { it.expiresAt <= now }
            return values.filter { it.matches(url) }
        }
    }
    private val client = OkHttpClient.Builder().cookieJar(cookies).followRedirects(false)
        .followSslRedirects(false).connectTimeout(15, TimeUnit.SECONDS).readTimeout(25, TimeUnit.SECONDS).build()

    private fun url(path: String): HttpUrl {
        require(path.startsWith("/api/") && !path.startsWith("//"))
        val result = origin.resolve(path) ?: throw IOException("Некорректный адрес")
        require(result.isHttps && result.host == origin.host && result.port == origin.port && result.scheme == origin.scheme)
        return result
    }
    private fun execute(request: Request): String = client.newCall(request).execute().use { response ->
        val body = response.body?.string().orEmpty()
        if (!response.isSuccessful) {
            val error = try { JSONObject(body).optString("error") } catch (_: Exception) { "" }
            throw IOException(error.takeIf { it.isNotBlank() && it.length < 300 } ?: "Ошибка сервера (${response.code})")
        }
        body
    }
    suspend fun get(path: String): String = withContext(Dispatchers.IO) {
        execute(Request.Builder().url(url(path)).header("Accept", "application/json").build())
    }
    suspend fun signIn(identifier: String, password: String): JSONObject = withContext(Dispatchers.IO) {
        val csrf = JSONObject(execute(Request.Builder().url(url("/api/auth/csrf")).build())).getString("csrfToken")
        val form = FormBody.Builder().add("csrfToken", csrf).add("email", identifier)
            .add("password", password).add("json", "true").add("callbackUrl", origin.toString()).build()
        execute(Request.Builder().url(url("/api/auth/callback/credentials")).post(form).build())
        val session = JSONObject(execute(Request.Builder().url(url("/api/auth/session")).build()))
        val user = session.optJSONObject("user") ?: throw IOException("Не удалось войти. Проверьте логин и пароль.")
        if (user.optString("id").isBlank()) throw IOException("Сессия недоступна")
        user
    }
}
