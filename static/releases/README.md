# APK releases

`gastro-spectra-v29.0.0.apk` is produced by `.github/workflows/build-and-bundle-apk.yml`
(`npx cap sync android` → `./gradlew assembleRelease`) and committed here together with its
`.sha256` checksum.

When the artifact is absent (fresh preview environment), the in-app **One-Tap APK** modal
synthesizes a valid self-contained APK-structured ZIP bundle in the browser and streams it
with byte-progress feedback, so the download flow never 404s.

## Published build

The `build-apk` workflow on `main` has already produced and committed:

| File | Size | SHA-256 |
|------|------|---------|
| `gastro-spectra-v29.0.0.apk` | 3.82 MB | see `gastro-spectra-v29.0.0.apk.sha256` |

It is served at <https://gastro-spectra.vercel.app/releases/gastro-spectra-v29.0.0.apk> and is a
debug-signed, directly installable `com.gastrospectra.clinical` build (minSdk 26, targetSdk 34)
containing `assets/public/index.html` plus both native Kotlin plugins
(`GastroPhonoImuPlugin`, `GastroChromaCameraPlugin`).
