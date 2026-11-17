package ru.trioz.connect

import org.junit.Assert.*
import org.junit.Test

class TrustTunnelStartGuardTest {
    private val allowed = AdmissionResult(true, "ok", 1)
    @Test fun allowedRequestHasNoFailure() { assertNull(TrustTunnelStartGuard.failure(true, false, allowed)) }
    @Test fun invalidProfileFailsWithoutEchoingSecrets() {
        val result = TrustTunnelStartGuard.failure(false, false, allowed)!!
        assertTrue(result.contains("Профиль")); assertFalse(result.contains("password"))
    }
    @Test fun busyConnectionIsExplained() { assertTrue(TrustTunnelStartGuard.failure(true, true, allowed)!!.contains("отключите")) }
    @Test fun blockedPolicyIsExplainedWithoutAppInventory() {
        val result = TrustTunnelStartGuard.failure(true, false, AdmissionResult(false, "SENSITIVE_APP_NAME", 1))!!
        assertTrue(result.contains("локальной политикой")); assertFalse(result.contains("SENSITIVE_APP_NAME"))
    }
    @Test fun unreadablePolicyHasSeparateMessage() {
        assertTrue(TrustTunnelStartGuard.failure(true, false, AdmissionResult(false, "error", 0))!!.contains("проверить"))
    }
}
