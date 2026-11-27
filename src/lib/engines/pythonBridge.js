/**
 * pythonBridge.js — thin client for the Vercel Python 3.12 function with a guaranteed
 * ES2024 local fallback (offline APK / disconnected browser). Every call resolves to
 * { data, engine, latencyMs } so the Polyglot Runtime Inspector can display live timings.
 */
import { analyzeRecording, synthesizePreset } from './phonoEnterographyEngine.js';
import { segmentSwallow, SWALLOW_PRESETS } from './swallowRefluxEngine.js';

/** local fallback resolver is injected to avoid circular imports */
let fallbackResolver = null;

export function registerFallback(fn) {
  fallbackResolver = fn;
}

export async function callPython(action, payload = {}, timeoutMs = 6000) {
  const t0 = performance.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch('/api/gastro_physics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data && data.error) throw new Error(data.error);
    return { data, engine: 'python-3.12', latencyMs: performance.now() - t0, fallback: false };
  } catch (err) {
    const local = fallbackResolver ? fallbackResolver(action, payload) : localFallback(action, payload);
    return { data: local, engine: 'es2024-local', latencyMs: performance.now() - t0, fallback: true, error: String(err?.message || err) };
  }
}

/** Minimal local mirror used when no module-specific resolver is registered. */
function localFallback(action, payload) {
  if (action === 'peg-analyze') {
    const preset = payload.preset || 'normoactive';
    const samples = synthesizePreset(preset, 48000, payload.durationSec || 12);
    return analyzeRecording(samples, 48000, payload.durationSec || 12, payload.thresholdMultiplier || 3.5);
  }
  if (action === 'swallow') {
    const preset = SWALLOW_PRESETS.find((p) => p.id === (payload.preset || 'healthy')) || SWALLOW_PRESETS[0];
    return segmentSwallow(preset);
  }
  return { ok: false, engine: 'es2024-local', note: `No local mirror for ${action}` };
}
