# GASTRO-SPECTRA — Verification & Testing

## Build verification

- `npm run build` must pass with zero errors (Vercel adapter).
- `python3 api/gastro_physics.py` smoke test must not produce NaN.

Run:
```bash
npm run build
python3 api/gastro_physics.py
```

## Parity verification

All clinical numbers in the JS engines (`src/lib/engines/*.js`) must match the Python 3.12 mirrors exactly.
Verify for all five presets:

| preset | bursts | BS/min | fc (Hz) | Q | τb (ms) | classification |
|---|---|---|---|---|---|---|
| normoactive | 3 | 14.0 | 300.0 | 2.35 | 63.2 | normoactive (JS == Py) |
| ileus | 0 | 1.2 | 210.0 | 1.80 | 30.0 | ileus (JS == Py) |
| obstruction | 2 | 9.0 | 980.0 | 8.40 | 120.0 | obstruction (JS == Py) |
| mmc | 2 | 11.0 | 500.0 | 3.10 | 34.1 | mmc (JS == Py) |
| borborygmi | 8 | 42.0 | 380.4 | 2.90 | 225.6 | borborygmi (JS == Py) |

### How to verify

```bash
python3 api/gastro_physics.py
```

Compare output against the parity table above and the corresponding `src/lib/engines/*.js` functions.

## Manual test script

```bash
npm run build
python3 api/gastro_physics.py
```

## CI checks

- `find . -name "*.ts" -o -name "*.tsx" -o -name "tsconfig.json"` → only generated SvelteKit internals (git-ignored); **no authored TypeScript, no `lang="ts"`**.
- Deterministic engines: all clinical numbers reproducible offline; no randomness outside seeded xorshift32 PRNG.
- Vercel Python function is stateless (single BaseHTTPRequestHandler instance, max duration 30 s, memory 1024 MB).
