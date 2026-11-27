/**
 * swallowRefluxEngine.js — Cervical swallowing acoustics (3-phase), RSI/GERD-Q,
 * IMU bed-wedge clinometer, gastric pH & alginate ANC calculator.
 * Mirror of api/gastro_physics.py swallow endpoints.
 */

export const SWALLOW_PRESETS = [
  { id: 'healthy', label: 'Healthy Normophagic Swallow (680 ms SAD)', t1: 0.10, t2: 0.36, t3: 0.78, sad: 0.68, shimmer: 2.1, jitter: 0.6, wetVoice: false, doubleSwallow: false, coughs: 0 },
  { id: 'aspiration', label: 'Delayed Transit + Wet Voice (Aspiration Risk)', t1: 0.12, t2: 0.78, t3: 1.42, sad: 1.30, shimmer: 6.8, jitter: 1.9, wetVoice: true, doubleSwallow: false, coughs: 2 },
  { id: 'zenker', label: "Cricopharyngeal Bar / Zenker's Double-Swallow", t1: 0.10, t2: 0.42, t3: 0.95, sad: 0.85, shimmer: 3.4, jitter: 1.1, wetVoice: false, doubleSwallow: true, coughs: 1 },
  { id: 'lpr', label: 'LPR Cricopharyngeal Spasm / Globus', t1: 0.14, t2: 0.55, t3: 1.05, sad: 0.91, shimmer: 5.2, jitter: 1.5, wetVoice: true, doubleSwallow: false, coughs: 1 }
];

export const RSI_ITEMS = [
  'Hoarseness', 'Throat clearing', 'Excess throat mucus / postnasal drip',
  'Coughing after eating or lying down', 'Coughing after eating / lying down (breathing difficulty)',
  'Breathing difficulties', 'Annoying cough', 'Globus sensation (lump in throat)',
  'Heartburn / chest pain / indigestion'
];

export function scoreRSI(scores) {
  const total = scores.reduce((a, b) => a + (Number(b) || 0), 0);
  return { total, positive: total > 13, interpretation: total > 13 ? 'Positive for LPR (pepsin activation at pH < 6.5)' : 'RSI ≤ 13 — LPR unlikely by RSI alone' };
}

export function scoreGERDQ(items) {
  // items: heartburn, regurgitation, epigastric pain, nausea, early satiety, sleep disturbance (0–3 each)
  const total = items.reduce((a, b) => a + (Number(b) || 0), 0);
  return { total, positive: total >= 8, interpretation: total >= 8 ? 'GERD likely (GERD-Q ≥ 8)' : 'GERD unlikely (GERD-Q < 8)' };
}

/** Segment synthetic envelope into 3 phases; SAD = t3 − t1 (normal 0.65–1.15 s). */
export function segmentSwallow(preset) {
  const sad = preset.t3 - preset.t1;
  const bolus = preset.t2 - preset.t1;
  const normal = sad >= 0.65 && sad <= 1.15;
  const aspirationRisk = preset.shimmer > 4.5 || preset.wetVoice || preset.coughs >= 2;
  let verdict;
  if (preset.doubleSwallow) verdict = 'Double-swallow pattern — cricopharyngeal bar / Zenker diverticulum evaluation (videofluoroscopy)';
  else if (aspirationRisk) verdict = 'Aspiration risk — wet voice / elevated shimmer';
  else if (!normal) verdict = 'Prolonged SAD — dysphagia workup';
  else verdict = 'Normal swallowing apnea duration';
  return {
    phases: [
      { name: 'Phase I — Hyolaryngeal elevation & epiglottic inversion click', t: preset.t1, band: 'click 800–2000 Hz' },
      { name: 'Phase II — Pressurized bolus transit rush (250–900 Hz)', t: preset.t2, duration: bolus, band: '250–900 Hz' },
      { name: 'Phase III — UES closure & glottic reopening expiratory puff', t: preset.t3, band: 'expiratory puff' }
    ],
    sad, bolus, normal, aspirationRisk,
    postSwallowCoughs: preset.coughs,
    jitterPct: preset.jitter,
    shimmerPct: preset.shimmer,
    verdict
  };
}

/** IMU bed-wedge angle: θ = atan2(ay, sqrt(ax²+az²)) · 180/π */
export function wedgeAngle(ax, ay, az) {
  return (Math.atan2(ay, Math.sqrt(ax * ax + az * az)) * 180) / Math.PI;
}

export function wedgeVerdict(angleDeg, rollDeg) {
  const inZone = angleDeg >= 15 && angleDeg <= 22;
  const leftLateral = Math.abs(rollDeg) > 60;
  return {
    inZone,
    leftLateral,
    message: inZone
      ? `Head-of-bed ${angleDeg.toFixed(1)}° — inside ACG 15°–22° anti-reflux zone (6–8 in elevation).`
      : `Head-of-bed ${angleDeg.toFixed(1)}° — outside 15°–22° zone. Raise/lower bed head.`,
    lateralMessage: leftLateral
      ? 'Left-lateral decubitus confirmed — GE junction above acid pool (−71% nocturnal acid exposure vs right-lateral).'
      : 'Roll to left-lateral decubitus for maximal nocturnal acid clearance.'
  };
}

/** ANC calculator: alginate raft + bicarbonate vs CaCO3/Mg(OH)2 antacids. */
export function acidNeutralizingCapacity({ alginateMl = 10, bicarbMmol = 5, caco3Mg = 500, mgOhMg = 0, gastricPh = 2.0, gastricVolMl = 250 }) {
  // Alginate raft: bicarbonate neutralization 1 mEq per mmol HCO3−
  const bicarbEq = bicarbMmol; // mmol = mEq for monovalent
  // CaCO3: 2 mEq per mmol (MW 100.09); Mg(OH)2: 2 mEq per mmol (MW 58.32)
  const caco3Eq = (caco3Mg / 100.09) * 2;
  const mgEq = (mgOhMg / 58.32) * 2;
  const totalAnc = bicarbEq + caco3Eq + mgEq;
  // Free acid in stomach: 10^(−pH) mol/L × volume
  const freeAcidMmol = Math.pow(10, -gastricPh) * gastricVolMl;
  const residualPh = Math.min(7, gastricPh + Math.log10(1 + totalAnc / Math.max(freeAcidMmol, 0.01)) * 1.4);
  const raft = alginateMl >= 5;
  return {
    bicarbEq, caco3Eq, mgEq, totalAnc,
    freeAcidMmol, residualPh, raft,
    raftNote: raft ? 'Alginate raft forms — physical barrier over acid pool (preferred for nocturnal LPR).' : 'Alginate dose <5 mL — raft unlikely to form.',
    ppiWindow: 'H2RA/PPI: 30–45 min pre-breakfast (parietal-cell proton-pump activation window).'
  };
}

/** Live DeviceOrientation / DeviceMotion clinometer hook (browser). */
export function startClinometer(onSample) {
  const handler = (e) => {
    const beta = e.beta ?? 0; // front-back tilt
    const gamma = e.gamma ?? 0; // left-right roll
    onSample({ pitch: beta, roll: gamma, wedge: Math.abs(beta) });
  };
  window.addEventListener('deviceorientation', handler);
  return () => window.removeEventListener('deviceorientation', handler);
}
