package ru.trioz.connect

import org.junit.Assert.*
import org.junit.Test

class TrustTunnelPilotProfileTest {
    private fun profile() = listOf(
        "loglevel = \"info\"", "vpn_mode = \"general\"", "killswitch_enabled = true", "",
        "[endpoint]", "hostname = \"turn.trioz.ru\"", "addresses = [\"170.168.18.20:8443\"]",
        "username = \"trioz_${"a".repeat(32)}\"", "password = \"${"A".repeat(43)}\"",
        "skip_verification = false", "upstream_protocol = \"http2\"", "", "[listener.tun]",
        "included_routes = [\"0.0.0.0/0\", \"2000::/3\"]",
        "excluded_routes = [\"10.0.0.0/8\", \"172.16.0.0/12\", \"192.168.0.0/16\"]",
        "mtu_size = 1350", ""
    ).joinToString("\n")
    @Test fun validCanonicalConfig() = assertTrue(TrustTunnelPilotProfile.accepts(profile()))
    @Test fun badTlsAndAlteredEndpointFailClosed() {
        for (bad in listOf(profile().replace("skip_verification = false", "skip_verification = true"),
            profile().replace("turn.trioz.ru", "other.example"),
            profile().replace("170.168.18.20", "192.0.2.1"),
            profile().replace("http2", "http3"), profile() + "x=1\n",
            profile().replace("A".repeat(43), "\"\nloglevel = \"trace"))) {
            assertFalse(TrustTunnelPilotProfile.accepts(bad))
        }
    }
}
