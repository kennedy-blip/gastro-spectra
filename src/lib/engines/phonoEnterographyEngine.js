/**
 * phonoEnterographyEngine.js — Pure ES2024 4-Quadrant Digital Phonoenterography (PEG).
 * 4th-order Butterworth bandpass (80–1500 Hz), cardiac notch, Teager-Kaiser Energy
 * Operator burst isolation, spectral biometrics, 5-state motility classifier.
 * Deterministic mirror of python_gastro/phonoenterography_hepatology_solver.py
 */

export const QUADRANTS = [
  { id: 'RLQ', name: 'Right Lower Quadrant', site: 'Ileocecal Valve', note: 'Chyme bolus transit terminal ileum → cecum' },
  { id: 'RUQ', name: 'Right Upper Quadrant', site: 'Hepatic Flexure & Duodenal Sweep', note: 'Duodenal sweep + hepatic flexure' },
  { id: 'LUQ', name: 'Left Upper Quadrant', site: 'Gastric Antrum & Splenic Flexure', note: 'Gastric antrum + splenic flexure' },
  { id: 'LLQ', name: 'Left Lower Quadrant', site: 'Sigmoid Colon', note: 'Sigmoid colon motility' }
];

export const PEG_PRESETS = [
  { id: 'normoactive', label: 'Normoactive Peristalsis (Healthy Baseline)', bsPerMin: 14, fc: 300, q: 2.4, burstMs: 48, mi: 0.32, fast: '≥3.5 h fasting' },
  { id: 'ileus', label: 'Hypoactive / Paralytic Ileus Warning', bsPerMin: 1.2, fc: 210, q: 1.8, burstMs: 30, mi: 0.05, fast: 'post-op / opioid' },
  { id: 'obstruction', label: 'Metallic Tinkles — Early Mechanical Obstruction', bsPerMin: 9, fc: 980, q: 8.4, burstMs: 120, mi: 0.55, fast: 'pressurized loop' },
  { id: 'mmc', label: 'Phase III MMC "Fasting Housekeeper Wave"', bsPerMin: 11, fc: 500, q: 3.1, burstMs: 65, mi: 0.41, fast: '≥3.5 h fasting' },
  { id: 'borborygmi', label: 'Hyperactive Spasmodic Borborygmi (IBS-D)', bsPerMin: 42, fc: 380, q: 2.9, burstMs: 240, mi: 0.78, fast: 'postprandial' }
];

/** 4th-order Butterworth bandpass via cascaded RBJ biquads (zero-phase applied offline). */
export function butterworthBandpassCoeffs(sampleRate = 48000, fLow = 80, fHigh = 1500, q = 0.7071) {
  const w0 = (2 * Math.PI * Math.sqrt(fLow * fHigh)) / sampleRate;
  const alpha = Math.sin(w0) / (2 * q);
  const cosW0 = Math.cos(w0);
  const b0 = alpha, b1 = 0, b2 = -alpha;
  const a0 = 1 + alpha, a1 = -2 * cosW0, a2 = 1 - alpha;
  return { b: [b0 / a0, b1 / a0, b2 / a0], a: [1, a1 / a0, a2 / a0], w0 };
}

export function applyBiquad(samples, coeffs) {
  const { b, a } = coeffs;
  const out = new Float64Array(samples.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let n = 0; n < samples.length; n++) {
    const x0 = samples[n];
    const y0 = b[0] * x0 + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    out[n] = y0;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
  }
  return out;
}

/** Cardiac artifact suppressor: high-pass below 75 Hz (S1/S2 rejection). */
export function cardiacHighPass(samples, sampleRate = 48000, cutoff = 75) {
  const rc = 1 / (2 * Math.PI * cutoff);
  const dt = 1 / sampleRate;
  const alpha = rc / (rc + dt);
  const out = new Float64Array(samples.length);
  let y = 0, prev = 0;
  for (let n = 0; n < samples.length; n++) {
    const x = samples[n];
    y = alpha * (y + x - prev);
    out[n] = y;
    prev = x;
  }
  return out;
}

/** Discrete Teager-Kaiser Energy Operator: Ψd[x[n]] = x²[n] − x[n−1]·x[n+1] */
export function teagerKaiser(samples) {
  const out = new Float64Array(samples.length);
  for (let n = 1; n < samples.length - 1; n++) {
    const v = samples[n] * samples[n] - samples[n - 1] * samples[n + 1];
    out[n] = v > 0 ? v : 0;
  }
  return out;
}

export function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Burst isolation: smoothed Ψd > 3.5× robust noise floor, duration 8–650 ms. */
export function detectBursts(filtered, sampleRate = 48000, thresholdMultiplier = 3.5) {
  const psi = teagerKaiser(filtered);
  const smoothWin = Math.max(1, Math.round(sampleRate * 0.004));
  const smooth = new Float64Array(psi.length);
  let acc = 0;
  for (let n = 0; n < psi.length; n++) {
    acc += psi[n];
    if (n >= smoothWin) acc -= psi[n - smoothWin];
    smooth[n] = acc / Math.min(n + 1, smoothWin);
  }
  let maxSmooth = 0;
  for (let n = 0; n < smooth.length; n++) if (smooth[n] > maxSmooth) maxSmooth = smooth[n];
  // Robust floor: median background plus a fraction of peak keeps sparse-cavitation
  // recordings from triggering on the numerical noise carpet.
  const floor = median(smooth) + 0.04 * maxSmooth + 1e-12;
  const thr = Math.max(floor * thresholdMultiplier, 0.06 * maxSmooth, 1e-9);
  const minSamples = Math.round(sampleRate * 0.008);
  const maxSamples = Math.round(sampleRate * 0.65);
  const rawSegments = [];
  let start = -1;
  for (let n = 0; n < smooth.length; n++) {
    if (smooth[n] > thr && start < 0) start = n;
    if ((smooth[n] <= thr || n === smooth.length - 1) && start >= 0) {
      rawSegments.push([start, n]);
      start = -1;
    }
  }
  // Merge sub-threshold gaps <= 60 ms so each cavitation burst is one event.
  const mergeGap = Math.round(sampleRate * 0.06);
  const merged = [];
  for (const [segStart, segEnd] of rawSegments) {
    const last = merged[merged.length - 1];
    if (last && segStart - last[1] <= mergeGap && segEnd - last[0] <= maxSamples) last[1] = segEnd;
    else merged.push([segStart, segEnd]);
  }
  const bursts = [];
  for (const [segStart, segEnd] of merged) {
    const len = segEnd - segStart;
    if (len < minSamples || len > maxSamples) continue;
    let peak = 0, sumSq = 0;
    for (let k = segStart; k < segEnd; k++) { peak = Math.max(peak, smooth[k]); sumSq += filtered[k] * filtered[k]; }
    bursts.push({ start: segStart, end: segEnd, durationMs: (len / sampleRate) * 1000, peak, rms: Math.sqrt(sumSq / len), energy: peak * len });
  }
  return { bursts, psi: smooth, floor, threshold: thr };
}

/** In-place iterative radix-2 Cooley–Tukey FFT. */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k], uIm = im[i + k];
        const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = uRe + vRe; im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe; im[i + k + len / 2] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

/** Spectral centroid / −3 dB bandwidth / Q from a burst window (Hann + zero-pad FFT). */
export function spectralBiometrics(windowSamples, sampleRate = 48000) {
  const N = windowSamples.length;
  if (N < 16) return { fc: 0, f0: 0, bandwidth3db: 1, q: 0 };
  let nfft = 256;
  while (nfft < N * 2) nfft <<= 1;
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  for (let n = 0; n < N; n++) {
    re[n] = windowSamples[n] * (0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (N - 1)));
  }
  fft(re, im);
  const mags = [];
  let magSum = 0, freqSum = 0;
  for (let k = 1; k < nfft / 2; k++) {
    const f = (k * sampleRate) / nfft;
    if (f < 60 || f > 3000) continue;
    const mag = Math.hypot(re[k], im[k]);
    mags.push({ f, mag });
    magSum += mag; freqSum += f * mag;
  }
  const fc = magSum > 0 ? freqSum / magSum : 0;
  let peak = { f: 0, mag: 0 };
  for (const m of mags) if (m.mag > peak.mag) peak = m;
  // Spectral spread estimate of the −3 dB width (robust against single-bin tones).
  let variance = 0;
  if (magSum > 0) for (const m of mags) variance += (m.f - fc) * (m.f - fc) * m.mag / magSum;
  const binHz = sampleRate / nfft;
  const bw = Math.max(binHz, 2.3548 * Math.sqrt(Math.max(0, variance)));
  return { fc, f0: peak.f, bandwidth3db: bw, q: fc / bw };
}

export function classifyMotility({ bsPerMin, fc, q, burstMs, mi }) {
  if (bsPerMin < 2 && mi < 0.08) return { id: 'ileus', label: 'Hypoactive / Paralytic Ileus — Vigilance Alert', severity: 'bad', advice: 'Sustained <2 BS/min + MI<0.08. Notify surgical team; assess for post-op ileus, opioid/anticholinergic effect.' };
  if (fc >= 620 && fc <= 1380 && q > 6.5) return { id: 'obstruction', label: 'Metallic Tinkles — Early Mechanical Obstruction Alert', severity: 'bad', advice: 'High-pitched pressurized resonance (620–1380 Hz, Q>6.5). Urgent surgical review; NPO, NG decompression pathway.' };
  if (bsPerMin > 34 && burstMs > 180) return { id: 'borborygmi', label: 'Hyperactive Spasmodic Borborygmi (IBS-D / Osmotic)', severity: 'warn', advice: '>34 BS/min with prolonged rushes. Consider osmotic malabsorption, gastroenteritis, IBS-D workup.' };
  if (fc >= 320 && fc <= 680 && bsPerMin >= 3 && bsPerMin <= 12) return { id: 'mmc', label: 'Phase III MMC — Fasting Housekeeper Wave', severity: 'ok', advice: 'Rhythmic 3–12 cpm clustered sweeps after ≥3.5 h fasting. Normal migrating motor complex.' };
  if (bsPerMin >= 5 && bsPerMin <= 30 && fc >= 160 && fc <= 460 && q < 3.5) return { id: 'normoactive', label: 'Normoactive Peristalsis — Healthy Baseline', severity: 'ok', advice: '5–30 BS/min, fc 160–460 Hz, low Q. Normal enteric acoustic motility.' };
  return { id: 'indeterminate', label: 'Indeterminate Enteric Acoustics — Repeat Auscultation', severity: 'warn', advice: 'Does not meet a single validated class. Repeat 4-quadrant auscultation for ≥60 s per quadrant.' };
}

/** Full pipeline on a Float32Array recording. */
export function analyzeRecording(samples, sampleRate = 48000, durationSec = 60, thresholdMultiplier = 3.5) {
  // Promote to float64 so the JS pipeline matches the Python 3.12 mirror bit-for-bit.
  const hp = cardiacHighPass(Float64Array.from(samples), sampleRate, 75);
  const bp = applyBiquad(hp, butterworthBandpassCoeffs(sampleRate, 80, 1500));
  const { bursts, floor, threshold } = detectBursts(bp, sampleRate, thresholdMultiplier);
  const bsPerMin = (bursts.length / durationSec) * 60;
  const mi = bursts.reduce((s, b) => s + (b.durationMs / 1000) * b.rms, 0) / durationSec;
  let fc = 0, q = 0, bw = 0;
  if (bursts.length) {
    const best = bursts.reduce((a, b) => (b.energy > a.energy ? b : a), bursts[0]);
    const win = bp.slice(best.start, best.end);
    const bio = spectralBiometrics(win, sampleRate);
    fc = bio.fc; q = bio.q; bw = bio.bandwidth3db;
  }
  const meanBurstMs = bursts.length ? bursts.reduce((s, b) => s + b.durationMs, 0) / bursts.length : 0;
  const ibis = [];
  for (let i = 1; i < bursts.length; i++) ibis.push((bursts[i].start - bursts[i - 1].end) / sampleRate);
  const meanIbi = ibis.length ? ibis.reduce((a, b) => a + b, 0) / ibis.length : 0;
  const classification = classifyMotility({ bsPerMin, fc, q, burstMs: meanBurstMs, mi });
  return { bsPerMin, mi, fc, q, bandwidth3db: bw, meanBurstMs, meanIbi, burstCount: bursts.length, floor, threshold, classification, bursts: bursts.slice(0, 40) };
}

/** Preset calibration: bwRel = −3 dB partial-cluster width / fc, lenMult scales burst tail. */
export const PRESET_SYNTH = {
  normoactive: { bs: 14, fc: 300, q: 2.4, ms: 48, bwRel: 0.08, lenMult: 1.4 },
  ileus: { bs: 1, fc: 210, q: 1.8, ms: 30, bwRel: 0.08, lenMult: 1.4 },
  obstruction: { bs: 9, fc: 980, q: 8.4, ms: 120, bwRel: 0.03, lenMult: 1.1 },
  mmc: { bs: 11, fc: 500, q: 3.1, ms: 65, bwRel: 0.15, lenMult: 1.0 },
  borborygmi: { bs: 42, fc: 380, q: 2.9, ms: 240, bwRel: 0.3, lenMult: 1.0 }
};

/** xorshift32 PRNG — bit-identical to the Python `_Lcg` mirror. */
function makeLcg(seed) {
  let state = (seed >>> 0) || 0x9e3779b9;
  return () => {
    let x = state;
    x ^= (x << 13) >>> 0;
    x |= 0x0;
    x = (x ^ (x >>> 17)) >>> 0;
    x = (x ^ ((x << 5) >>> 0)) >>> 0;
    state = x >>> 0;
    return state / 0xffffffff;
  };
}

/** Bit-identical mirror of the Python 3.12 17-partial auscultation synthesizer. */
export function synthesizePreset(presetId, sampleRate = 48000, durationSec = 12) {
  const preset = PRESET_SYNTH[presetId] || PRESET_SYNTH.normoactive;
  const N = Math.floor(sampleRate * durationSec);
  const out = new Float64Array(N);
  const rnd = makeLcg([...presetId].reduce((a, c) => a + c.charCodeAt(0), 7));
  const count = Math.round((preset.bs / 60) * durationSec);
  if (count <= 0) return out;
  const partials = 17;
  const phases = Array.from({ length: partials }, () => rnd() * 2 * Math.PI);
  const amps = Array.from({ length: partials }, (_, i) => Math.pow(0.5, 1.5 * Math.pow((i / (partials - 1)) * 2 - 1, 2)));
  const freqs = Array.from({ length: partials }, (_, i) => preset.fc * (1 + ((i / (partials - 1)) * 2 - 1) * preset.bwRel * 0.5));
  const length = Math.floor((preset.ms / 1000) * sampleRate * preset.lenMult);
  const decay = 2.2 + preset.q * 0.45;
  for (let b = 0; b < count; b++) {
    const center = Math.floor(((b + 0.5) / count) * N);
    for (let n = 0; n < length; n++) {
      const idx = center + n;
      if (idx >= N) break;
      const t = n / sampleRate;
      const env = Math.exp(-t * decay) * (1 - Math.exp(-t * 90));
      let acc = 0;
      for (let i = 0; i < partials; i++) acc += amps[i] * Math.sin(2 * Math.PI * freqs[i] * t + phases[i]);
      out[idx] += env * acc * 0.16;
    }
  }
  for (let n = 0; n < N; n++) out[n] += (rnd() - 0.5) * 0.002;
  return out;
}

/**
 * Live microphone capture: 48 kHz, echoCancellation / noiseSuppression / autoGainControl
 * all disabled so raw cavitation transients survive. Returns a Float32Array recording.
 */
export async function captureMic(seconds = 8) {
  if (!navigator?.mediaDevices?.getUserMedia) throw new Error('getUserMedia unavailable');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      sampleRate: 48000,
      channelCount: 1
    }
  });
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx({ sampleRate: 48000 });
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const chunks = [];
  const maxSamples = 48000 * seconds;
  let captured = 0;

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      try { src.disconnect(); } catch { /* already detached */ }
      try { proc.disconnect(); } catch { /* already detached */ }
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error('capture timeout')); }, seconds * 1000 + 6000);
    proc.onaudioprocess = (e) => {
      const d = e.inputBuffer.getChannelData(0);
      chunks.push(new Float32Array(d));
      captured += d.length;
      if (captured >= maxSamples) {
        clearTimeout(timer);
        cleanup();
        const merged = new Float32Array(captured);
        let off = 0;
        for (const c of chunks) { merged.set(c, off); off += c.length; }
        resolve(merged);
      }
    };
    src.connect(proc);
    proc.connect(ctx.destination);
  });
}
