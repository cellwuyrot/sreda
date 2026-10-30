package ru.trioz.connect

import android.content.Context
import android.content.pm.PackageManager
import org.json.JSONObject

data class AdmissionResult(val allowed: Boolean, val message: String, val version: Int = 0)

/** Only exact, declared package IDs, in this Android user/profile. Never upload inventory. */
object VpnAdmissionPolicy {
    private val packageId = Regex("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+")
    fun evaluate(raw: String, installed: (String) -> Boolean): AdmissionResult = try {
        val policy = JSONObject(raw)
        val version = policy.getInt("version")
        require(version > 0)
        val enabled = policy.getBoolean("enabled")
        val packages = policy.getJSONArray("packages")
        require(packages.length() <= 200)
        val seen = mutableSetOf<String>()
        val entries = (0 until packages.length()).map { i ->
            val entry = packages.getJSONObject(i)
            val id = entry.getString("package")
            val label = entry.getString("label")
            require(packageId.matches(id) && seen.add(id) && label.isNotBlank())
            id to label
        }
        if (!enabled) AdmissionResult(true, "Политика допуска отключена", version)
        else {
            val found = entries.filter { installed(it.first) }.map { it.second }
            if (found.isEmpty()) AdmissionResult(true, "Проверка допуска пройдена", version)
            else AdmissionResult(false, "VPN недоступен по политике этой сборки. Обнаружены: " + found.joinToString(", ") +
                ". Проверка локальная; наличие приложения не доказывает перехват трафика.", version)
        }
    } catch (_: Exception) { AdmissionResult(false, "Не удалось проверить политику допуска. VPN не запущен.") }

    fun check(context: Context): AdmissionResult = try {
        val raw = context.assets.open("vpn-admission-policy.json").bufferedReader().use { it.readText() }
        evaluate(raw) { id ->
            try {
                @Suppress("DEPRECATION")
                context.packageManager.getPackageInfo(id, 0)
                true
            } catch (_: PackageManager.NameNotFoundException) { false }
        }
    } catch (_: Exception) { AdmissionResult(false, "Политика допуска недоступна. Обновите приложение.") }
}
