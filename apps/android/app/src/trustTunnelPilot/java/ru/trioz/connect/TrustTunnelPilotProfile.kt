package ru.trioz.connect

/** Restrict the privileged pilot adapter to the exact server-generated format.
 * This does not authenticate the caller; server-side ADMIN authorization and a
 * trusted WebView origin are still mandatory. Avoid printing the config.
 * The gateway is deliberately pinned for this experimental deployment.
 */
internal object TrustTunnelPilotProfile {
    private val user = Regex("username = \"trioz_[a-f0-9]{32}\"")
    private val password = Regex("password = \"[A-Za-z0-9_-]{43}\"")
    private val fixed = listOf(
        "loglevel = \"info\"",
        "vpn_mode = \"general\"",
        "killswitch_enabled = true",
        "",
        "[endpoint]",
        "hostname = \"turn.trioz.ru\"",
        "addresses = [\"170.168.18.20:8443\"]",
        null, null,
        "skip_verification = false",
        "upstream_protocol = \"http2\"",
        "",
        "[listener.tun]",
        "included_routes = [\"0.0.0.0/0\", \"2000::/3\"]",
        "excluded_routes = [\"10.0.0.0/8\", \"172.16.0.0/12\", \"192.168.0.0/16\"]",
        "mtu_size = 1350",
        ""
    )
    fun accepts(config: String): Boolean {
        if (config.length > 4096 || config.contains('\r')) return false
        val lines = config.split('\n')
        if (lines.size != fixed.size) return false
        return lines.indices.all { i ->
            when (i) {
                7 -> user.matches(lines[i])
                8 -> password.matches(lines[i])
                else -> lines[i] == fixed[i]
            }
        }
    }
}
