# GASTRO-SPECTRA — Python Backend

## api/gastro_physics.py — Vercel serverless function

The Python backend is a single Vercel serverless function at `api/gastro_physics.py`. It uses
`http.server.BaseHTTPRequestHandler` and dispatches on the `action` field in the POST body.

### Request dispatch

```python
def _dispatch(payload: dict) -> dict:
    action = str(payload.get("action", "health"))
    if action == "health":
        return {"ok": True, "engine": "python-3.12", "version": VERSION, "python": sys.version.split()[0]}
    if action == "peg-analyze":
        return _peg_analyze(payload)
    if action == "peg-preset":
        return {"preset": payload.get("preset", "normoactive"), "samples": len(phs.synthesize_preset(str(payload.get("preset", "normoactive"))))}
    if action == "swallow":
        return phs.segment_swallow(str(payload.get("preset", "healthy")))
    if action == "fodmap":
        return ffk.simulate_meal(payload)
    if action == "colorimetry":
        return _colorimetry(payload)
    if action == "hepatology":
        return _hepatology(payload)
    return {"ok": False, "error": f"Unknown action '{action}'"}
```

### Actions

| Action | Python module | Description |
|---|---|---|
| `health` | — | Returns version info |
| `peg-analyze` | `phonoenterography_hepatology_solver.py` | Full PEG pipeline |
| `peg-preset` | `phonoenterography_hepatology_solver.py` | Returns preset sample count |
| `swallow` | `phonoenterography_hepatology_solver.py` | 3-phase swallow segmentation |
| `fodmap` | `fodmap_fermentation_kinetics.py` | Full FODMAP/SIBO/IMO pipeline |
| `colorimetry` | `phonoenterography_hepatology_solver.py` | sRGB→Lab + pigment + BBPS |
| `hepatology` | `phonoenterography_hepatology_solver.py` | FIB-4, MELD 3.0, CPT audit |

### Local smoke test

```bash
python3 api/gastro_physics.py
```

This runs the `__main__` block which dispatches `health`, `peg-analyze` (obstruction preset), and
`hepatology` (FIB-4 example), printing JSON and asserting FIB-4 is not NaN.

### Statelessness guarantees

- No background threads
- No persistent state between invocations
- Max duration: 30 seconds (configured in `vercel.json`)
- Memory limit: 1024 MB

## python_gastro/ — Reference solvers

### fodmap_fermentation_kinetics.py

- `MealVector` — six-subgroup FODMAP load with macro context
- `glut_transport()` — GLUT5/GLUT2 co-transport
- `osmotic_flux()` — Starling lumen water secretion
- `fermentation_ode()` — RK4 integration of coupled Monod H₂/CH₄ kinetics
- `laplace_wall_tension()` — Visceral wall tension
- `enzyme_rescue()` — Lactase ALU, α-galactosidase GALU, PERT lipase USP
- `stacking_score()` — Monash stacking verdict
- `simulate_meal()` — Full pipeline used by the Vercel function

### phonoenterography_hepatology_solver.py

- PEG DSP: Butterworth bandpass, cardiac high-pass, Teager-Kaiser, burst detection
- Spectral biometrics: FFT centroid, −3 dB bandwidth, Q
- 5-state motility classifier
- `synthesize_preset()` — Deterministic auscultation synthesizer (xorshift32 PRNG)
- Swallow: 3-phase segmentation, SAD, RSI, GERD-Q
- Colorimetry: sRGB→XYZ→CIELAB (D65 Bradford), pigment classification, BBPS
- Hepatology: FIB-4, NAFLD Fibrosis Score, MELD 3.0, De Ritis, R-factor, Rome IV, CPT audit

## Dual-runtime parity

The JS engines in `src/lib/engines/` mirror the Python solvers line-for-line, including the same
xorshift32 PRNG for the auscultation synthesizer.

### Verification checklist

- [ ] `python3 api/gastro_physics.py` passes without NaN
- [ ] `npm run build` completes with zero errors
- [ ] Parity table matches (normoactive: 3 bursts, BS/min≈14, fc≈300, Q≈2.35, τb≈63ms, classification=normoactive)
- [ ] All 5 presets produce identical JS/Python outputs