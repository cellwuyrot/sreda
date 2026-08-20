import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// ── PUSH: подключение службы доставки уведомлений ───────────────────────────
//
// Плагин применяется ТОЛЬКО если рядом лежит файл доступов google-services.json.
// Причина простая: без него плагин валит сборку, а сборка APK не должна зависеть
// от того, настроил ли кто-то доставку уведомлений. Нет файла — приложение
// собирается как раньше, просто уведомления в закрытом приложении не приходят
// (адрес устройства не выдаётся, и веб-часть его не привязывает).
//
// Как получить файл — см. apps/android/README.md, раздел про уведомления.
val pushConfigFile = rootProject.file("app/google-services.json")
val hasPushConfig = pushConfigFile.exists()
if (hasPushConfig) {
    apply(plugin = "com.google.gms.google-services")
} else {
    logger.lifecycle(
        "PUSH: app/google-services.json не найден — сборка без доставки уведомлений в закрытое приложение",
    )
}

// ── BUILDS: подпись релизной сборки ─────────────────────────────────────────
//
// Неподписанный релизный APK не ставится ни на один телефон — значит сборка на
// сервере без подписи бессмысленна. Раньше этот блок был закомментирован, и
// подписывать приходилось руками на своём ПК; теперь он работает сам, если
// рядом лежит app/keystore.properties (в git его нет и быть не должно).
//
// Файла нет — сборка НЕ падает: релиз просто остаётся неподписанным, а годный к
// установке APK даёт задача assembleDebug. Так на чистой машине без ключей
// проект по-прежнему собирается, и это важно: ключ есть не у каждого, кто
// клонирует репозиторий.
//
// Пути в файле — относительно каталога apps/android. Пример содержимого:
//
//   storeFile=app/trioz-release.jks
//   storePassword=…
//   keyAlias=trioz
//   keyPassword=…
val keystorePropsFile = rootProject.file("app/keystore.properties")
val keystoreProps = Properties().apply {
    if (keystorePropsFile.exists()) keystorePropsFile.inputStream().use { load(it) }
}
val hasReleaseKeystore = keystorePropsFile.exists() && keystoreProps.getProperty("storeFile") != null

// ── Иконка приложения ───────────────────────────────────────────────────────
// Исходник один на весь проект — docs/logostol.png в корне репозитория (тот же
// файл берёт и десктоп-сборка). Раньше иконка была нарисована векторной
// разметкой прямо в ресурсах, и при смене логотипа её пришлось бы перерисовывать
// вручную. Теперь картинка копируется в сгенерированный ресурс перед сборкой:
// второй копии в git нет, расходиться нечему.
//
// Прозрачность сохраняется: под передним слоем остаётся фоновый цвет адаптивной
// иконки, сквозь прозрачные места он и виден.
val launcherIconSource = rootProject.file("../../docs/logostol.png")
val generatedIconRes = layout.buildDirectory.dir("generated/res/launcher")

val syncLauncherIcon = tasks.register<Copy>("syncLauncherIcon") {
    description = "Раскладывает docs/logostol.png в ресурсы иконки приложения"
    doFirst {
        if (!launcherIconSource.exists()) {
            throw GradleException(
                "Не найден ${launcherIconSource.path} — из него собирается иконка приложения",
            )
        }
    }
    from(launcherIconSource) { rename { "ic_launcher_image.png" } }
    // nodpi: картинка одна на все плотности, система масштабирует сама.
    into(generatedIconRes.map { it.dir("drawable-nodpi") })
}

android {
    namespace = "ru.trioz.connect"
    compileSdk = 34

    sourceSets["main"].res.srcDir(generatedIconRes)

    /* FIX-BOOT: служба доставки — отдельный набор исходников app/src/push.

       Почему так: библиотека доставки инициализируется сама при старте процесса,
       до первого экрана, и без файла доступов роняла приложение на запуске.
       Сборка без google-services.json — нормальный случай (файла нет в git),
       поэтому вся доставка целиком включается только вместе с ним: и код, и
       служба в манифесте, и сама библиотека. Остальное приложение о доставке
       не знает ничего: адрес устройства читается через PushTokens. */
    if (hasPushConfig) {
        sourceSets["main"].java.srcDir("src/push/java")

        /* FIX-MANIFEST: манифест доставки подключается к наборам debug и release,
           а НЕ к main.

           Почему: у одного набора исходников манифест ровно один. Прежняя строка
           sourceSets["main"].manifest.srcFile("src/push/AndroidManifest.xml")
           не подмешивала push-манифест, а ЗАМЕНЯЛА им основной. Как только рядом
           появлялся google-services.json, из APK исчезало всё: ConnectApp,
           MainActivity, фильтр MAIN/LAUNCHER и все разрешения. Сборка проходила,
           приложение ставилось пустым — без иконки и без возможности запуска.

           У debug и release манифесты свои и по умолчанию не заданы, поэтому
           здесь замены не происходит: manifest merger сливает push-манифест с
           основным, как и задумано. */
        sourceSets["debug"].manifest.srcFile("src/push/AndroidManifest.xml")
        sourceSets["release"].manifest.srcFile("src/push/AndroidManifest.xml")
    }

    if (hasReleaseKeystore) {
        signingConfigs {
            create("release") {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    defaultConfig {
        applicationId = "ru.trioz.connect"
        minSdk = 26
        targetSdk = 34
        versionCode = 2
        versionName = "0.3.3"

        // The web origin the WebView loads. Override per build type / flavour
        // here without touching the Kotlin source (consumed by Config.kt).
        buildConfigField("String", "APP_URL", "\"https://trioz.ru\"")
        buildConfigField("String", "START_PATH", "\"/connect\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            /* FIX-SIGN: ключа нет — подписываем отладочным ключом, а не отдаём
               неподписанный APK.

               Неподписанный APK Android ставить отказывается: телефон показывает
               «Приложение не установлено» без каких-либо пояснений, и человек
               остаётся с бесполезным файлом. Отладочный ключ генерируется сам, он
               есть на любой машине, поэтому такой APK хотя бы устанавливается и
               его можно проверить.

               Для публикации он не годится (ключ не ваш и одинаков у всех), об
               этом в лог уходит явное предупреждение — см. app/keystore.properties
               в apps/android/README.md. */
            if (hasReleaseKeystore) {
                signingConfig = signingConfigs.getByName("release")
            } else {
                signingConfig = signingConfigs.getByName("debug")
                logger.warn(
                    "BUILDS: app/keystore.properties не найден — релизный APK подписан ОТЛАДОЧНЫМ ключом. " +
                        "Устанавливается, но для публикации НЕ годится: положите keystore.properties и соберите заново.",
                )
            }
        }
        debug {
            // Handy for pointing the debug build at a local dev server:
            // buildConfigField("String", "APP_URL", "\"http://10.0.2.2:3005\"")
            applicationIdSuffix = ".debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        buildConfig = true
        viewBinding = true
    }
}

// Ресурсы собираются до компиляции — иначе сгенерированной иконки ещё нет.
tasks.named("preBuild") { dependsOn(syncLauncherIcon) }

dependencies {
    /* PUSH: доставка уведомлений в закрытое приложение.

       FIX-BOOT: раньше зависимость стояла всегда с пометкой «безвредна без файла
       доступов». Это было неверно: библиотека поднимает себя сама при старте
       процесса, и без своей конфигурации валит приложение ещё до первого
       экрана. Теперь она подключается только вместе с app/google-services.json. */
    if (hasPushConfig) {
        implementation(platform("com.google.firebase:firebase-bom:33.5.1"))
        implementation("com.google.firebase:firebase-messaging")
    }

    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.core:core-splashscreen:1.0.1")
    implementation("com.google.android.material:material:1.12.0")
}
