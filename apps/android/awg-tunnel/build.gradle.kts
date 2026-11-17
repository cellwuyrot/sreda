import java.security.MessageDigest
import groovy.json.JsonSlurper

plugins { id("com.android.library") }

android {
    namespace = "org.amnezia.awg.tunnel"
    compileSdk = 36
    // Match upstream UTF-8 sources on non-UTF-8 build hosts.
    defaultConfig { minSdk = 26 }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.annotation:annotation:1.7.1")
    implementation("androidx.collection:collection:1.4.0")
    compileOnly("com.google.code.findbugs:jsr305:3.0.2")
}

// Prevent accidentally packaging a stale JNI engine with the new Java parser.
val verifyAwg31Native by tasks.registering {
    doLast {
        val manifest = JsonSlurper().parse(rootProject.file("../../docs/awg31-components.json")) as Map<*, *>
        val expected = (manifest["android"] as Map<*, *>)["nativeSha256"] as String
        val nativeFile = file("src/main/jniLibs/arm64-v8a/libwg-go.so")
        val actual = MessageDigest.getInstance("SHA-256").digest(nativeFile.readBytes()).joinToString("") { "%02x".format(it) }
        check(actual == expected) { "AWG 3.1 JNI hash mismatch; restore the pinned official engine" }
    }
}
tasks.named("preBuild").configure { dependsOn(verifyAwg31Native) }

tasks.withType<JavaCompile>().configureEach { options.encoding = "UTF-8" }
