/**
 * hepatologyEndoscopyAuditorEngine.js — FIB-4, NAFLD Fibrosis Score, MELD 3.0,
 * De Ritis & R-factor, Rome IV matrix, GI CPT quote auditor (Modifier 33 / PT).
 * Mirror of python_gastro/phonoenterography_hepatology_solver.py
 */

export function fib4({ age, ast, alt, platelets }) {
  const v = (age * ast) / (platelets * Math.sqrt(alt));
  const stratum = v < 1.3 ? 'Low risk of advanced fibrosis (NPV > 90%)' : v <= 2.67 ? 'Indeterminate — recommend FibroScan VCTE (kPa)' : 'High probability of bridging fibrosis / cirrhosis (F3–F4)';
  return { value: v, stratum, severity: v < 1.3 ? 'ok' : v <= 2.67 ? 'warn' : 'bad' };
}

export function nafldFibrosisScore({ age, bmi, diabetes, ast, alt, platelets, albumin }) {
  const v = -1.455 + 0.037 * age + 0.094 * bmi + 1.36 * (diabetes ? 1 : 0) + 0.99 * (ast / alt) - 0.013 * platelets - 0.66 * albumin;
  const stratum = v < -1.455 ? 'Low risk (F0–F2)' : v <= 0.676 ? 'Indeterminate' : 'High risk (F3–F4)';
  return { value: v, stratum };
}

/** MELD 3.0 (2023 UNOS): 1.33·female + 4.56·lnBili + 0.82(137−Na) − 0.24(137−Na)lnBili + 9.09·lnINR + 11.14·lnCr + 1.85(3.5−Alb) − 1.83(3.5−Alb)lnCr + 6 */
export function meld30({ female, bilirubin, sodium, inr, creatinine, albumin, dialysis = false }) {
  const bili = Math.max(1.0, bilirubin);
  const na = Math.min(137, Math.max(125, sodium));
  const cr = dialysis ? 4.0 : Math.min(4.0, Math.max(1.0, creatinine));
  const inrC = Math.max(1.0, inr);
  const alb = Math.min(3.5, Math.max(1.5, albumin));
  const v =
    1.33 * (female ? 1 : 0) +
    4.56 * Math.log(bili) +
    0.82 * (137 - na) -
    0.24 * (137 - na) * Math.log(bili) +
    9.09 * Math.log(inrC) +
    11.14 * Math.log(cr) +
    1.85 * (3.5 - alb) -
    1.83 * (3.5 - alb) * Math.log(cr) +
    6;
  return { value: Math.round(Math.max(6, Math.min(40, v))), raw: v };
}

export function deRitis(ast, alt) {
  const r = ast / alt;
  return { ratio: r, note: r > 1 ? 'AST>ALT — advanced fibrosis / alcoholic pattern' : 'ALT>AST — early hepatocellular injury' };
}

export function rFactor({ alt, ulnAlt, alp, ulnAlp }) {
  const r = (alt / ulnAlt) / (alp / ulnAlp);
  const pattern = r > 5 ? 'Hepatocellular injury' : r >= 2 ? 'Mixed injury' : 'Cholestatic / biliary obstruction';
  return { r, pattern, severity: r < 2 ? 'warn' : 'ok' };
}

export const ROME_IV = [
  { disorder: 'IBS-C', criteria: 'Recurrent abdominal pain ≥1 day/week + >25% hard/lumpy stools, <25% loose' },
  { disorder: 'IBS-D', criteria: 'Pain + >25% loose/watery stools, <25% hard/lumpy' },
  { disorder: 'IBS-M', criteria: 'Pain + >25% hard AND >25% loose stools' },
  { disorder: 'Functional Dyspepsia', criteria: 'Postprandial distress / epigastric pain-burning without organic disease' },
  { disorder: 'Functional Constipation', criteria: 'Straining / incomplete evacuation / blockage ≥25% of defecations' },
  { disorder: 'Ruminal / Belching', criteria: 'Bothersome belching ≥3 days/week' }
];

export const CPT_CATALOG = [
  { code: '45378 → 45385', name: 'Screening Colonoscopy → Snare Polypectomy', hOPD: 6850, asc: 2950, anesthesia: 1450, pathology: 620 },
  { code: '43239', name: 'EGD with Esophageal/Duodenal Biopsy', hOPD: 4200, asc: 2100, anesthesia: 980, pathology: 540 },
  { code: '00812', name: 'Propofol Monitored Anesthesia Care (MAC)', hOPD: 1850, asc: 850, anesthesia: 0, pathology: 0 },
  { code: '91200', name: 'FibroScan Transient Elastography (VCTE)', hOPD: 1150, asc: 650, anesthesia: 0, pathology: 0 },
  { code: '91110', name: 'Wireless Capsule Endoscopy', hOPD: 3200, asc: 2400, anesthesia: 0, pathology: 180 },
  { code: '91065', name: 'Lactulose/Glucose H2–CH4 Breath Test', hOPD: 980, asc: 620, anesthesia: 0, pathology: 0 }
];

/** Audit a bill: detect missing Modifier 33 / PT, OON surprise billing, HOPD vs ASC delta. */
export function auditBill({ procedureCode, billed, setting, modifier33, modifierPT, preventive, oonAnesthesia, oonPathology }) {
  const cat = CPT_CATALOG.find((c) => c.code === procedureCode) || CPT_CATALOG[0];
  const issues = [];
  let corrected = billed;
  if (preventive && !modifier33 && !modifierPT) {
    issues.push({ type: 'bad', text: 'Preventive screening billed as diagnostic WITHOUT Modifier 33 (ACA $0 cost-share) / Modifier PT (Medicare). Rebill with modifier — patient liability should be $0.' });
    corrected = 0;
  }
  if (oonAnesthesia) issues.push({ type: 'warn', text: 'Out-of-network anesthesia (CPT 00812) — No Surprises Act: in-network cost-share applies at in-network facility.' });
  if (oonPathology) issues.push({ type: 'warn', text: 'Out-of-network pathology — surprise-billing protection applies; request in-network repricing.' });
  const ascTotal = cat.asc + cat.anesthesia + cat.pathology;
  const hopdTotal = cat.hOPD + cat.anesthesia + cat.pathology;
  const savings = hopdTotal - ascTotal;
  if (setting === 'HOPD' && savings > 0) issues.push({ type: 'ok', text: `HOPD vs ASC: same procedure saves $${savings.toLocaleString()} at an Ambulatory Surgery Center.` });
  if (!issues.length) issues.push({ type: 'ok', text: 'Bill passes Modifier 33/PT, network, and facility-fee audit.' });
  return { issues, corrected, ascTotal, hopdTotal, savings, catalog: cat };
}
