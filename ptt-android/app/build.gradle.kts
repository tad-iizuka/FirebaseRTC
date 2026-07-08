plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.gms.google-services")
}

android {
    namespace = "co.ubunifu.pttandroid"
    compileSdk = 35

    defaultConfig {
        applicationId = "co.ubunifu.pttandroid"
        minSdk = 26 // LiveKit Android SDK / WebRTCの実用上の下限に合わせる
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    buildFeatures {
        compose = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    // Compose
    implementation(platform("androidx.compose:compose-bom:2024.09.03"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.6")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.6")
    debugImplementation("androidx.compose.ui:ui-tooling")

    implementation("androidx.core:core-ktx:1.13.1")

    // Firebase (BoM管理)
    implementation(platform("com.google.firebase:firebase-bom:33.4.0"))
    implementation("com.google.firebase:firebase-auth-ktx")
    implementation("com.google.firebase:firebase-firestore-ktx")

    // Google Sign-In (Firebase Authへの認証情報として使う)
    implementation("com.google.android.gms:play-services-auth:21.2.0")

    // LiveKit Android SDK (iOS版のclient-sdk-swift 2.15.1に相当)
    // https://github.com/livekit/client-sdk-android
    implementation("io.livekit:livekit-android:2.11.1")

    // token-serverへのHTTPリクエスト用
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.json:json:20240303")

    // 通話中の画面点灯維持等で使うことがあるため保持(未使用なら削除可)
    implementation("androidx.core:core-splashscreen:1.0.1")
}
