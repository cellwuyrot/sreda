package ru.trioz.connect
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], manifest = Config.NONE)
class VpnAdmissionPolicyTest {
    private fun policy(enabled: Boolean = true, packages: String = """{"package":"com.example.blocked","label":"Пример"}""") =
        """{"version":1,"enabled":$enabled,"packages":[$packages]}"""
    @Test fun allowsWhenNoListedPackageInstalled() { assertTrue(VpnAdmissionPolicy.evaluate(policy()) { false }.allowed) }
    @Test fun deniesListedPackage() {
        val result = VpnAdmissionPolicy.evaluate(policy()) { it == "com.example.blocked" }
        assertFalse(result.allowed); assertTrue(result.message.contains("Пример"))
    }
    @Test fun disabledPolicyDoesNotInspectInventory() { assertTrue(VpnAdmissionPolicy.evaluate(policy(false)) { error("must not query") }.allowed) }
    @Test fun unknownInventoryFailsClosed() { assertFalse(VpnAdmissionPolicy.evaluate(policy()) { throw SecurityException() }.allowed) }
    @Test fun brokenJsonFailsClosed() { assertFalse(VpnAdmissionPolicy.evaluate("{") { false }.allowed) }
    @Test fun wildcardNotAccepted() { assertFalse(VpnAdmissionPolicy.evaluate(policy(packages = """{"package":"com.yandex.*","label":"x"}""")) { false }.allowed) }
    @Test fun duplicatesNotAccepted() {
        val row = """{"package":"com.example.blocked","label":"x"}"""
        assertFalse(VpnAdmissionPolicy.evaluate(policy(packages="$row,$row")) { false }.allowed)
    }
    @Test fun exactPackageOnly() {
        val queried = mutableListOf<String>()
        assertTrue(VpnAdmissionPolicy.evaluate(policy()) { queried.add(it); false }.allowed)
        assertEquals(listOf("com.example.blocked"), queried)
    }
    @Test fun emptyPolicyAllows() { assertTrue(VpnAdmissionPolicy.evaluate(policy(packages="")) { false }.allowed) }
    @Test fun preservesVersionForConsent() { assertEquals(1, VpnAdmissionPolicy.evaluate(policy()) { false }.version) }
}
