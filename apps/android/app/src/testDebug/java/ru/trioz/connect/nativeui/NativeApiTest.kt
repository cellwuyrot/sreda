package ru.trioz.connect.nativeui

import kotlinx.coroutines.*
import okhttp3.EventListener
import okhttp3.Call
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Local TLS integration only: no accounts, Firebase or production requests. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NativeApiTest {
    private lateinit var server: MockWebServer
    private lateinit var api: NativeApi
    private val canceled = CountDownLatch(1)
    @Before fun setup() {
        val cert = HeldCertificate.Builder().addSubjectAlternativeName("localhost").build()
        val serverTls = HandshakeCertificates.Builder().heldCertificate(cert).build()
        val clientTls = HandshakeCertificates.Builder().addTrustedCertificate(cert.certificate).build()
        server = MockWebServer()
        server.useHttps(serverTls.sslSocketFactory(), false); server.start()
        api = NativeApi(server.url("/").toString()) {
            sslSocketFactory(clientTls.sslSocketFactory(), clientTls.trustManager)
            eventListener(object : EventListener() { override fun canceled(call: Call) { canceled.countDown() } })
        }
    }
    @After fun teardown() { if (::api.isInitialized) api.close(); if (::server.isInitialized) server.shutdown() }
    @Test fun unsafeOriginsRejected() {
        for (origin in listOf("http://localhost", "https://user:pass@localhost", "https://localhost/path", "https://localhost/?q=x")) {
            assertThrows(IllegalArgumentException::class.java) { NativeApi(origin) }
        }
    }
    @Test fun onlyApiPathsOnSameOriginAllowed() {
        for (path in listOf("https://evil.test/api/x", "//evil.test/api/x", "/admin", "/api/../admin", "/api/%2e%2e/admin", "/api/\\evil")) {
            assertThrows(IllegalArgumentException::class.java) { api.url(path) }
        }
        assertEquals("/api/messages", api.url("/api/messages?channelId=x").encodedPath)
    }
    @Test fun redirectsNeverFollowed() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "/api/other").setBody("{}"))
        try { api.get("/api/test"); fail("redirect accepted") } catch (e: NativeApiException) { assertEquals(302, e.status) }
        assertEquals(1, server.requestCount)
    }
    @Test fun unauthorizedPreservesStatus() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":"Unauthorized"}"""))
        try { api.get("/api/test"); fail("401 accepted") } catch (e: NativeApiException) { assertEquals(401, e.status) }
    }
    @Test fun signInUsesCsrfCookieAndMemorySession() = runBlocking {
        server.enqueue(MockResponse().setHeader("Set-Cookie", "csrf=test-cookie; Path=/; Secure; HttpOnly").setBody("""{"csrfToken":"test-csrf"}"""))
        server.enqueue(MockResponse().setHeader("Set-Cookie", "session=test-session; Path=/; Secure; HttpOnly").setBody("{}"))
        server.enqueue(MockResponse().setBody("""{"user":{"id":"test-user"}}"""))
        assertEquals("test-user", api.signIn("test-user", "test-password").getString("id"))
        server.takeRequest()
        val signIn = server.takeRequest()
        assertTrue(signIn.body.readUtf8().contains("csrfToken=test-csrf"))
        assertTrue(signIn.getHeader("Cookie").orEmpty().contains("csrf=test-cookie"))
        assertTrue(server.takeRequest().getHeader("Cookie").orEmpty().contains("session=test-session"))
    }
    @Test fun channelSendContainsOnlyIntendedFields() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"id":"m1","content":"hello"}"""))
        assertEquals("m1", api.sendChannelText("c1", "hello").getString("id"))
        val request = server.takeRequest()
        assertEquals("POST", request.method); assertEquals("/api/messages", request.path)
        val body = JSONObject(request.body.readUtf8())
        assertEquals(2, body.length()); assertEquals("c1", body.getString("channelId")); assertEquals("hello", body.getString("content"))
    }
    @Test fun encryptedOrBlankSendRejectedBeforeNetwork() = runBlocking {
        for (text in listOf(" ", "e2ee:secret")) {
            try { api.sendChannelText("c1", text); fail("invalid send") } catch (_: IllegalArgumentException) { }
        }
        assertEquals(0, server.requestCount)
    }
    @Test fun failedWriteIsNotRetried() = runBlocking {
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST))
        try { api.sendChannelText("c1", "hello"); fail("connection unexpectedly survived") } catch (_: IOException) { }
        assertEquals(1, server.requestCount)
    }
    @Test fun retryAfterCannotRepeatWrite() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(503).setHeader("Retry-After", "0").setBody("{}"))
        server.enqueue(MockResponse().setBody("""{"id":"duplicate"}"""))
        try { api.sendChannelText("c1", "hello"); fail("503 accepted") } catch (e: NativeApiException) { assertEquals(503, e.status) }
        assertEquals(1, server.requestCount)
    }
    @Test fun cancellationCancelsHttpCall() = runBlocking {
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
        val job = launch(Dispatchers.Default) { api.get("/api/wait") }
        assertNotNull(server.takeRequest(5, TimeUnit.SECONDS))
        job.cancelAndJoin()
        assertTrue(canceled.await(5, TimeUnit.SECONDS))
    }
    @Test fun closedSessionCannotBeReused() = runBlocking {
        api.close()
        try { api.get("/api/test"); fail("closed client reused") } catch (_: IllegalStateException) { }
        assertEquals(0, server.requestCount)
    }
    @Test fun oversizedResponseRejected() = runBlocking {
        server.enqueue(MockResponse().setBody("x".repeat(4 * 1024 * 1024 + 1)))
        try { api.get("/api/test"); fail("oversized body accepted") } catch (e: IOException) { assertTrue(e.message.orEmpty().contains("слишком большой")) }
    }
}
