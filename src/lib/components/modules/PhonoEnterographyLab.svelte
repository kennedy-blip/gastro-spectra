<script>
  import { onMount, onDestroy } from 'svelte';
  import {
    QUADRANTS, PEG_PRESETS, analyzeRecording, synthesizePreset, captureMic
  } from '$lib/engines/phonoEnterographyEngine.js';
  import { callPython, registerFallback } from '$lib/engines/pythonBridge.js';
  import { vaultPut } from '$lib/db/indexedDbGastroVault.js';
  import { bowelSoundsPerMin, motilityState, lumenGasPressureKpa, rbac } from '$lib/gastroStore.js';

  let quadrant = 'RLQ';
  let presetId = 'normoactive';
  let thresholdMultiplier = 3.5;
  let engineLabel = 'ES2024 local';
  let latency = 0;
  let busy = false;
  let micActive = false;
  let micError = '';
  let canvasWave, canvasSpectrum;
  let animHandle = null;
  let savedNote = '';

  // Synchronous first-paint computation: the baseline preset is analysed during
  // component init so SSR/first paint already shows live clinical numbers.
  let samples = synthesizePreset(presetId, 48000, 12);
  let initial = analyzeRecording(samples, 48000, 12, thresholdMultiplier);
  let result = initial;
  let quadrantResults = { RLQ: initial };
  if (typeof window !== 'undefined') {
    bowelSoundsPerMin.set(Math.round(initial.bsPerMin));
    motilityState.set(initial.classification.id);
    lumenGasPressureKpa.set(Math.min(4, 0.4 + initial.bsPerMin / 30));
  }

  onMount(() => {
    registerFallback('peg-analyze', (payload) => {
      const s = synthesizePreset(payload.preset || 'normoactive', 48000, payload.durationSec || 12);
      return analyzeRecording(s, 48000, payload.durationSec || 12, payload.thresholdMultiplier || 3.5);
    });
    render();
    return () => { if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(animHandle); };
  });

  async function runPreset(id) {
    presetId = id;
    busy = true;
    micError = '';
    const durationSec = 12;
    samples = synthesizePreset(id, 48000, durationSec);
    const localRes = analyzeRecording(samples, 48000, durationSec, thresholdMultiplier);
    applyResult(localRes, 'ES2024 local', 0);
    busy = false;
    const py = await callPython('peg-analyze', { preset: id, durationSec, thresholdMultiplier });
    if (!py.fallback && py.data && py.data.bs_per_min !== undefined) {
      applyResult({
        bsPerMin: py.data.bs_per_min,
        mi: py.data.motility_index,
        fc: py.data.spectral_centroid_hz,
        q: py.data.quality_factor,
        bandwidth3db: py.data.bandwidth_3db_hz,
        meanBurstMs: py.data.mean_burst_ms,
        burstCount: py.data.burst_count,
        classification: {
          id: py.data.classification.id,
          label: py.data.classification.label,
          severity: py.data.classification.severity,
          advice: 'Computed by the Python 3.12 serverless solver.'
        }
      }, 'Python 3.12', py.latencyMs);
    } else {
      latency = py.latencyMs;
    }
    render();
    persist();
  }

  function applyResult(r, engine, ms) {
    result = r;
    engineLabel = engine;
    latency = ms;
    quadrantResults = { ...quadrantResults, [quadrant]: r };
    bowelSoundsPerMin.set(Math.round(r.bsPerMin));
    motilityState.set(r.classification.id);
    lumenGasPressureKpa.set(Math.min(4, 0.4 + r.bsPerMin / 30));
  }

  async function scanAllQuadrants() {
    busy = true;
    const next = {};
    for (const q of QUADRANTS) {
      const s = synthesizePreset(presetId, 48000, 12);
      next[q.id] = analyzeRecording(s, 48000, 12, thresholdMultiplier);
      await new Promise((r) => setTimeout(r, 40));
    }
    quadrantResults = next;
    applyResult(next[quadrant], 'ES2024 local', 0);
    render();
    persist();
    busy = false;
  }

  async function recordMic(seconds = 8) {
    micError = '';
    micActive = true;
    try {
      const captured = await captureMic(seconds);
      samples = captured;
      const res = analyzeRecording(captured, 48000, seconds, thresholdMultiplier);
      applyResult(res, '48 kHz live microphone', 0);
      render();
      persist();
    } catch (e) {
      micError = `Microphone capture unavailable (${e.message}). Clinical simulators remain fully functional.`;
    } finally {
      micActive = false;
    }
  }

  async function persist() {
    try {
      await vaultPut('phonoenterography_logs', {
        quadrant,
        presetId,
        bsPerMin: result?.bsPerMin ?? 0,
        motilityIndex: result?.mi ?? 0,
        spectralCentroidHz: result?.fc ?? 0,
        qualityFactor: result?.q ?? 0,
        classification: result?.classification?.id ?? 'indeterminate',
        quadrantResults
      });
      savedNote = `Saved to IndexedDB at ${new Date().toLocaleTimeString()}`;
    } catch (e) {
      savedNote = `Vault unavailable: ${e.message}`;
    }
  }

  function render() {
    if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(animHandle);
    if (!canvasWave || !samples) return;
    const ctx = canvasWave.getContext('2d');
    const W = canvasWave.width = canvasWave.clientWidth * 2;
    const H = canvasWave.height = 380;
    const step = Math.max(1, Math.floor(samples.length / W));
    let start = 0, end = Math.min(samples.length, step * W);
    // center the first detected burst in view
    if (result?.bursts?.length) {
      const b = result.bursts[0];
      start = Math.max(0, b.start - Math.floor(W * step * 0.35));
      end = Math.min(samples.length, start + step * W);
    }
    function draw() {
      ctx.clearRect(0, 0, W, H);
      const grad = ctx.createLinearGradient(0, 0, W, H);
      grad.addColorStop(0, 'rgba(16,185,129,0.10)');
      grad.addColorStop(1, 'rgba(6,182,212,0.06)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(148,197,255,0.16)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 8; i++) {
        const y = (H / 8) * i;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
      // waveform
      ctx.strokeStyle = 'rgba(16,185,129,0.9)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let x = 0; x < W; x++) {
        const idx = start + x * step;
        if (idx >= end) break;
        const y = H / 2 - samples[idx] * H * 1.6;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      // bursts
      ctx.fillStyle = 'rgba(245,158,11,0.16)';
      ctx.strokeStyle = 'rgba(245,158,11,0.9)';
      for (const b of result?.bursts || []) {
        const x0 = (b.start - start) / step;
        const w = (b.end - b.start) / step;
        if (x0 + w < 0 || x0 > W) continue;
        ctx.fillRect(x0, 0, Math.max(1.5, w), H);
        ctx.beginPath();
        ctx.moveTo(x0, 0); ctx.lineTo(x0, H);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(230,240,255,0.75)';
      ctx.font = '600 18px JetBrains Mono, monospace';
      ctx.fillText(`${quadrant} · ${(result?.burstCount ?? 0)} bursts · ${(result?.bsPerMin ?? 0).toFixed(1)} BS/min · fc ${(result?.fc ?? 0).toFixed(0)} Hz`, 18, 28);
      if (micActive) {
        ctx.fillStyle = 'rgba(244,63,94,0.9)';
        ctx.fillText('● REC', W - 110, 28);
      }
    }
    draw();
  }

  $: if (canvasWave && samples) render();

  function severityClass(sev) {
    return sev === 'bad' ? 'bad' : sev === 'warn' ? 'warn' : 'ok';
  }
</script>

<section>
  <div class="grid-2" style="align-items:start;">
    <div class="glass-card">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
        <div>
          <div class="kpi-label">Module 1 · Digital Phonoenterography (PEG)</div>
          <h2 style="margin:4px 0 0; font-size:20px;">4-Quadrant Bowel-Sound Stethoscope</h2>
        </div>
        <span class="pill ok"><span class="dot"></span>{engineLabel}</span>
      </div>

      <div style="display:grid; grid-template-columns: 190px 1fr; gap:14px; margin-top:14px; align-items:center;">
        <svg viewBox="0 0 120 190" width="170" height="220" aria-label="Abdominal quadrant map">
          <rect x="18" y="12" width="84" height="166" rx="26" fill="rgba(6,182,212,0.06)" stroke="rgba(148,197,255,0.3)" />
          <line x1="60" y1="14" x2="60" y2="176" stroke="rgba(148,197,255,0.28)" stroke-dasharray="4 4" />
          <line x1="20" y1="96" x2="100" y2="96" stroke="rgba(148,197,255,0.28)" stroke-dasharray="4 4" />
          <circle cx="60" cy="54" r="8" fill="none" stroke="rgba(245,158,11,0.5)" />
          <text x="60" y="58" text-anchor="middle" font-size="8" fill="rgba(245,158,11,0.9)">antrum</text>
          {#each [['RUQ', 38, 72], ['LUQ', 82, 72], ['RLQ', 38, 122], ['LLQ', 82, 122]] as q}
            <g role="button" tabindex="0" aria-label="Auscultate {q[0]}"
              on:click={() => { quadrant = q[0]; if (quadrantResults[q[0]]) applyResult(quadrantResults[q[0]], engineLabel, latency); }}
              on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { quadrant = q[0]; if (quadrantResults[q[0]]) applyResult(quadrantResults[q[0]], engineLabel, latency); } }}
              style="cursor:pointer">
              <circle cx={q[1]} cy={q[2]} r="15"
                fill={quadrant === q[0] ? 'rgba(16,185,129,0.55)' : 'rgba(148,197,255,0.10)'}
                stroke={quadrant === q[0] ? '#10b981' : 'rgba(148,197,255,0.4)'} stroke-width="1.4" />
              <text x={q[1]} y={q[2] + 3} text-anchor="middle" font-size="7.5"
                fill={quadrant === q[0] ? '#04120c' : '#dbeafe'} font-weight="700">{q[0]}</text>
            </g>
          {/each}
        </svg>
        <div>
          <div class="kpi-label">Auscultation site</div>
          <div style="font:700 15px var(--font); margin:2px 0 4px;">{QUADRANTS.find((q) => q.id === quadrant)?.name}</div>
          <div class="small muted">{QUADRANTS.find((q) => q.id === quadrant)?.site}</div>
          <div class="small muted" style="margin-top:6px;">{QUADRANTS.find((q) => q.id === quadrant)?.note}</div>
          <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:10px;">
            {#each QUADRANTS as q}
              <button class="btn ghost" class:active={quadrant === q.id} on:click={() => { quadrant = q.id; if (quadrantResults[q.id]) applyResult(quadrantResults[q.id], engineLabel, latency); }}>
                {q.id}
              </button>
            {/each}
          </div>
        </div>
      </div>

      <div style="margin-top:14px;">
        <div class="kpi-label" style="margin-bottom:6px;">1-Tap clinical auscultation simulator</div>
        <div style="display:flex; flex-wrap:wrap; gap:6px;">
          {#each PEG_PRESETS as p}
            <button class="btn" class:primary={presetId === p.id} on:click={() => runPreset(p.id)} disabled={busy}>
              {p.label}
            </button>
          {/each}
        </div>
      </div>

      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:12px;">
        <button class="btn" on:click={scanAllQuadrants} disabled={busy}>🔁 Scan all 4 quadrants</button>
        <button class="btn" on:click={() => recordMic(8)} disabled={micActive}>{micActive ? '● Recording 8 s…' : '🎙 Capture 8 s live'}</button>
      </div>

      {#if $rbac !== 'patient'}
        <div style="margin-top:14px;">
          <label for="tk">TKEO threshold multiplier (Pro): <span class="mono">{thresholdMultiplier.toFixed(1)}×</span></label>
          <input id="tk" type="range" min="1.5" max="8" step="0.1" bind:value={thresholdMultiplier}
            on:change={() => runPreset(presetId)} style="width:100%;" />
          <div class="small muted">Default 3.5× median background floor (validated).</div>
        </div>
      {/if}

      {#if micError}<div class="alert-box warn" style="margin-top:12px;">{micError}</div>{/if}
      {#if savedNote}<div class="small muted" style="margin-top:10px;">{savedNote}</div>{/if}
    </div>

    <div>
      <div class="glass-card">
        <canvas class="scope" bind:this={canvasWave} style="height:220px;"></canvas>
        <div class="grid-4" style="margin-top:12px;">
          <div>
            <div class="kpi-label">BS / min</div>
            <div class="kpi" style="color:var(--accent);">{result?.bsPerMin?.toFixed(1) ?? '—'}</div>
          </div>
          <div>
            <div class="kpi-label">Centroid fc</div>
            <div class="kpi" style="color:var(--accent-2);">{result?.fc?.toFixed(0) ?? '—'}<span class="small"> Hz</span></div>
          </div>
          <div>
            <div class="kpi-label">Quality Q</div>
            <div class="kpi" style="color:var(--amber);">{result?.q?.toFixed(2) ?? '—'}</div>
          </div>
          <div>
            <div class="kpi-label">Motility index</div>
            <div class="kpi">{result?.mi?.toFixed(3) ?? '—'}</div>
          </div>
        </div>
        <div class="grid-4" style="margin-top:10px;">
          <div><div class="kpi-label">Bursts</div><div class="mono">{result?.burstCount ?? 0}</div></div>
          <div><div class="kpi-label">Mean τb</div><div class="mono">{result?.meanBurstMs?.toFixed(0) ?? 0} ms</div></div>
          <div><div class="kpi-label">B3dB</div><div class="mono">{result?.bandwidth3db?.toFixed(0) ?? 0} Hz</div></div>
          <div><div class="kpi-label">Latency</div><div class="mono">{latency.toFixed(1)} ms</div></div>
        </div>

        {#if result}
          <div class="alert-box {severityClass(result.classification.severity)}" style="margin-top:12px;">
            <strong>{result.classification.label}</strong>
            <div class="small" style="margin-top:4px;">{result.classification.advice}</div>
          </div>
        {/if}
      </div>

      <div class="glass-card" style="margin-top:14px;">
        <div class="kpi-label">Quadrant auscultation map</div>
        <table class="data" style="margin-top:6px;">
          <thead><tr><th>Quadrant</th><th>BS/min</th><th>fc (Hz)</th><th>Q</th><th>Class</th></tr></thead>
          <tbody>
            {#each QUADRANTS as q}
              <tr>
                <td><button class="btn ghost" style="padding:2px 8px;" on:click={() => { quadrant = q.id; if (quadrantResults[q.id]) applyResult(quadrantResults[q.id], engineLabel, latency); }}>{q.id}</button></td>
                <td class="mono">{quadrantResults[q.id] ? quadrantResults[q.id].bsPerMin.toFixed(1) : '—'}</td>
                <td class="mono">{quadrantResults[q.id] ? quadrantResults[q.id].fc.toFixed(0) : '—'}</td>
                <td class="mono">{quadrantResults[q.id] ? quadrantResults[q.id].q.toFixed(2) : '—'}</td>
                <td class="small">{quadrantResults[q.id]?.classification?.id ?? '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if Object.keys(quadrantResults).length >= 4}
          <div class="small muted" style="margin-top:8px;">
            Silent-abdomen rule: any quadrant &lt; 2 BS/min sustained → ileus vigilance. Metallic tinkles 600–1400 Hz with Q &gt; 6.5 → obstruction alert.
          </div>
        {/if}
      </div>
    </div>
  </div>
</section>
