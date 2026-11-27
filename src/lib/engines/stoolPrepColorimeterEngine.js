/**
 * stoolPrepColorimeterEngine.js — sRGB → XYZ → CIELAB (D65 Bradford),
 * Stercobilin / Acholic / Melena / Hematochezia classifier, BBPS prep coach.
 * Mirror of api/gastro_physics.py colorimetry endpoints.
 */

export const PHANTOMS = [
  { id: 'bristol4', label: 'Bristol Type 4 Normo-Cholic Stercobilin Baseline', rgb: [107, 74, 42], bristol: 4, prep: null },
  { id: 'bristol1', label: 'Bristol Type 1 Slow-Transit IMO Constipation (WGTT > 72h)', rgb: [62, 42, 26], bristol: 1, prep: null },
  { id: 'acholic', label: 'Acholic Pale Clay Putty (Biliary Obstruction Alert)', rgb: [196, 188, 168], bristol: 6, prep: null },
  { id: 'melena', label: 'Jet-Black Melena Upper GI Acid-Hematin vs Iron Test', rgb: [18, 16, 15], bristol: 7, prep: null },
  { id: 'steatorrhea', label: 'Steatorrhea Pale Yellow Lipid Malabsorption', rgb: [178, 164, 96], bristol: 6, prep: null },
  { id: 'prep2', label: 'Colonoscopy Prep Stage 2: Cloudy Amber (BBPS 1/3)', rgb: [150, 108, 38], bristol: null, prep: 1 },
  { id: 'prep4', label: 'Colonoscopy Prep Stage 4: Clear Yellow Effluent (BBPS 3/3)', rgb: [230, 224, 160], bristol: null, prep: 3 }
];

export function srgbToLinear(c) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** sRGB → CIELAB with D65 white point (Xn=95.047, Yn=100, Zn=108.883). */
export function rgbToLab([r, g, b]) {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
  let X = (R * 0.4124 + G * 0.3576 + B * 0.1805) * 100;
  let Y = (R * 0.2126 + G * 0.7152 + B * 0.0722) * 100;
  let Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) * 100;
  // Bradford D65 adaptation (sRGB D65 → reference) — small chromatic adaptation matrix
  const Xn = 95.047, Yn = 100, Zn = 108.883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X / Xn), fy = f(Y / Yn), fz = f(Z / Zn);
  const L = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const bb = 200 * (fy - fz);
  const Cab = Math.sqrt(a * a + bb * bb);
  return { L, a, b: bb, Cab, hue: Math.atan2(bb, a) * (180 / Math.PI) };
}

export function classifyPigment({ L, a, b, Cab }) {
  if (L > 78 && a < 4 && b >= 12 && b <= 35) return { id: 'prep_clear', label: 'Crystal-Clear Pale Yellow Effluent — BBPS 3/3 Ready', severity: 'ok', advice: 'Prep adequate: clear yellow urine-like liquid across all segments. Proceed with split-dose schedule as instructed.' };
  if (L > 60 && Cab < 13) return { id: 'acholic', label: 'Acholic / Clay-White — Biliary Obstruction Alert', severity: 'bad', advice: 'L*>60, Cab*<13: bile pigment absent from duodenum. Urgent LFT + RUQ ultrasound (choledocholithiasis).' };
  if (L < 17 && Cab < 6) return { id: 'melena', label: 'Melena Jet-Black — Upper GI Bleed vs Iron/Bismuth', severity: 'bad', advice: 'L*<17, Cab*<6: acid hematin. Differentiate: iron/bismuth gives a*<−2 greenish-black. Check Hb, guaiac, medication history.' };
  if (a > 30 && a / Math.max(b, 1) > 1.35) return { id: 'hematochezia', label: 'Hematochezia Maroon / Bright Red — Lower GI Source', severity: 'bad', advice: 'a*>30, a*/b*>1.35: colonic/hemorrhoidal bleeding. Urgent GI referral.' };
  if (a < -6 && b > 14 && b <= 25) return { id: 'biliverdin', label: 'Rapid-Transit Biliverdin Green — Bile Acid Malabsorption', severity: 'warn', advice: 'a*<−6, b*>14: rapid small-bowel transit / bile-acid malabsorption.' };
  if (L > 55 && b > 25 && a < 0) return { id: 'steatorrhea', label: 'Steatorrhea Pale Yellow — Lipid Malabsorption', severity: 'warn', advice: 'Pale bulky high-b* stool: faecal fat >7 g/day. Check elastase, coeliac serology, PERT adequacy.' };
  if (L >= 26 && L <= 52 && a >= 8 && a <= 22 && b >= 15 && b <= 38) return { id: 'stercobilin', label: 'Healthy Stercobilin Brown — Normal', severity: 'ok', advice: 'Bilirubin → urobilinogen → stercobilin pathway intact.' };
  if (L >= 17 && L < 26 && a >= 4) return { id: 'slow_transit', label: 'Slow-Transit Dark Stercobilin Brown — IMO Constipation', severity: 'warn', advice: 'Dark low-L* brown with preserved a*: prolonged whole-gut transit (>72 h) / methanogen overgrowth pattern.' };
  if (L > 40 && b > 35) return { id: 'prep_amber', label: 'Cloudy Amber Effluent — BBPS 1/3, Needs More Prep', severity: 'warn', advice: 'Continue clear liquids + remaining split-dose prep; re-check effluent before leaving for the clinic.' };
  return { id: 'indeterminate', label: 'Indeterminate Pigment — Repeat Under D65 Torch', severity: 'warn', advice: 'Outside validated CIELAB boxes. Re-sample with calibrated D65 LED, AWB locked.' };
}

/** BBPS segment scoring 0–3 from effluent optics. */
export function bbpsScore({ L, a, b }) {
  const ratio = b / Math.max(a, 0.5);
  if (L > 78 && a < 4 && b >= 12 && b <= 35) return { segment: 3, label: 'Score 3 — Crystal-clear pale yellow, ready for scope', adequate: true, ratio };
  if (L > 62 && a < 10) return { segment: 2, label: 'Score 2 — Hazy yellow, nearly adequate', adequate: false, ratio };
  if (L > 40) return { segment: 1, label: 'Score 1 — Cloudy dark amber, needs more prep', adequate: false, ratio };
  return { segment: 0, label: 'Score 0 — Opaque solid / dark brown', adequate: false, ratio };
}

export function bristolFromLab({ L, Cab }) {
  if (L < 22) return 7;
  if (L < 34) return 1;
  if (L < 44) return 2;
  if (L < 54) return 4;
  if (L < 64) return 5;
  return 6;
}

/** Sample a canvas ROI → mean CIELAB (privacy: in-memory only, never persisted as image). */
export function sampleCanvasROI(canvas, x = 0.25, y = 0.25, w = 0.5, h = 0.5) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const W = canvas.width, H = canvas.height;
  const data = ctx.getImageData(Math.floor(W * x), Math.floor(H * y), Math.floor(W * w), Math.floor(H * h)).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 16) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
  return rgbToLab([r / n, g / n, b / n]);
}
