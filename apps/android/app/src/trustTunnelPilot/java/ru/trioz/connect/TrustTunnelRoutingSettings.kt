package ru.trioz.connect

import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.net.VpnService
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

/** Device-local settings. Installed apps and selection never cross the web bridge. */
internal object TrustTunnelRoutingSettings {
    private const val PREFS = "trusttunnel_routing"
    private const val MODE = "mode"
    private const val APPS = "apps"
    private const val ALL = "all"
    private const val EXCLUDE = "exclude"
    private const val ONLY = "only"

    fun apply(context: Context, builder: VpnService.Builder) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val mode = prefs.getString(MODE, ALL)
        val apps = prefs.getStringSet(APPS, emptySet())?.toSet() ?: emptySet()
        when (mode) {
            ALL -> Unit
            EXCLUDE -> { require(apps.isNotEmpty()); apps.forEach { builder.addDisallowedApplication(it) } }
            ONLY -> { require(apps.isNotEmpty()); apps.forEach { builder.addAllowedApplication(it) } }
            else -> error("Invalid TrustTunnel routing mode")
        }
    }

    @Suppress("DEPRECATION")
    fun open(context: Context, canSave: () -> Boolean, finished: () -> Unit) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val storedMode = prefs.getString(MODE, ALL)
        val selected = prefs.getStringSet(APPS, emptySet())?.toSet() ?: emptySet()
        val pm = context.packageManager
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val apps = pm.queryIntentActivities(intent, 0).map { it.activityInfo.packageName }
            .distinct().map { id ->
                val label = try { pm.getApplicationLabel(pm.getApplicationInfo(id, 0)).toString() } catch (_: Exception) { id }
                id to label
            }.sortedBy { it.second.lowercase() }
        val layout = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (20 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad / 2, pad, 0)
        }
        val radio = RadioGroup(context)
        val modes = listOf(ALL to "Все приложения через VPN", EXCLUDE to "Чёрный список: выбранные напрямую", ONLY to "Белый список: только выбранные через VPN")
        modes.forEachIndexed { index, pair -> radio.addView(RadioButton(context).apply { id = index + 1; text = pair.second }) }
        radio.check(modes.indexOfFirst { it.first == storedMode }.let { if (it < 0) 1 else it + 1 })
        layout.addView(radio)
        layout.addView(TextView(context).apply { text = "Выберите приложения. При белом списке все остальные работают напрямую. Список ограничен видимыми запускаемыми приложениями. Системная блокировка соединений без VPN может помешать исключениям." })
        val checks = apps.map { (id, label) -> id to CheckBox(context).apply { text = "$label ($id)"; isChecked = id in selected; layout.addView(this) } }
        val missing = selected - apps.map { it.first }.toSet()
        if (missing.isNotEmpty()) layout.addView(TextView(context).apply { text = "Некоторые ранее выбранные приложения больше не видны. Проверьте выбор и сохраните настройки заново." })
        val scroll = ScrollView(context).apply { addView(layout) }
        val dialog = AlertDialog.Builder(context).setTitle("Маршрутизация TrustTunnel")
            .setView(scroll).setPositiveButton("Продолжить", null).setNegativeButton("Отмена", null).create()
        var confirming = false
        dialog.setOnDismissListener { if (!confirming) finished() }
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val mode = modes.getOrNull(radio.checkedRadioButtonId - 1)?.first ?: return@setOnClickListener
                val chosen = checks.filter { it.second.isChecked }.map { it.first }.toSet()
                if (mode != ALL && chosen.isEmpty()) {
                    Toast.makeText(context, "Выберите хотя бы одно приложение", Toast.LENGTH_LONG).show()
                    return@setOnClickListener
                }
                if (!canSave()) {
                    Toast.makeText(context, "Сначала отключите TrustTunnel", Toast.LENGTH_LONG).show()
                    return@setOnClickListener
                }
                val warning = when (mode) {
                    EXCLUDE -> "Выбранные приложения будут использовать обычный интернет без VPN. Сохранить?"
                    ONLY -> "Все приложения, кроме выбранных, будут использовать обычный интернет без VPN. Сохранить?"
                    else -> "Все приложения будут направляться через VPN. Сохранить?"
                }
                confirming = true
                val confirm = AlertDialog.Builder(context).setTitle("Подтвердите маршрутизацию").setMessage(warning)
                    .setPositiveButton("Сохранить") { _, _ ->
                        if (!canSave()) Toast.makeText(context, "Сначала отключите TrustTunnel", Toast.LENGTH_LONG).show()
                        else if (!prefs.edit().putString(MODE, mode).putStringSet(APPS, if (mode == ALL) emptySet() else chosen).commit())
                            Toast.makeText(context, "Не удалось сохранить настройки", Toast.LENGTH_LONG).show()
                        else Toast.makeText(context, "Сохранено. Применится при подключении TrustTunnel", Toast.LENGTH_LONG).show()
                    }.setNegativeButton("Отмена", null).create()
                confirm.setOnDismissListener { finished() }
                dialog.dismiss()
                confirm.show()
            }
        }
        dialog.show()
    }
}
