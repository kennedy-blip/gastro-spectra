# GASTRO-SPECTRA — Deployment

## Vercel (production)

**Live:** <https://gastro-spectra.vercel.app>

### Configuration

- Framework preset: `sveltekit`
- Build command: `npm run build`
- Output directory: `.vercel/output`
- Node.js function runtime: `nodejs22.x` (Vercel discontinued `nodejs20.x`)
- Region: `iad1`

### Python serverless function

`api/gastro_physics.py` is deployed as a Vercel Python 3.12 function with:
- Max duration: 30 seconds
- Memory: 1024 MB
- Included files: `python_gastro/**`

### Environment variables

No environment variables required for core functionality.

---

## Android APK

### Automated CI build

The workflow `.github/workflows/build-and-bundle-apk.yml` runs on every push to `main`:

1. Build static SPA bundle (`npm run build:apk`)
2. Generate Capacitor Android project (`npx cap add android && npx cap sync android`)
3. Wire native Kotlin plugins via `scripts/patch-android-bridge.py`
4. Gradle assemble debug-signed APK
5. Commit APK + SHA-256 + `build-info.json` to `static/releases/`

### Manual build

```bash
npm run cap:sync    # builds web bundle + syncs Capacitor
npx cap open android  # opens Android Studio
```

### APK download

- **CI artifact:** <https://gastro-spectra.vercel.app/releases/gastro-spectra-v29.0.0.apk>
- **SHA-256:** <https://gastro-spectra.vercel.app/releases/gastro-spectra-v29.0.0.apk.sha256>
- **Build info:** <https://gastro-spectra.vercel.app/releases/build-info.json>

### Fallback APK

When the CI artifact is absent (fresh preview environment), the in-app **One-Tap APK** modal
synthesizes a valid self-contained APK-structured ZIP bundle in the browser and streams it
with byte-progress feedback, so the download flow never 404s.

---

## Static preview

```bash
npm run build
npm run preview
```

Serves the Vercel build output locally for verification.