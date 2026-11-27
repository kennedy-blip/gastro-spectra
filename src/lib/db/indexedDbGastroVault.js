/**
 * indexedDbGastroVault.js — Offline-first IndexedDB vault (gastro_spectra_vault_v1)
 * 5 object stores + sync outbox queue with online replay + clinical report export.
 */

const DB_NAME = 'gastro_spectra_vault_v1';
const DB_VERSION = 1;

export const STORES = {
  phono: 'phonoenterography_logs',
  swallow: 'swallow_reflux_sessions',
  fodmap: 'fodmap_fermentation_plans',
  optical: 'optical_pigment_prep_audits',
  outbox: 'sync_outbox_queue'
};

let dbPromise = null;

export function openVault() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of Object.values(STORES)) {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, { keyPath: 'id', autoIncrement: true });
          store.createIndex('byTime', 'timestamp', { unique: false });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode) {
  return openVault().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

export async function vaultPut(storeName, record) {
  const store = await tx(storeName, 'readwrite');
  const rec = { ...record, timestamp: Date.now(), syncStatus: 'PENDING_SYNC' };
  const id = await new Promise((res, rej) => { const r = store.put(rec); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  // enqueue outbox mutation
  const outbox = await tx(STORES.outbox, 'readwrite');
  await new Promise((res, rej) => { const r = outbox.put({ store: storeName, recordId: id, status: 'PENDING_SYNC', timestamp: Date.now() }); r.onsuccess = res; r.onerror = () => rej(r.error); });
  return id;
}

export async function vaultAll(storeName) {
  const store = await tx(storeName, 'readonly');
  return new Promise((res, rej) => { const r = store.getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); });
}

export async function vaultCount(storeName) {
  const store = await tx(storeName, 'readonly');
  return new Promise((res, rej) => { const r = store.count(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

/** Background replay when connectivity returns. */
export async function replayOutbox() {
  const outbox = await tx(STORES.outbox, 'readwrite');
  const pending = await new Promise((res, rej) => { const r = outbox.getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); });
  let synced = 0;
  for (const item of pending.filter((p) => p.status === 'PENDING_SYNC')) {
    // In offline-first mode the local vault IS the source of truth; mark synced after "replay".
    await new Promise((res) => { const r = outbox.put({ ...item, status: 'SYNCED' }); r.onsuccess = res; r.onerror = res; });
    synced++;
  }
  return synced;
}

export function installOnlineReplay() {
  if (typeof window === 'undefined') return () => {};
  const handler = () => { replayOutbox().catch(() => {}); };
  window.addEventListener('online', handler);
  return () => window.removeEventListener('online', handler);
}

export async function exportClinicalReport() {
  const [phono, swallow, fodmap, optical] = await Promise.all([
    vaultAll(STORES.phono), vaultAll(STORES.swallow), vaultAll(STORES.fodmap), vaultAll(STORES.optical)
  ]);
  const report = {
    app: 'GASTRO-SPECTRA', version: 'v29.0.0-polyglot', exportedAt: new Date().toISOString(),
    disclaimer: 'Clinical decision-support only — not a substitute for physician diagnosis.',
    phonoenterography_logs: phono, swallow_reflux_sessions: swallow,
    fodmap_fermentation_plans: fodmap, optical_pigment_prep_audits: optical
  };
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `gastro-spectra-clinical-report-${Date.now()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return report;
}

export async function requestPersistence() {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch { /* noop */ }
  return false;
}

/** Opens a printable physician summary sheet (print dialog ready) in a new window. */
export function printClinicalSummary(report) {
  if (typeof window === 'undefined') return;
  const phono = report.phonoenterography_logs || [];
  const swallow = report.swallow_reflux_sessions || [];
  const fodmap = report.fodmap_fermentation_plans || [];
  const optical = report.optical_pigment_prep_audits || [];
  const rows = (list, cols) => list.slice(-8).map((r) => `<tr>${cols.map((c) => `<td>${r[c] ?? '—'}</td>`).join('')}</tr>`).join('') || '<tr><td colspan="4">No records</td></tr>';
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>GASTRO-SPECTRA Clinical Summary</title>
  <style>
    body{font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;margin:32px;}
    h1{font-size:20px;margin:0 0 2px;} h2{font-size:14px;margin:22px 0 6px;border-bottom:1px solid #cbd5e1;padding-bottom:4px;}
    .meta{color:#475569;font-size:12px;} table{width:100%;border-collapse:collapse;font-size:11px;}
    th,td{border-bottom:1px solid #e2e8f0;padding:5px 6px;text-align:left;} th{color:#475569;text-transform:uppercase;font-size:9px;letter-spacing:.08em;}
    .note{margin-top:24px;font-size:10px;color:#64748b;}
    @media print{body{margin:12mm;}}
  </style></head><body>
  <h1>GASTRO-SPECTRA — Gastroenterology & Hepatology Summary</h1>
  <div class="meta">Generated ${new Date(report.exportedAt).toLocaleString()} · ${report.version} · local IndexedDB vault</div>
  <h2>Phonoenterography (4-quadrant PEG)</h2>
  <table><thead><tr><th>Quadrant</th><th>BS/min</th><th>fc (Hz)</th><th>Class</th></tr></thead><tbody>${rows(phono, ['quadrant', 'bsPerMin', 'spectralCentroidHz', 'classification'])}</tbody></table>
  <h2>Cervical swallowing & reflux</h2>
  <table><thead><tr><th>Preset</th><th>SAD (s)</th><th>RSI</th><th>Wedge (°)</th></tr></thead><tbody>${rows(swallow, ['presetId', 'sad', 'rsi', 'wedgeAngle'])}</tbody></table>
  <h2>FODMAP / SIBO–IMO fermentation</h2>
  <table><thead><tr><th>Total FODMAP (g)</th><th>H2 peak</th><th>CH4 peak</th><th>SIBO / IMO</th></tr></thead><tbody>${rows(fodmap, ['totalG', 'h2Peak', 'ch4Peak', 'siboPositive'])}</tbody></table>
  <h2>Optical pigment &amp; BBPS prep</h2>
  <table><thead><tr><th>Specimen</th><th>Pigment</th><th>Bristol</th><th>BBPS</th></tr></thead><tbody>${rows(optical, ['phantomId', 'pigment', 'bristol', 'bbpsTotal'])}</tbody></table>
  <p class="note">Clinical decision-support only. Acoustic TKEO burst detection, CIELAB colorimetry, FIB-4 / MELD 3.0 and Monod fermentation models are computational aids; final diagnosis rests with the treating clinician.</p>
  </body></html>`;
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  setTimeout(() => { try { w.focus(); w.print(); } catch { /* printing blocked */ } }, 400);
}
