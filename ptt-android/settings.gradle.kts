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
        // LiveKit Android SDKが依存する一部ライブラリ用
        maven("https://jitpack.io")
    }
}

rootProject.name = "ptt-android"
include(":app")
