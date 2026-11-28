# GASTRO-SPECTRA — Development Guide

## Prerequisites

- Node.js 22+
- Python 3.12+
- (Optional) Android SDK / JDK 17 for native APK builds

## Getting started

```bash
git clone https://github.com/kennedy-blip/gastro-spectra.git
cd gastro-spectra
npm install
npm run dev
```

## Key commands

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server at `http://localhost:5173` |
| `npm run build` | SvelteKit + adapter-vercel production build |
| `npm run preview` | Preview production build |
| `npm run build:apk` | Static SPA build for Capacitor (`BUILD_TARGET=apk`) |
| `npm run cap:sync` | Build APK bundle + Capacitor sync |
| `npm run cap:open` | Open Android Studio project |
| `python3 api/gastro_physics.py` | Local smoke test of Python solvers |

## Project layout

```
src/routes/+page.svelte          shell: WebGL2 underlay, depth-push modals, layout switcher
src/lib/components/              header, gooey dock, phone bezel, 3 modals, 5 modules
src/lib/engines/*.js             pure ES2024 clinical engines (deterministic, offline)
src/lib/db/indexedDbGastroVault  5 object stores + sync outbox + JSON/printable export
src/shaders/*.glsl               WebGL2 (GLSL ES 3.00) peristaltic + chromatic lens
api/gastro_physics.py            Python 3.12 Vercel serverless function
python_gastro/*.py               reference solvers mirrored 1:1 by the JS engines
android/.../plugins/*.kt         2 Capacitor 6 plugins (AudioRecord + Camera2)
.github/workflows/…              cap sync android → gradlew assembleRelease → static/releases
```

## Code style & conventions

- **No authored TypeScript** — the project deliberately uses plain ES2024 JavaScript (`.js`) and Svelte.
- **No backend logic in frontend directories** and vice versa — keep FastAPI handlers in `api/`,
  clinical solvers in `python_gastro/`, and engine mirrors in `src/lib/engines/`.
- **Stateless serverless functions** — `api/gastro_physics.py` is a single
  `BaseHTTPRequestHandler` instance with no background threads or persistent state.
- **Deterministic engines** — all clinical numbers must be reproducible offline; no randomness
  outside the seeded xorshift32 PRNG.

## Testing & verification

```bash
npm run build          # must pass before commit
python3 api/gastro_physics.py   # must pass before commit
```

## Release process

1. Bump version in `package.json` and `api/gastro_physics.py`.
2. Run `npm run build:apk`.
3. Commit and push to `main` — CI builds the APK and publishes to `static/releases/`.
4. Tag release if desired.

## Troubleshooting

- **Offline fallback:** the client calls `POST /api/gastro_physics` and transparently falls back to
  the ES2024 mirror when the Python function is unreachable (offline APK, preview without the
  Python runtime), reporting the engine and latency in the Polyglot Runtime Inspector.
- **Parity failures:** any change to a clinical algorithm must be mirrored 1:1 in both the Python
  solver and the JS engine, and re-verified against the parity table.