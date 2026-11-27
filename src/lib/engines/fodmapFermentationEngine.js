/**
 * fodmapFermentationEngine.js — Monash FODMAP stacking, GLUT5/GLUT2 co-transport,
 * Starling osmotic flux Jw, coupled SIBO/IMO H2–CH4 Monod ODE (RK4), breath-test
 * criteria, Laplace wall tension, enzyme rescue doses.
 * Mirror of python_gastro/fodmap_fermentation_kinetics.py
 */

export const FODMAP_GROUPS = ['fructans', 'gos', 'lactose', 'excessFructose', 'sorbitol', 'mannitol'];

export const MEAL_PRESETS = [
  { id: 'stack', label: 'Garlic-Onion Pasta + Apple Dessert (High Fructan/Fructose Stack)', grams: { fructans: 6.5, gos: 0.8, lactose: 0.4, excessFructose: 7.2, sorbitol: 0.3, mannitol: 0.2 }, fatG: 18, glucoseG: 0 },
  { id: 'lactose', label: 'Whey Protein Shake + Ice Cream (Lactose Overload)', grams: { fructans: 0.4, gos: 0.3, lactose: 28, excessFructose: 0.5, sorbitol: 0.2, mannitol: 0.1 }, fatG: 12, glucoseG: 0 },
  { id: 'gos', label: 'Lentil Chickpea Curry + Cauliflower (GOS + Mannitol Stack)', grams: { fructans: 1.2, gos: 5.8, lactose: 0.2, excessFructose: 0.6, sorbitol: 0.4, mannitol: 4.1 }, fatG: 16, glucoseG: 0 },
  { id: 'rescue', label: 'Honey-Mango Smoothie + Glucose Rescue Test', grams: { fructans: 0.6, gos: 0.4, lactose: 0.3, excessFructose: 9.5, sorbitol: 0.5, mannitol: 0.3 }, fatG: 4, glucoseG: 12 },
  { id: 'baseline', label: 'Strict Monash Green-Serve Baseline Meal', grams: { fructans: 0.5, gos: 0.4, lactose: 0.3, excessFructose: 0.4, sorbitol: 0.2, mannitol: 0.2 }, fatG: 14, glucoseG: 0 }
];

export const MW = { fructans: 162, gos: 504, lactose: 342, excessFructose: 180, sorbitol: 182, mannitol: 182 };

/** GLUT5/GLUT2: Munabsorbed = max(0, (Mfructose − Mglucose) − C_GLUT5,max) */
export function glutTransport(fructoseG, glucoseG, glut5CapacityG = 4.5, kmGlut5Mm = 11) {
  const net = Math.max(0, fructoseG - glucoseG);
  const unabsorbed = Math.max(0, net - glut5CapacityG);
  const rescued = Math.min(net, glucoseG + glut5CapacityG) - Math.min(net, glut5CapacityG);
  const glucoseRescueG = Math.max(0, fructoseG - glut5CapacityG);
  return {
    net, unabsorbed, absorbed: net - unabsorbed, rescued,
    glucoseRescueG, kmGlut5Mm,
    note: unabsorbed > 0
      ? `Add ≈${glucoseRescueG.toFixed(1)} g glucose (dextrose) to activate apical GLUT2 insertion and rescue excess fructose.`
      : 'Fructose within GLUT5 capacity — no rescue needed.'
  };
}

/** Starling osmotic volume: V = Lp·A·σ·R·T·Σ(mi/MWi) — calibrated lumped Lp·A·σ·R·T = 8 mL per mmol. */
export function osmoticVolume(grams, unabsorbedFraction = 0.85) {
  let mmol = 0;
  for (const g of FODMAP_GROUPS) mmol += ((grams[g] || 0) * unabsorbedFraction * 1000) / MW[g];
  return { mmol, volumeMl: mmol * 8 };
}

/**
 * Coupled Monod fermentation ODE (RK4), 0–480 min.
 * dH2/dt = Y_H2·μmax·[S]/(Ks+[S])·X_bact − 4·k_meth·[H2]·X_archaea − k_clear·[H2]
 * dCH4/dt = k_meth·[H2]·X_archaea    (4 H2 + CO2 → CH4 + 2 H2O)
 * k_clear is pulmonary/blood H2 clearance, which gives the real breath-test plateau.
 */
export function fermentationODE({ substrateG = 8, methanogenLoad = 0.4, dt = 1, tEnd = 480, sibo = true } = {}) {
  const Y = 16, muMax = 0.045, Ks = 2.2, kmeth = 0.0018, kClear = 0.01;
  const Xbact = sibo ? 1.0 : 0.55;
  const Xarchaea = Math.max(0, methanogenLoad);
  let S = substrateG, H2 = 0, CH4 = 0, H2S = 0.4;
  const series = [{ t: 0, S, H2, CH4, H2S }];
  const deriv = (S_, H2_) => {
    const growth = (Y * muMax * S_) / (Ks + S_) * Xbact;
    const meth = kmeth * H2_ * Xarchaea;
    return { dS: -muMax * S_ / (Ks + S_) * Xbact, dH2: growth - 4 * meth - kClear * H2_, dCH4: meth, dH2S: 0.02 * growth * (1 - Math.min(1, Xarchaea)) };
  };
  for (let t = dt; t <= tEnd; t += dt) {
    const k1 = deriv(S, H2);
    const k2 = deriv(S + k1.dS * dt / 2, H2 + k1.dH2 * dt / 2);
    const k3 = deriv(S + k2.dS * dt / 2, H2 + k2.dH2 * dt / 2);
    const k4 = deriv(S + k3.dS * dt, H2 + k3.dH2 * dt);
    S = Math.max(0, S + (dt / 6) * (k1.dS + 2 * k2.dS + 2 * k3.dS + k4.dS));
    H2 = Math.max(0, H2 + (dt / 6) * (k1.dH2 + 2 * k2.dH2 + 2 * k3.dH2 + k4.dH2));
    CH4 = Math.max(0, CH4 + (dt / 6) * (k1.dCH4 + 2 * k2.dCH4 + 2 * k3.dCH4 + k4.dCH4));
    H2S = H2S + (dt / 6) * (k1.dH2S + 2 * k2.dH2S + 2 * k3.dH2S + k4.dH2S);
    if (t % 5 === 0) series.push({ t, S, H2, CH4, H2S: H2S * 2.1 });
  }
  const peakH2 = Math.max(...series.map((p) => p.H2));
  const peakCH4 = Math.max(...series.map((p) => p.CH4));
  const h2Rise90 = series.filter((p) => p.t <= 90).reduce((a, p) => Math.max(a, p.H2), 0) - series[0].H2;
  const tPeak = series.find((p) => p.H2 === peakH2)?.t ?? 0;
  return {
    series, peakH2, peakCH4, h2Rise90, tPeak,
    siboPositive: h2Rise90 >= 20,
    imoPositive: peakCH4 >= 10,
    criteria: {
      sibo: `H2 rise ≥20 ppm within ≤90 min: ${h2Rise90.toFixed(1)} ppm → ${h2Rise90 >= 20 ? 'SIBO POSITIVE' : 'negative'}`,
      imo: `CH4 ≥10 ppm at any point: peak ${peakCH4.toFixed(1)} ppm → ${peakCH4 >= 10 ? 'IMO POSITIVE (methane anticholinergic slow-transit)' : 'negative'}`
    }
  };
}

/** Laplace visceral wall tension T = P·lumen·r / (2h) in kPa; gas volume from H2/CH4. */
export function laplaceTension({ pressureKpa = 0.8, radiusCm = 2.8, wallMm = 3.0, gasMl = 420 }) {
  const T = (pressureKpa * (radiusCm * 10)) / (2 * wallMm);
  return { T, gasMl, painNote: T > 4.0 ? 'Visceral hypersensitivity pain threshold likely exceeded (T > 4.0 kPa).' : 'Wall tension within visceral comfort range.' };
}

/** Exogenous enzyme rescue doses. */
export function enzymeDoses({ lactoseG = 0, gosG = 0, fructanG = 0, fatG = 0, weightKg = 70 }) {
  const lactaseALU = lactoseG * 1800;
  const alphaGalGALU = (gosG + 0.6 * fructanG) * 450;
  const lipaseUSP = fatG * 2000;
  const cap = 2500 * weightKg;
  const capped = Math.min(lipaseUSP, cap);
  return {
    lactaseALU: Math.round(lactaseALU),
    alphaGalGALU: Math.round(alphaGalGALU),
    lipaseUSP: Math.round(capped),
    lipaseCapped: lipaseUSP > cap,
    cap,
    note: `Take with first bite. Lipase cap <2,500 USP/kg/meal (${cap.toLocaleString()} USP for ${weightKg} kg).`
  };
}

export function stackingScore(grams) {
  const total = FODMAP_GROUPS.reduce((a, g) => a + (grams[g] || 0), 0);
  const stacked = FODMAP_GROUPS.filter((g) => (grams[g] || 0) >= 2).length;
  return { total, stacked, verdict: total > 12 ? 'High stacking load — osmotic + fermentation symptoms likely' : total > 6 ? 'Moderate stacking — monitor' : 'Low stacking — Monash green-serve range' };
}
