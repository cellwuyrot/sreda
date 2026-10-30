package ru.trioz.connect
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config as RoboConfig

@RunWith(RobolectricTestRunner::class)
@RoboConfig(sdk = [34], manifest = RoboConfig.NONE)
class OriginPolicyTest {
    @Test fun ownHttpsOriginAccepted() { assertTrue(Config.isTrustedOrigin("https://trioz.ru/connect")) }
    @Test fun suffixHostRejected() { assertFalse(Config.isTrustedOrigin("https://trioz.ru.evil.example/connect")) }
    @Test fun credentialsRejected() { assertFalse(Config.isTrustedOrigin("https://user@trioz.ru")) }
    @Test fun differentPortRejected() { assertFalse(Config.isTrustedOrigin("https://trioz.ru:444")) }
    @Test fun httpRejected() { assertFalse(Config.isTrustedOrigin("http://trioz.ru")); assertTrue(Config.isExternal("http://trioz.ru:443")) }
    @Test fun defaultPortAccepted() { assertTrue(Config.isTrustedOrigin("https://trioz.ru:443")) }
    @Test fun javascriptRejected() { assertFalse(Config.isTrustedOrigin("javascript:alert(1)")) }
}
