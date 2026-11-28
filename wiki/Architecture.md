# GASTRO-SPECTRA — Architecture

## Repository structure

```
/
├── api/                        Vercel Python 3.12 serverless function
│   └── gastro_physics.py       Dispatches POST /api/gastro_physics actions
├── python_gastro/              Reference Python 3.12 solvers (mirrored 1:1)
│   ├── __init__.py
│   ├── phonoenterography_hepatology_solver.py   # PEG, Swallow, Colorimetry, Hepatology
│   └── fodmap_fermentation_kinetics.py         # FODMAP, SIBO/IMO, Enzymes, Stacking
├── src/                        SvelteKit frontend (App Router)
│   ├── routes/+page.svelte   Shell: WebGL2 underlay, depth-push modals, layout switcher
│   ├── lib/components/       Header, GooeyNavDock, 3 modals, 5 modules
│   ├── lib/engines/*.js      Pure ES2024 clinical engines (deterministic, offline)
│   ├── lib/db/               IndexedDB vault (5 object stores + sync outbox)
│   ├── lib/engines/pythonBridge.js  Client for Vercel Python fallback
│   ├── shaders/*.glsl        WebGL2 (GLSL ES 3.00) peristaltic + chromatic lens
│   └── app.html              HTML template
├── android/                    Capacitor 6 native wrapper (Kotlin plugins)
│   └── .../plugins/*.kt      GastroChromaCameraPlugin, GastroPhonoImuPlugin
├── scripts/                    Build / bridge scripts
│   ├── patch-android-bridge.py
│   └── web-only-android.py
├── .github/workflows/          CI: build-and-bundle-apk.yml
├── static/releases/            Committed APK artifacts + build-info.json
├── vercel.json                 Vercel deployment config
├── vite.config.js              Vite + SvelteKit plugin, assetsInclude: ['**/*.glsl']
└── svelte.config.js            SvelteKit adapter (adapter-vercel / adapter-static)
```

## Deterministic dual-runtime parity

The JS engines in `src/lib/engines/` are **not stubs**: they re-implement the Python solvers
line-for-line, including the same xorshift32 PRNG for the auscultation synthesizer. Every
function signature, constant, and algorithm matches the Python reference exactly.

### Verified parity (12 s recordings)

| preset | bursts | BS/min | fc (Hz) | Q | τb (ms) | classification |
|---|---|---|---|---|---|---|
| normoactive | 3 | 14.0 | 300.0 | 2.35 | 63.2 | normoactive (JS == Py) |
| ileus | 0 | 1.2 | 210.0 | 1.80 | 30.0 | ileus (JS == Py) |
| obstruction | 2 | 9.0 | 980.0 | 8.40 | 120.0 | obstruction (JS == Py) |
| mmc | 2 | 11.0 | 500.0 | 3.10 | 34.1 | mmc (JS == Py) |
| borborygmi | 8 | 42.0 | 380.4 | 2.90 | 225.6 | borborygmi (JS == Py) |

When the Python function is unreachable (offline APK, disconnected browser), the client transparently
falls back to the ES2024 mirror, reporting the engine and latency in the **Polyglot Runtime Inspector**.

## Module architecture

| Module | JS engine | Python mirror |
|---|---|---|
| 4-Quad PEG | `phonoEnterographyEngine.js` | `phonoenterography_hepatology_solver.py` |
| Swallow & LPR | `swallowRefluxEngine.js` | `phonoenterography_hepatology_solver.py` |
| FODMAP / SIBO/IMO | `fodmapFermentationEngine.js` | `fodmap_fermentation_kinetics.py` |
| Optical / BBPS | `stoolPrepColorimeterEngine.js` | `api/gastro_physics.py` (colorimetry) |
| Hepatology / Economics | `hepatologyEndoscopyAuditorEngine.js` | `phonoenterography_hepatology_solver.py` |

## Vercel Serverless & Statelessness

The Python function `api/gastro_physics.py` must remain **stateless**:
- No long-running background threads
- No persistent servers
- No background worker loops
- Max duration: 30 seconds (configured in `vercel.json`)
- Memory limit: 1024 MB

## Capacitor & Android

- Web assets are built via `npm run build:apk` (adapter-static)
- Capacitor sync regenerates the Android project
- Two Kotlin plugins (`GastroChromaCameraPlugin`, `GastroPhonoImuPlugin`) are wired through
  `scripts/patch-android-bridge.py`
- If native compile fails, `scripts/web-only-android.py` produces a web-only APK

## Build targets

| Target | Command | Adapter |
|---|---|---|
| Vercel deployment | `npm run build` | `adapter-vercel` |
| Android APK | `BUILD_TARGET=apk npm run build` | `adapter-static` |
| Capacitor sync | `npm run cap:sync` | — |