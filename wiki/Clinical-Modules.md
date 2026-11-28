# GASTRO-SPECTRA — Clinical Modules

GASTRO-SPECTRA ships five diagnostic labs. Each module has a **1-Tap clinical simulator** so the
entire workflow runs on a desktop browser with no microphone, camera or IMU.

---

## 1. 4-Quadrant Digital Phonoenterography (PEG)

**Engine:** `src/lib/engines/phonoEnterographyEngine.js`
**Python mirror:** `python_gastro/phonoenterography_hepatology_solver.py`

### Signal pipeline

1. **48 kHz unprocessed capture** → cardiac high-pass (75 Hz) to reject S1/S2 heart sounds.
2. **4th-order Butterworth bandpass** 80–1500 Hz (cascaded RBJ biquads).
3. **Teager-Kaiser Energy Operator** `Ψd[n] = x²[n] − x[n−1]·x[n+1]`.
4. **Burst isolation**: smoothed Ψd > 3.5× robust noise floor, duration 8–650 ms, 60 ms gap merge.
5. **Spectral biometrics**: Hann-windowed zero-padded FFT → spectral centroid, −3 dB bandwidth, Q.
6. **5-state motility classifier**: ileus, metallic tinkles (obstruction), MMC phase III, borborygmi,
   normoactive.

### Outputs

- Bursts per minute (BS/min)
- Motility index (MI)
- Spectral centroid (fc), −3 dB bandwidth, quality factor (Q)
- Mean burst duration, inter-burst interval
- Classification with severity + clinical advice

### Presets

`normoactive`, `ileus`, `obstruction`, `mmc`, `borborygmi` — each synthesized deterministically with
a 17-partial Gaussian cluster and xorshift32 PRNG.

---

## 2. Cervical Swallowing & LPR/GERD Clinometer

**Engine:** `src/lib/engines/swallowRefluxEngine.js`

### 3-phase deglutition segmentation

| Phase | Event | Frequency band |
|---|---|---|
| I | Hyolaryngeal elevation & epiglottic inversion click | 800–2000 Hz |
| II | Pressurized bolus transit rush | 250–900 Hz |
| III | UES closure & glottic reopening expiratory puff | expiratory puff |

### Computed metrics

- **Swallowing apnea duration (SAD)** = t3 − t1 (normal 0.65–1.15 s)
- **Jitter / shimmer** wet-voice screen
- **Belafsky RSI** 0–45 (positive > 13)
- **GERD-Q** 0–18 (positive ≥ 8)
- **IMU bed-wedge clinometer**: `θ = atan2(ay, √(ax²+az²))·180/π`, ACG 15°–22° anti-reflux zone
- **Left-lateral roll check**
- **Alginate/bicarbonate acid-neutralising capacity** (mEq HCl) and residual gastric pH

### Presets

`healthy`, `aspiration`, `zenker`, `lpr`.

---

## 3. Monash FODMAP · SIBO/IMO Gas Kinetics

**Engine:** `src/lib/engines/fodmapFermentationEngine.js`
**Python mirror:** `python_gastro/fodmap_fermentation_kinetics.py`

### Models

- **GLUT5/GLUT2 co-transport**: `M_unabsorbed = max(0, (M_fru − M_glu) − C_GLUT5)`
- **Starling osmotic water flux** `Jw`: `V = Lp·A·σ·R·T·Σ(mᵢ/MWᵢ)` (lumped 8 mL/mmol)
- **Monod bacterial H₂ + archaeal methanogenesis ODE** solved with RK4 over 0–480 min
  (`4 H₂ + CO₂ → CH₄ + 2 H₂O`)
- **North-American-Consensus breath-test criteria**: H₂ ≥ 20 ppm by 90 min, CH₄ ≥ 10 ppm
- **Laplace wall tension** `T = P·r/(2h)`
- **Precise enzyme dosing**: lactase ALU, α-galactosidase GALU, PERT lipase USP

### Meal presets

`stack`, `lactose`, `gos`, `rescue`, `baseline`.

---

## 4. Optical Bristol · Acholic/Melena · BBPS

**Engine:** `src/lib/engines/stoolPrepColorimeterEngine.js`

### Optics

- **WebGL2 privacy-first lens**: Sobel + oriented contour, D65 chromatic adaptation, false-colour
  pigment segmentation, turbidity transmission (shader: `gastro_chroma_segmentation_lens.glsl`)
- **sRGB → CIELAB (D65)** classification of stercobilin / acholic / melena / hematochezia /
  biliverdin / steatorrhea
- **7 specimen phantoms** for 1-Tap simulation
- **Split-dose Boston Bowel Preparation Scale (BBPS)** scoring with the BBPS ≥ 6 adequacy rule

### Pigment classes

`stercobilin`, `acholic`, `melena`, `hematochezia`, `biliverdin`, `steatorrhea`, `slow_transit`,
`prep_clear`, `prep_amber`, `indeterminate`.

---

## 5. Hepatobiliary & Endoscopy Economics

**Engine:** `src/lib/engines/hepatologyEndoscopyAuditorEngine.js`
**Python mirror:** `python_gastro/phonoenterography_hepatology_solver.py`

### Scores

- **FIB-4**: `(age × AST) / (platelets × √ALT)`
- **NAFLD Fibrosis Score**
- **MELD 3.0** (2023 UNOS)
- **De Ritis ratio** (AST/ALT)
- **R-factor** (hepatocellular vs cholestatic injury)
- **Rome IV IBS matrix**

### CPT quote auditor

Catches:
- Missing **Modifier 33 / PT** on preventive screening (ACA $0 cost-share)
- Out-of-network anaesthesia & pathology (No Surprises Act)
- HOPD-vs-ASC facility-fee gaps