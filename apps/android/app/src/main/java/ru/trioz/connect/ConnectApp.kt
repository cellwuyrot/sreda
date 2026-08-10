package ru.trioz.connect

import android.app.Activity
import android.app.Application
import android.os.Bundle
import android.webkit.WebView

class ConnectApp : Application() {

    companion object {
        /**
         * PUSH: видно ли приложение человеку прямо сейчас.
         *
         * Нужно ровно для одного решения: показывать ли уведомление, пришедшее от
         * службы доставки. Когда приложение открыто, уведомление уже показала
         * веб-часть по живому соединению — второе о том же сообщении только
         * раздражает. Признак ведётся здесь, а не в MainActivity, потому что
         * службу доставки будят и при закрытом приложении: активности может не
         * существовать вовсе, а ответ нужен всё равно.
         */
        @Volatile
        var isForeground: Boolean = false
            private set
    }

    override fun onCreate() {
        super.onCreate()
        // Give every WebView instance a chance to attach a debugger in debug
        // builds (chrome://inspect). Never enabled for release users.
        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true)
        }

        /* Считаем не «жива ли активность», а «показана ли она»: свёрнутое
           приложение продолжает существовать в памяти, но уведомление ему нужно. */
        registerActivityLifecycleCallbacks(object : ActivityLifecycleCallbacks {
            private var visible = 0

            override fun onActivityStarted(activity: Activity) {
                visible += 1
                isForeground = true
            }

            override fun onActivityStopped(activity: Activity) {
                visible = (visible - 1).coerceAtLeast(0)
                if (visible == 0) isForeground = false
            }

            override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
            override fun onActivityResumed(activity: Activity) = Unit
            override fun onActivityPaused(activity: Activity) = Unit
            override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
            override fun onActivityDestroyed(activity: Activity) = Unit
        })
    }
}
