# Installation

This page covers setting up GASTRO-SPECTRA for local development.

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 22.x | The Vercel function runtime is pinned to `nodejs22.x`; CI uses Node 22. |
| npm | Bundled with Node | Used for all JS dependencies. |
| Python | 3.12 | Required only to run the serverless function locally. |
| JDK | 17 | Required only for the Android APK build. |
| Android SDK | platform 34, build-tools 34.0.0 | Required only for the Android APK build. |

## Web app (frontend)

```bash
npm install
npm run dev            # http://localhost:5173
```

The dev server runs the SvelteKit app with Vite. All five clinical modules and their 1-Tap
simulators work in the browser without any backend, because the ES2024 engines provide a local
fallback.

## Python backend (optional, for local parity testing)

The Python function is a Vercel serverless handler. To smoke-test the solvers locally:

```bash
python3 api/gastro_physics.py
```

This runs the `__main__` block, which dispatches a `health` action, a `peg-analyze` preset and a
`hepatology` example, printing the JSON results and asserting the FIB-4 value is not `NaN`.

## Production build

```bash
npm run build          # SvelteKit + adapter-vercel → .vercel/output
```

## Android APK build (optional)

The APK build requires the Android toolchain. The full flow is:

```bash
npm run cap:sync       # build:apk (static SPA) + npx cap sync android
npx cap open android   # open in Android Studio
```

`npm run build:apk` sets `BUILD_TARGET=apk`, which switches `svelte.config.js` to the static SPA
adapter and emits `build-apk/` (Capacitor needs a real `index.html`). In CI the
`.github/workflows/build-and-bundle-apk.yml` workflow performs the full build and publishes the
APK to `static/releases/`.

## Dependency summary

From `package.json`:

**Runtime dependencies**

- `@capacitor/core` `^6.2.0`
- `qrcode-generator` `^1.4.4`
- `svelte` `4.2.19`

**Dev dependencies**

- `@capacitor/android` `^6.2.0`
- `@capacitor/cli` `^6.2.0`
- `@sveltejs/adapter-static` `^3.0.6`
- `@sveltejs/adapter-vercel` `5.4.0`
- `@sveltejs/kit` `2.5.18`
- `@sveltejs/vite-plugin-svelte` `3.1.2`
- `vite` `5.4.11`

## npm scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `dev` | `vite dev` | Local dev server |
| `build` | `vite build` | Production build (Vercel adapter) |
| `preview` | `vite preview` | Preview the production build |
| `cap:sync` | `npm run build:apk && npx cap sync android` | Build SPA + sync to Android |
| `cap:open` | `npx cap open android` | Open the Android project |
| `build:apk` | `BUILD_TARGET=apk vite build` | Static SPA build for Capacitor |
