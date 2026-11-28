# GASTRO-SPECTRA — Usage

## Overview

GASTRO-SPECTRA provides five diagnostic labs, each with a **1-Tap clinical simulator** so the full
workflow runs on a desktop browser with no microphone, camera or IMU.

## 1. Phonoenterography (PEG) tab

- Capture or synthesize bowel sounds (48 kHz).
- Cardiac high-pass (75 Hz) → 4th-order Butterworth bandpass (80–1500 Hz) → Teager-Kaiser burst isolation.
- Outputs: BS/min, motility index, spectral centroid, −3 dB bandwidth, Q, inter-burst interval, 5-state classification.

## 2. Swallowing & LPR/GERD tab

- 3-phase deglutition segmentation (hyolaryngeal click → bolus rush → UES closure).
- SAD, RSI, GERD-Q, IMU bed-wedge clinometer, acid-neutralising capacity.

## 3. FODMAP & Gas Kinetics tab

- GLUT5/GLUT2 co-transport, Starling osmotic flux, Monod fermentation ODE (RK4), breath-test criteria, enzyme rescue doses.

## 4. Optical / BBPS tab

- WebGL2 lens → sRGB→CIELAB → pigment classification → BBPS scoring.

## 5. Hepatobiliary & Economics tab

- FIB-4, NAFLD, MELD 3.0, De Ritis, R-factor, Rome IV, CPT quote auditor.

## Polyglot Runtime Inspector

The client reports the engine used and latency for each call, so you can see whether the Python
serverless function or the ES2024 local mirror answered.