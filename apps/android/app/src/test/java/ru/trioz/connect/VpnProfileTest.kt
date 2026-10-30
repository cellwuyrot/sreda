package ru.trioz.connect
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.amnezia.awg.crypto.KeyPair

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], manifest = Config.NONE)
class VpnProfileTest {
    private val privateKey = KeyPair().privateKey.toBase64()
    private val publicKey = KeyPair().publicKey.toBase64()
    private fun profile(extra: String = "") = """
        [Interface]
        PrivateKey = AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
        Address = 10.8.0.2/32
        DNS = 1.1.1.1
        $extra
        [Peer]
        PublicKey = $publicKey
        AllowedIPs = 0.0.0.0/0, ::/0
        Endpoint = 192.0.2.1:51820
        PersistentKeepalive = 25
    """.trimIndent()
    @Test fun nativeKeyReplacesPlaceholder() {
        val config = VpnProfile.withNativeKey(profile(), privateKey)
        assertEquals(privateKey, config.`interface`.keyPair.privateKey.toBase64())
        assertEquals(1, config.peers.size)
    }
    @Test fun preservesAmneziaParameters() {
        val config = VpnProfile.withNativeKey(profile("""
            Jc = 4
            Jmin = 40
            Jmax = 70
            S1 = 0
            S2 = 0
            S3 = 0
            S4 = 0
            H1 = 123456
            H2 = 234567
            H3 = 345678
            H4 = 456789
        """.trimIndent()), privateKey)
        assertEquals(4, config.`interface`.junkPacketCount.get().toInt())
        assertEquals("123456", config.`interface`.initPacketMagicHeader.get())
        val userspace = config.`interface`.toAwgUserspaceString()
        assertTrue(userspace.contains("jc=4"))
        assertTrue(userspace.contains("h1=123456"))
    }
    @Test fun refusesShellHook() { assertThrows(IllegalArgumentException::class.java) { VpnProfile.withNativeKey(profile("PostUp = command"), privateKey) } }
    @Test fun refusesPerAppBypass() { assertThrows(IllegalArgumentException::class.java) { VpnProfile.withNativeKey(profile("ExcludedApplications = ru.oneme.app"), privateKey) } }
    @Test fun refusesTwoPrivateKeys() { assertThrows(IllegalArgumentException::class.java) { VpnProfile.withNativeKey(profile("PrivateKey = $privateKey"), privateKey) } }
    @Test fun refusesOversizedInput() { assertThrows(IllegalArgumentException::class.java) { VpnProfile.withNativeKey("a".repeat(40000), privateKey) } }
    @Test fun refusesMissingEndpoint() { assertThrows(IllegalArgumentException::class.java) { VpnProfile.withNativeKey(profile().replace("Endpoint = 192.0.2.1:51820", ""), privateKey) } }
}
