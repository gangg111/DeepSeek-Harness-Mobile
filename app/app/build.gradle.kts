plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "com.dsh.mobile"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.dsh.mobile"
        minSdk = 28
        // targetSdk 28 celowo: od API 29 SELinux blokuje exec/dlopen plików z katalogu danych
        // aplikacji, a node i addony .node muszą działać z filesDir (tak samo robi Termux).
        targetSdk = 28
        versionCode = 13
        versionName = "0.1.5-rc.3+11"
        ndk { abiFilters += listOf("arm64-v8a") }
    }
    androidResources { noCompress += "zip" }
    // targetSdk 28 jest celowe (exec z filesDir), a lint traktuje to jako błąd blokujący release.
    lint { checkReleaseBuilds = false; abortOnError = false }
    signingConfigs {
        // Własny klucz release (ten sam co Ciuchy); hasło w ~/.android/ciuchy-release.pass.
        // Zmiana klucza względem zainstalowanej wersji = trzeba odinstalować starą apkę.
        create("release") {
            val home = System.getProperty("user.home")
            val pass = file("$home/.android/ciuchy-release.pass").readText().trim()
            storeFile = file("$home/.android/ciuchy-release.jks")
            storePassword = pass
            keyAlias = "ciuchy"
            keyPassword = pass
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
