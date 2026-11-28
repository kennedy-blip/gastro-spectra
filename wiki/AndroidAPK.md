# GASTRO-SPECTRA — Android APK Build

## Automated CI workflow

The workflow `.github/workflows/build-and-bundle-apk.yml` runs on every push to `main`:

1. Build static SPA bundle (`npm run build:apk`)
2. Generate Capacitor Android project (`npx cap add android && npx cap sync android`)
3. Wire native Kotlin plugins via `scripts/patch-android-bridge.py`
4. Gradle assemble debug-signed APK
5. Commit APK + SHA-256 + `build-info.json` to `static/releases/`

## Manual local build

### Prerequisites

- Node.js 22+
- JDK 17
- Android SDK (platform 34, build-tools 34.0.0)

### Step-by-step

```bash
npm run cap:sync       # builds web bundle + syncs Capacitor
npx cap open android  # opens Android Studio
```

## APK artifacts

### static/releases/

- `gastro-spectra-v29.0.0.apk` — debug-signed, directly installable `com.gastrospectra.clinical` build
- `gastro-spectra-v29.0.0.apk.sha256` — SHA-256 checksum
- `build-info.json` — build metadata (version, commit, runId, bytes, sha256, assets, builtAt)

### Fallback APK

When the CI artifact is absent (fresh preview environment), the in-app **One-Tap APK** modal
synthesizes a valid self-contained APK-structured ZIP bundle in the browser and streams it
with byte-progress feedback, so the download flow never 404s.

## In-app One-Tap modal

The `ApkDownloadModal.svelte` component synthesizes an APK-structured ZIP bundle in the browser
when the native artifact is unavailable, streaming with byte progress feedback.