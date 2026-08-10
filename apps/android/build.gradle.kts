// Top-level build file. Version numbers live here so the app module stays lean.
plugins {
    id("com.android.application") version "8.6.1" apply false
    id("org.jetbrains.kotlin.android") version "1.9.25" apply false
    /* PUSH: плагин доступов службы доставки. apply false — он применяется в
       модуле приложения и только когда рядом есть файл доступов (см. app/build.gradle.kts):
       иначе сборка APK падала бы у любого, кто уведомления не настраивал. */
    id("com.google.gms.google-services") version "4.4.2" apply false
}
