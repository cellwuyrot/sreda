package ru.trioz.connect

/** Safe, actionable preflight errors. Never forward profile data or app inventory. */
internal object TrustTunnelStartGuard {
    fun failure(profileValid: Boolean, busy: Boolean, admission: AdmissionResult): String? = when {
        !profileValid -> "Профиль TrustTunnel несовместим с этой версией Android-приложения. Обновите приложение и проверьте настройки сервера."
        busy -> "Сначала отключите другое VPN-соединение и закройте настройки маршрутизации."
        !admission.allowed && admission.version > 0 -> "VPN заблокирован локальной политикой этой сборки: на устройстве есть приложение из её ограниченного списка."
        !admission.allowed -> "Не удалось проверить локальную политику VPN этой сборки. Обновите или пересоберите приложение."
        else -> null
    }
}
