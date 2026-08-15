package ru.trioz.connect

import android.net.Uri

/**
 * Навигационная политика оболочки Connect.
 *
 * Приложение — выделенный клиент мессенджера TZ.Connect: оно открывается сразу
 * в раздел `/connect` и никогда не показывает остальной сайт. Политика
 * построена на БЕЛОМ СПИСКЕ (allowlist): внутри WebView остаются только пути,
 * перечисленные в [allowedPrefixes]; любой другой same-origin путь немедленно
 * возвращает пользователя в `/connect`; чужой origin (и не-http схемы)
 * открывается в системном браузере.
 *
 * Раньше здесь был чёрный список (`/projects`, `/pero`, `/library`), но сайт
 * содержит гораздо больше разделов (`/settings`, `/user/...`, `/games`,
 * `/about`, `/admin`, ...), и каждый новый раздел приходилось бы дописывать.
 * Белый список закрывает проблему по построению.
 *
 * Список ДОЛЖЕН совпадать с веб-стороной:
 * `apps/web/src/lib/shell.ts` (SHELL_ALLOWED_PREFIXES) — там та же политика
 * применяется к клиентским SPA-переходам ещё до нативного слоя.
 */
object Config {
    /** Адрес веб-фронтенда, зашивается на этапе сборки. */
    val appUrl: String = BuildConfig.APP_URL.trimEnd('/')

    /** Единственный раздел, ради которого существует клиент. */
    val startPath: String = BuildConfig.START_PATH

    /** Полный URL, который оболочка открывает при запуске, например https://connect.trioz.ru/connect */
    val startUrl: String get() = appUrl + startPath

    /**
     * Разделы, разрешённые внутри оболочки:
     *  - /connect   — сам мессенджер (включая /connect/services);
     *  - /auth      — вход/регистрация (без них в мессенджер не попасть);
     *  - /invite    — приём приглашения в сообщество — часть флоу мессенджера;
     *  - /uploads   — файлы-вложения (открытие/скачивание);
     *  - /api       — redirect-цепочки NextAuth и отдача файлов;
     *  - /settings  — свой профиль и центр уведомлений;
     *  - /workspace — своя рабочая среда;
     *  - /partner   — личный кабинет партнёра;
     *  - /editor    — редакторская;
     *  - /admin     — панель администратора.
     *
     * Последние пять добавлены потому, что без них в приложении не было ни
     * профиля, ни уведомлений, ни рабочей среды, а у партнёра, редактора и
     * администратора — их разделов: колокольчик на телефоне существовал, но вёл в
     * запрещённый путь, и оболочка возвращала человека в мессенджер.
     *
     * Разделение осталось прежним: собственные разделы ЧЕЛОВЕКА — часть клиента;
     * сайтовые (лендинг, каталог проектов, библиотека, игры, чужие профили) — нет.
     */
    private val allowedPrefixes = listOf(
        "/connect", "/auth", "/invite", "/uploads", "/api",
        "/settings", "/profile", "/workspace", "/partner", "/editor", "/admin",
    )

    /** Разрешён ли этот путь внутри оболочки. */
    fun isAllowedPath(pathname: String?): Boolean {
        val p = (pathname ?: "/").substringBefore('?').substringBefore('#').trimEnd('/')
        val clean = if (p.isEmpty()) "/" else p
        return allowedPrefixes.any { clean == it || clean.startsWith("$it/") }
    }

    /** true, когда [url] ведёт на другой origin (или не-web схему). */
    fun isExternal(url: String): Boolean {
        return try {
            val target = Uri.parse(url)
            val scheme = target.scheme?.lowercase()
            if (scheme != "http" && scheme != "https") return true
            val base = Uri.parse(appUrl)
            val targetPort = if (target.port != -1) target.port else defaultPort(scheme)
            val basePort = if (base.port != -1) base.port else defaultPort(base.scheme)
            !(target.host.equals(base.host, ignoreCase = true) && targetPort == basePort)
        } catch (_: Exception) {
            false
        }
    }

    /** Same-origin навигация в раздел, которому не место внутри клиента. */
    fun isBlockedInApp(url: String): Boolean {
        return try {
            if (isExternal(url)) false else !isAllowedPath(Uri.parse(url).path)
        } catch (_: Exception) {
            false
        }
    }

    private fun defaultPort(scheme: String?): Int = if (scheme == "http") 80 else 443
}
