# GASTRO-SPECTRA Wiki — Home

Welcome to the **GASTRO-SPECTRA** wiki. GASTRO-SPECTRA is a clinical gastroenterology,
enteric-acoustics and metabolic-nutrition workstation built as a SvelteKit web app with a
Python 3.12 serverless backend and a native Android APK path — all in **0.0 % TypeScript**.

> Clinical decision-support only — not a substitute for physician diagnosis. Acoustic and optical
> outputs are computational aids; final diagnosis and billing decisions rest with the clinician.

## What it does

GASTRO-SPECTRA bundles five diagnostic labs into a single workstation:

1. **4-Quadrant Digital Phonoenterography (PEG)** — bowel-sound burst detection and motility
   classification.
2. **Cervical Swallowing & LPR/GERD Clinometer** — deglutition segmentation, reflux scoring and
   bed-wedge clinometry.
3. **Monash FODMAP · SIBO/IMO Gas Kinetics** — fructose transport, osmotic flux and coupled
   H₂/CH₄ fermentation kinetics.
4. **Optical Bristol · Acholic/Melena · BBPS** — WebGL2 colour lens, CIELAB pigment
   classification and bowel-prep scoring.
5. **Hepatobiliary & Endoscopy Economics** — fibrosis scores, MELD 3.0 and a CPT quote auditor.

Every module ships **1-Tap clinical simulators** so the full workflow runs on a desktop browser
with no microphone, camera or IMU.

## Feature highlights

- **Deterministic dual-runtime parity** — the ES2024 engines mirror the Python solvers line-for-line
  (including the same xorshift32 PRNG), so the offline APK returns identical numbers.
- **Offline-first** — an IndexedDB vault with a sync outbox and JSON/printable export.
- **WebGL2 optical layer** — GLSL ES 3.00 peristaltic underlay and chromatic segmentation lens.
- **Native Android path** — two Capacitor 6 plugins (AudioRecord + Camera2) and a CI-built APK.

## Quick start

```bash
npm install
npm run dev            # http://localhost:5173
npm run build          # SvelteKit + adapter-vercel
python3 api/gastro_physics.py   # smoke-test the Python solvers
```

## Wiki navigation

| Page | What it covers |
|------|---------------|
| [Installation](Installation.md) | Local setup, dependencies, prerequisites |
| [Usage](Usage.md) | How to use each of the five clinical modules |
| [API Reference](API-Reference.md) | Complete Python serverless function reference |
| [Modules](Modules.md) | Deep dive into each module's algorithms and outputs |
| [Architecture](Architecture.md) | Tech stack, file structure, dual-runtime parity |
| [Deployment](Deployment.md) | Vercel and Android APK deployment |
| [Contributing](Contributing.md) | How to contribute to the project |

## Tech stack at a glance

```
Svelte 46%  ·  ES2024 JavaScript 28%  ·  Python 3.12 13%  ·  Kotlin 7%  ·  GLSL 3%  ·  CSS3 3%  ·  TS 0.0%
```

- **Frontend:** SvelteKit 2.5.18, Svelte 4.2.19, Vite 5.4.11
- **Backend:** Python 3.12 Vercel serverless function
- **Mobile:** Capacitor 6 (Android), Kotlin plugins
- **Graphics:** WebGL2 / GLSL ES 3.00
- **Storage:** IndexedDB (offline vault)
