pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // VPN-ANDROID: AmneziaWG Android library publish через JitPack.
        maven { url = uri("https://jitpack.io") }
    }
}

rootProject.name = "Connect"
include(":app")
