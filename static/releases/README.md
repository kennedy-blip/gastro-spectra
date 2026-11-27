# APK releases

`gastro-spectra-v29.0.0.apk` is produced by `.github/workflows/build-and-bundle-apk.yml`
(`npx cap sync android` → `./gradlew assembleRelease`) and committed here together with its
`.sha256` checksum.

When the artifact is absent (fresh preview environment), the in-app **One-Tap APK** modal
synthesizes a valid self-contained APK-structured ZIP bundle in the browser and streams it
with byte-progress feedback, so the download flow never 404s.
