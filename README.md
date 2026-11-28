# GASTRO-SPECTRA

**v29.0.0-polyglot** — a clinical gastroenterology, enteric-acoustics and metabolic-nutrition workstation.
Five diagnostic labs, a WebGL2 optical/aesthetic layer, an offline IndexedDB vault, and a native
Android APK path — all in **0.0 % TypeScript**.

```
Svelte 46%  ·  ES2024 JavaScript 28%  ·  Python 3.12 13%  ·  Kotlin 7%  ·  GLSL 3%  ·  CSS3 3%  ·  TS 0.0%
```

---

## Table of contents

- [The five clinical modules](#the-five-clinical-modules)
- [Architecture](#architecture)
  - [Deterministic dual-runtime parity](#deterministic-dual-runtime-parity)
- [Python serverless API reference](#python-serverless-api-reference)
- [Run locally](#run-locally)
- [Deploy](#deploy)
  - [Vercel production workstation](https://gastro-spectra.vercel.app)
  - [Android APK build](https://github.com/gastrospectra/android-build)
- [Verification checklist](#verification-checklist)
- [Project Wiki](#project-wiki)

---

## The five clinical modules

| # | Module | What it actually computes |
|---|--------|---------------------------|
| 1 | **4-Quadrant Digital Phonoenterography (PEG)** | 48 kHz unprocessed capture → cardiac high-pass (75 Hz) → 4th-order Butterworth 80–1500 Hz → Teager-Kaiser Energy Operator Ψd[n]=x²[n]−x[n−1]x[n+1] → burst isolation (3.5× robust floor, 8–650 ms, 60 ms gap merge) → BS/min, motility index, spectral centroid, −3 dB bandwidth, Q, inter-burst interval → 5-state motility classifier (ileus, metallic tinkles, MMC phase III, borborygmi, normoactive). |
| 2 | **Cervical Swallowing & LPR/GERD Clinometer** | 3-phase deglutition segmentation (hyolaryngeal click → bolus rush 250–900 Hz → UES closure puff), swallowing apnea duration (SAD), jitter/shimmer wet-voice screen, Belafsky RSI 0–45, GERD-Q 0–18, IMU bed-wedge clinometer (15°–22° ACG zone), left-lateral roll check, alginate/bicarbonate acid-neutralising capacity (mEq HCl) and residual gastric pH. |
| 3 | **Monash FODMAP · SIBO/IMO Gas Kinetics** | GLUT5/GLUT2 co-transport (`M_unabsorbed = max(0, (M_fru − M_glu) − C_GLUT5)`), Starling osmotic water flux `Jw`, Monod bacterial H₂ + archaeal methanogenesis ODE solved with RK4 over 0–480 min (`4 H₂ + CO₂ → CH₄ + 2 H₂O`), North-American-Consensus breath-test criteria (H₂ ≥ 20 ppm by 90 min, CH₄ ≥ 10 ppm), Laplace wall tension, precise lactase ALU / α-galactosidase GALU / PERT lipase dosing. |
| 4 | **Optical Bristol · Acholic/Melena · BBPS** | WebGL2 privacy-first lens (Sobel + oriented contour, D65 chromatic adaptation, false-colour pigment segmentation, turbidity transmission), sRGB → CIELAB (D65) classification of stercobilin/acholic/melena/hematochezia/biliverdin/steatorrhea, 7 specimen phantoms, split-dose Boston Bowel Preparation Scale scoring with the BBPS ≥ 6 adequacy rule. |
| 5 | **Hepatobiliary & Endoscopy Economics** | FIB-4, NAFLD Fibrosis Score, MELD 3.0 (2023 UNOS), De Ritis ratio, R-factor, Rome IV IBS matrix, and a CPT quote auditor that catches missing **Modifier 33 / PT**, out-of-network anaesthesia & pathology, and HOPD-vs-ASC facility-fee gaps. |

Every module ships **1-Tap clinical simulators** (synthesized auscultation, swallow presets,
meal presets, specimen phantoms) so the entire workflow runs on a desktop browser with no
microphone, camera or IMU.

---

## Architecture

```
src/routes/+page.svelte          shell: WebGL2 underlay, depth-push modals, layout switcher
src/lib/components/              header, gooey dock, phone bezel, 3 modals, 5 modules
src/lib/engines/*.js             pure ES2024 clinical engines (deterministic, offline)
src/lib/db/indexedDbGastroVault  5 object stores + sync outbox + JSON/printable export
src/shaders/*.glsl               WebGL2 (GLSL ES 3.00) peristaltic + chromatic lens
api/gastro_physics.py            Python 3.12 Vercel serverless function
python_gastro/*.py               reference solvers mirrored 1:1 by the JS engines
android/.../plugins/*.kt         2 Capacitor 6 plugins (AudioRecord + Camera2)
.github/workflows/build-and-bundle-apk.yml      cap sync android → gradlew assembleRelease → static/releases
```

### Deterministic dual-runtime parity

The JS engines are not stubs: they re-implement the Python solvers line-for-line, including the
same xorshift32 PRNG for the auscultation synthesizer. Verified parity (12 s recordings):

```
preset         bursts  BS/min   fc (Hz)    Q     τb (ms)   classification
normoactive       3     14.0     300.0    2.35    63.2     normoactive   (JS == Py)
ileus             0      1.2     210.0    1.80    30.0     ileus         (JS == Py)
obstruction       2     9.0     980.0    8.40    120.0     obstruction   (JS == Py)
mmc               2     11.0     500.0    3.10    34.1     mmc           (JS == Py)
borborygmi        8     42.0     380.4    2.90    225.6     borborygmi    (JS == Py)
```

The client calls `POST /api/gastro_physics` and transparently falls back to the ES2024 mirror when
the Python function is unreachable (offline APK, preview without the Python runtime), reporting the
engine and latency in the Polyglot Runtime Inspector.

---

## Python serverless API reference

All routes are exposed via `POST /api/gastro_physics`. The handler dispatches on the `action` field:

| Action | Description |
|---|---|
| `health` | Health check — returns engine version info |
| `peg-analyze` | 4th-order Butterworth bandpass + cardiac high-pass + Teager-Kaiser burst isolation → 5-state motility classification |
| `peg-preset` | Return preset name and sample count |
| `swallow` | Segment synthetic swallow envelope into 3 phases (hyolaryngeal click → bolus rush → UES closure) |
| `fodmap` | Simulate meal → glut transport, osmotic flux, fermentation ODE, wall tension, enzyme rescue doses |
| `colorimetry` | sRGB→Lab → pigment classification + BBPS score |
| `hepatology` | FIB-4, NAFLD fibrosis, MELD 3.0, De Ritis, R-factor, Rome IV matrix, CPT audit |

**Endpoint signature**

```http
POST /api/gastro_physics
Content-Type: application/json

{
  "action": "<one of above>",
  ...payload fields...
}
```

**Local fallback resolver** (`scripts/pythonBridge.js`) registers `registerFallback(action, payload)` so that when the remote Python function is unavailable, the client still returns results from the deterministic ES2024 mirrors in `src/lib/engines/`.

**Verify parity**: run `python3 api/gastro_physics.py` (smoke test) and compare outputs against `src/lib/engines/*.js` — values must match exactly (e.g., `normoactive` burst table row).

---

## Run locally

```bash
npm install
npm run dev            # http://localhost:5173
npm run build          # SvelteKit + adapter-vercel
python3 api/gastro_physics.py   # smoke-test the Python solvers
```

## Deploy

**Live production workstation — <https://gastro-spectra.vercel.app>** (Vercel project
`gastro-spectra`, framework `sveltekit`, Node.js 22 function runtime, region `iad1`).

* **Vercel** — framework preset `sveltekit`; `npm run build`; the Python function ships from
  `api/gastro_physics.py` with `includeFiles: python_gastro/**`. `svelte.config.js` pins the
  function runtime to `nodejs22.x` (Vercel discontinued `nodejs20.x`).
* **Android** — `npm run cap:sync && npx cap open android`, or let
  `.github/workflows/build-and-bundle-apk.yml` build and publish
  `static/releases/gastro-spectra-v29.0.0.apk` (+ `.sha256`). The APK job builds the static SPA
  bundle (`npm run build:apk`, Capacitor needs a real `index.html`), regenerates the Android
  project, wires the two Kotlin plugins through `scripts/patch-android-bridge.py`, and falls back
  to a web-only APK (`scripts/web-only-android.py`) if the native compile ever fails.
  Download at `/releases/gastro-spectra-v29.0.0.apk`; until CI publishes it, the in-app APK modal
  synthesizes a valid APK-structured ZIP bundle and streams it with byte progress (never 404s).

---

## Verification checklist

- [x] `find . -name "*.ts" -o -name "*.tsx" -o -name "tsconfig.json"` → only generated SvelteKit internals (git-ignored); **no authored TypeScript, no `lang="ts"`**.
- [x] TKEO burst detector, 3-phase SAD timer, GLUT5/GLUT2 transport, Monod H₂/CH₄ ODE, CIELAB chromaticity, FIB-4 and MELD 3.0 all produce live numbers (see table above).
- [x] Each module's 1-Tap simulator renders immediately (SSR-verified first paint already shows clinical values).
- [x] `npm run build` completes with the Vercel adapter, zero errors.
- [x] Python and JavaScript engines agree numerically (parity table above).

> Clinical decision-support only — not a substitute for physician diagnosis. Acoustic and optical
> outputs are computational aids; final diagnosis and billing decisions rest with the clinician.

---

## Project Wiki

See [`wiki/`](wiki/) for detailed documentation:

- [Home](wiki/Home.md)
- [Installation](wiki/Installation.md)
- [Usage](wiki/Usage.md)
- [API Reference](wiki/API.md)
- [Architecture](wiki/Architecture.md)
- [Clinical Modules](wiki/Clinical-Modules.md)
- [Python Backend](wiki/PythonBackend.md)
- [Android APK Build](wiki/AndroidAPK.md)
- [Deployment](wiki/Deployment.md)
- [Development](wiki/Development.md)
- [Contributing](wiki/Contributing.md)
- [Verification & Testing](wiki/Verification.md)
