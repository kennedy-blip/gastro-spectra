# GASTRO-SPECTRA — Python Serverless API Reference

## Base URL

```
POST https://<vercel-instance>/api/gastro_physics
```

The handler is a **Vercel serverless function** (`api/gastro_physics.py`) exposing six actions:

| Action | Description |
|---|---|
| `health` | Health check — returns `{ ok: true, engine: "python-3.12", version: "29.0.0-polyglot" }` |
| `peg-analyze` | 4th-order Butterworth bandpass (80–1500 Hz) + cardiac high-pass (75 Hz) + Teager-Kaiser burst isolation → 5-state motility classification |
| `peg-preset` | Return preset name and sample count for deterministic auscultation synthesis |
| `swallow` | Segment synthetic swallow envelope into 3 phases (hyolaryngeal click → bolus rush → UES closure puff); return SAD, jitter/shimmer/wet-voice verdicts |
| `fodmap` | Simulate meal via `MealVector` → glut transport, osmotic flux, coupled Monod fermentation ODE (RK4), wall tension, enzyme rescue doses |
| `colorimetry` | sRGB→CIELAB(D65) → pigment classification + BBPS score |
| `hepatology` | FIB-4, NAFLD fibrosis score, MELD 3.0, De Ritis ratio, R-factor, Rome IV matrix, CPT audit |

### Request / Response shape

```json
{
  "action": "...",
  ...payload fields...
}
```

Example POST body for `peg-analyze`:

```json
{ "preset": "obstruction", "sampleRate": 48000, "durationSec": 12 }
```

Response:

```json
{ "ok": false, "error": "Unknown action 'peg-analyze'..." }
```

or on success:

```json
{ "engine": "python-3.12", "version": "29.0.0-polyglot", "actions": [...] }
```

### Local fallback resolver

When no module-specific resolver is registered, the client falls back to an ES2024 local mirror in `src/lib/engines/`:
- `phonoEnterographyEngine.js`
- `swallowRefluxEngine.js`
- `stoolPrepColorimeterEngine.js`
- `hepatologyEndoscopyAuditorEngine.js`
- `fodmapFermentationEngine.js`

Registered via `scripts/pythonBridge.js` (`registerFallback(action, payload)`). The fallback returns results marked `"fallback": true` and `"engine": "es2024-local"`.

### Verifying parity between JS and Python

Run the smoke test:

```bash
python3 api/gastro_physics.py
```

Compare outputs against the corresponding `src/lib/engines/*.js` functions. Values must match exactly (e.g., normoactive burst table row: 3 bursts, BS/min ≈14.0, fc≈300 Hz, Q≈2.35, τb≈63 ms, classification `normoactive`). This ensures deterministic dual-runtime parity required for offline APK reproducibility.
