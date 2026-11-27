#!/usr/bin/env python3
"""Wire GASTRO-SPECTRA's Kotlin Capacitor plugins into a freshly generated Android project.

Run by .github/workflows/build-and-bundle-apk.yml immediately after `npx cap add android`:

  * enables the Kotlin Gradle plugin (needed to compile the two hardware plugins)
  * rewrites the generated host activity so both plugins are registered on the bridge

The script is idempotent and never fails the build: if the generated project layout is
unexpected it prints what it skipped and exits 0.
"""

from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path("android")
APP_ID = "com.gastrospectra.clinical"

JAVA_ACTIVITY = """package com.gastrospectra.clinical;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.gastrospectra.plugins.GastroChromaCameraPlugin;
import com.gastrospectra.plugins.GastroPhonoImuPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GastroPhonoImuPlugin.class);
        registerPlugin(GastroChromaCameraPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
"""

KOTLIN_ACTIVITY = """package com.gastrospectra.clinical

import android.os.Bundle
import com.getcapacitor.BridgeActivity
import com.gastrospectra.plugins.GastroChromaCameraPlugin
import com.gastrospectra.plugins.GastroPhonoImuPlugin

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(GastroPhonoImuPlugin::class.java)
        registerPlugin(GastroChromaCameraPlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
"""


def raise_min_sdk() -> None:
    """GASTRO-SPECTRA targets Android API 26+ (unprocessed AudioRecord + Camera2 AWB lock)."""
    variables = ROOT / "variables.gradle"
    if not variables.exists():
        return
    text = variables.read_text()
    if "minSdkVersion = 22" in text:
        variables.write_text(text.replace("minSdkVersion = 22", "minSdkVersion = 26"))
        print("raised minSdkVersion 22 -> 26")


def enable_kotlin() -> None:
    root_gradle = ROOT / "build.gradle"
    if root_gradle.exists():
        text = root_gradle.read_text()
        if "kotlin-gradle-plugin" not in text and "dependencies {" in text:
            text = text.replace(
                "dependencies {",
                'dependencies {\n        classpath "org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.10"',
                1,
            )
            root_gradle.write_text(text)
            print("enabled kotlin-gradle-plugin classpath in android/build.gradle")
        else:
            print("android/build.gradle already declares Kotlin or has no dependencies block")

    app_gradle = ROOT / "app" / "build.gradle"
    if not app_gradle.exists():
        print("android/app/build.gradle missing - skipped Kotlin application plugin")
        return
    text = app_gradle.read_text()
    if "kotlinOptions" not in text and "android {" in text:
        # Capacitor compiles Java at 17 (capacitor.build.gradle); Kotlin must match.
        text = text.replace(
            "android {",
            'android {\n    kotlinOptions {\n        jvmTarget = "17"\n    }',
            1,
        )
    if "kotlin-android" not in text:
        # Kotlin must be applied *after* the Android application plugin.
        if "apply plugin: 'com.android.application'" in text:
            text = text.replace(
                "apply plugin: 'com.android.application'",
                "apply plugin: 'com.android.application'\napply plugin: 'kotlin-android'",
                1,
            )
        else:
            text = "apply plugin: 'kotlin-android'\n" + text
    if "kotlin-stdlib" not in text:
        text = re.sub(
            r"dependencies\s*\{",
            'dependencies {\n    implementation "org.jetbrains.kotlin:kotlin-stdlib:1.9.10"',
            text,
            count=1,
        )
    app_gradle.write_text(text)
    print("applied kotlin-android plugin to android/app/build.gradle")


def register_plugins() -> None:
    pkg = ROOT / "app" / "src" / "main" / "java" / pathlib.Path(*APP_ID.split("."))
    for name in ("MainActivity.java", "MainActivity.kt"):
        candidate = pkg / name
        if candidate.exists():
            candidate.write_text(JAVA_ACTIVITY if name.endswith(".java") else KOTLIN_ACTIVITY)
            print(f"registered GastroPhonoImu + GastroChromaCamera in {candidate}")
            return
    print(f"MainActivity not found under {pkg} - plugins will compile but stay unregistered")


def main() -> int:
    if not ROOT.exists():
        print("android/ not present - nothing to patch", file=sys.stderr)
        return 0
    raise_min_sdk()
    enable_kotlin()
    register_plugins()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
