import java.util.Properties
import groovy.json.JsonSlurper

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
// Файла нет — release запрещён. Для разработки без production-ключей
// доступна assembleDebug. Автоматической подмены release на debug нет.
//
// storeFile: абсолютный путь (предпочтительно) или относительно apps/android.
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
    compileSdk = 36

    sourceSets["main"].res.srcDir(generatedIconRes)
    sourceSets["main"].manifest.srcFile(layout.buildDirectory.file("generated/vpn-policy/AndroidManifest.xml"))
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/vpn-policy/assets"))
    testOptions { unitTests.isIncludeAndroidResources = true }
    packaging {
        jniLibs.useLegacyPackaging = false
        resources.excludes += "META-INF/versions/9/OSGI-INF/MANIFEST.MF"
    }

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
        targetSdk = 36
        versionCode = 3
        versionName = "0.4.0"

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
            // No debug-key fallback for production. Debug builds remain available.
            if (hasReleaseKeystore) signingConfig = signingConfigs.getByName("release")

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

    // VPN-ANDROID: AmneziaWG Go-backend для нативного VPN-туннеля.
    // Официальная нативная реализация AmneziaWG для Android,
    // аналог wireguard-android с параметрами маскировки.
    implementation("com.zaneschepke:amneziawg-android:2.3.7")
    implementation("androidx.webkit:webkit:1.14.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.16.1")
    implementation("androidx.core:core-ktx:1.13.1")

    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.core:core-splashscreen:1.0.1")
    implementation("com.google.android.material:material:1.12.0")
}

// One source of truth: exact package queries AND runtime policy are generated together.
val generateVpnPolicy = tasks.register("generateVpnPolicy") {
    val policy = rootProject.file("vpn-admission-policy.json")
    val manifest = file("src/main/AndroidManifest.xml")
    inputs.files(policy, manifest)
    val output = layout.buildDirectory.dir("generated/vpn-policy")
    outputs.dir(output)
    doLast {
        val value = JsonSlurper().parse(policy) as Map<*, *>
        require(value["version"] is Number && (value["version"] as Number).toInt() > 0)
        require(value["enabled"] is Boolean)
        val packages = value["packages"] as List<*>
        require(packages.size <= 200)
        val ids = packages.map {
            val entry = it as Map<*, *>
            val id = entry["package"] as String
            require(id.matches(Regex("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+")))
            require((entry["label"] as String).isNotBlank())
            id
        }
        require(ids.distinct().size == ids.size)
        val queries = "<queries>" + ids.joinToString("") { "<package android:name=\"$it\" />" } + "</queries>"
        val dir = output.get().asFile
        dir.mkdirs()
        dir.resolve("AndroidManifest.xml").writeText(manifest.readText().replace("<!-- VPN_POLICY_QUERIES -->", queries))
        dir.resolve("assets").mkdirs()
        policy.copyTo(dir.resolve("assets/vpn-admission-policy.json"), overwrite = true)
    }
}
tasks.named("preBuild") { dependsOn(generateVpnPolicy) }
val verifyReleaseSigning = tasks.register("verifyReleaseSigning") {
    doLast { require(hasReleaseKeystore) { "Release requires app/keystore.properties; use assembleDebug for tests" } }
}
tasks.configureEach {
    if (name == "preReleaseBuild") dependsOn(verifyReleaseSigning)
    if (name.contains("Manifest") || name.contains("Assets")) dependsOn(generateVpnPolicy)
    if (name in listOf("assembleRelease", "bundleRelease", "validateSigningRelease")) {
        doFirst { require(hasReleaseKeystore) { "Release requires app/keystore.properties; use assembleDebug for tests" } }
    }
}
