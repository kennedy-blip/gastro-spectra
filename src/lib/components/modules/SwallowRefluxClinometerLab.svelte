<script>
  import { onMount, onDestroy } from 'svelte';
  import {
    SWALLOW_PRESETS, segmentSwallow, scoreRSI, scoreGERDQ, RSI_ITEMS,
    wedgeVerdict, acidNeutralizingCapacity, startClinometer
  } from '$lib/engines/swallowRefluxEngine.js';
  import { vaultPut } from '$lib/db/indexedDbGastroVault.js';
  import { phLevel } from '$lib/gastroStore.js';

  let presetId = 'healthy';
  let seg = segmentSwallow(SWALLOW_PRESETS[0]);
  let canvas;
  let rsi = [1, 1, 2, 1, 1, 1, 1, 2, 1];
  let gerdq = [1, 1, 1, 0, 1, 1];
  let angle = 18;
  let roll = 75;
  let live = null;
  let stopClinometer = null;
  let ancInput = { alginateMl: 10, bicarbMmol: 5, caco3Mg: 500, mgOhMg: 0, gastricPh: 2.0, gastricVolMl: 250 };
  let anc = acidNeutralizingCapacity(ancInput);
  let saved = '';

  const rsiResult = scoreRSI(rsi);
  const gerdResult = scoreGERDQ(gerdq);

  onMount(() => {
    draw();
    anc = acidNeutralizingCapacity(ancInput);
    return () => { if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(animId); };
  });
  let animId = 0;

  $: rsiResult2 = scoreRSI(rsi);
  $: gerdResult2 = scoreGERDQ(gerdq);
  $: verdict = wedgeVerdict(angle, roll);
  $: if (typeof window !== 'undefined') phLevel.set(anc.residualPh);

  function pick(id) {
    presetId = id;
    seg = segmentSwallow(SWALLOW_PRESETS.find((p) => p.id === id));
    draw();
    save();
  }

  function draw() {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width = canvas.clientWidth * 2;
    const H = canvas.height = 400;
    const tMax = 2.2;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(6,182,212,0.05)';
    ctx.fillRect(0, 0, W, H);
    // grid
    ctx.strokeStyle = 'rgba(148,197,255,0.16)';
    for (let i = 0; i <= 11; i++) {
      const x = (W / 11) * i;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      if (i % 2 === 0) {
        ctx.fillStyle = 'rgba(230,240,255,0.45)';
        ctx.font = '600 16px JetBrains Mono';
        ctx.fillText(`${(i * 0.2).toFixed(1)}s`, x + 6, H - 12);
      }
    }
    // envelope: broadband rush during Phase II, click at I, puff at III
    const amp = (t) => {
      let a = 0.04;
      a += 0.55 * Math.exp(-Math.pow((t - seg.phases[0].t) / 0.035, 2));
      if (t > seg.phases[1].t && t < seg.phases[2].t) {
        const u = (t - seg.phases[1].t) / Math.max(seg.phases[2].t - seg.phases[1].t, 0.01);
        a += 0.5 * Math.sin(Math.PI * u) * (0.7 + 0.3 * Math.sin(t * 90));
      }
      a += 0.18 * Math.exp(-Math.pow((t - seg.phases[2].t) / 0.09, 2));
      return a;
    };
    ctx.strokeStyle = 'rgba(16,185,129,0.95)';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    for (let x = 0; x < W; x++) {
      const t = (x / W) * tMax;
      const env = amp(t);
      const y = H / 2 - Math.sin(t * 260) * env * H * 0.42;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // phase markers
    const markers = [
      { t: seg.phases[0].t, label: 'I', color: '#06b6d4' },
      { t: seg.phases[1].t, label: 'II', color: '#f59e0b' },
      { t: seg.phases[2].t, label: 'III', color: '#10b981' }
    ];
    for (const m of markers) {
      const x = (m.t / tMax) * W;
      ctx.strokeStyle = m.color;
      ctx.setLineDash([8, 8]);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = m.color;
      ctx.font = '700 22px Inter, sans-serif';
      ctx.fillText(m.label, x + 8, 30);
    }
    // SAD bracket
    const x0 = (seg.phases[0].t / tMax) * W;
    const x1 = (seg.phases[2].t / tMax) * W;
    ctx.strokeStyle = 'rgba(244,63,94,0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x0, H - 44); ctx.lineTo(x1, H - 44); ctx.stroke();
    ctx.fillStyle = 'rgba(244,63,94,0.95)';
    ctx.font = '700 18px JetBrains Mono';
    ctx.fillText(`SAD ${seg.sad.toFixed(2)} s`, (x0 + x1) / 2 - 50, H - 54);
  }

  async function save() {
    try {
      await vaultPut('swallow_reflux_sessions', {
        presetId, sad: seg.sad, verdict: seg.verdict, rsi: scoreRSI(rsi).total,
        gerdq: scoreGERDQ(gerdq).total, wedgeAngle: angle, roll,
        jitter: seg.jitterPct, shimmer: seg.shimmerPct
      });
      saved = `Swallow + reflux session saved ${new Date().toLocaleTimeString()}`;
    } catch (e) { saved = `Vault error: ${e.message}`; }
  }

  function toggleLive() {
    if (stopClinometer) {
      stopClinometer();
      stopClinometer = null;
      live = null;
      return;
    }
    stopClinometer = startClinometer((s) => {
      live = s;
      angle = Math.round(Math.abs(s.wedge) * 10) / 10;
      roll = Math.round(s.roll);
    });
  }
</script>

<section>
  <div class="grid-2" style="align-items:start;">
    <div class="glass-card">
      <div class="kpi-label">Module 2 · Cervical Swallowing Auscultation</div>
      <h2 style="margin:4px 0 12px; font-size:20px;">3-Phase Deglutition & Aspiration Screener</h2>

      <div style="display:flex; flex-wrap:wrap; gap:6px;">
        {#each SWALLOW_PRESETS as p}
          <button class="btn" class:primary={presetId === p.id} on:click={() => pick(p.id)}>{p.label}</button>
        {/each}
      </div>

      <canvas class="scope" bind:this={canvas} style="height:220px; margin-top:12px;"></canvas>
      <div class="small muted" style="margin-top:6px;">
        10 mL water swallow · lateral border of cricoid cartilage · Phase II rush band 250–900 Hz
      </div>

      <div class="grid-3" style="margin-top:12px;">
        <div>
          <div class="kpi-label">Swallowing apnea</div>
          <div class="kpi" style="color:{seg.normal ? 'var(--accent)' : 'var(--amber)'};">{seg.sad.toFixed(2)}<span class="small"> s</span></div>
          <div class="small muted">normal 0.65–1.15 s</div>
        </div>
        <div>
          <div class="kpi-label">Bolus transit</div>
          <div class="kpi">{seg.bolus.toFixed(2)}<span class="small"> s</span></div>
          <div class="small muted">Δt = t2 − t1</div>
        </div>
        <div>
          <div class="kpi-label">Wet-voice shimmer</div>
          <div class="kpi" style="color:{seg.shimmerPct > 4.5 ? 'var(--danger)' : 'var(--accent-2)'};">{seg.shimmerPct.toFixed(1)}<span class="small"> %</span></div>
          <div class="small muted">flag &gt; 4.5 %</div>
        </div>
      </div>

      <div class="alert-box {seg.aspirationRisk ? 'bad' : 'ok'}" style="margin-top:12px;">
        <strong>{seg.verdict}</strong>
        <div class="small" style="margin-top:4px;">
          Post-swallow coughs: {seg.postSwallowCoughs} · jitter {seg.jitterPct.toFixed(1)} % · sham SAD check {seg.normal ? 'passed' : 'failed'}
        </div>
      </div>
      {#if saved}<div class="small muted" style="margin-top:8px;">{saved}</div>{/if}
    </div>

    <div>
      <div class="glass-card">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div class="kpi-label">Belafsky Reflux Symptom Index</div>
            <div class="kpi" style="color:{rsiResult2.positive ? 'var(--danger)' : 'var(--accent)'};">{rsiResult2.total}<span class="small"> / 45</span></div>
          </div>
          <span class="pill" class:bad={rsiResult2.positive} class:ok={!rsiResult2.positive}>
            <span class="dot"></span>{rsiResult2.positive ? 'LPR POSITIVE' : 'LPR NEGATIVE'}
          </span>
        </div>
        <div class="small muted" style="margin-top:4px;">{rsiResult2.interpretation} · threshold &gt; 13</div>
        <div style="margin-top:8px; display:grid; gap:6px;">
          {#each RSI_ITEMS as item, i}
            <div style="display:grid; grid-template-columns:1fr 130px 28px; gap:8px; align-items:center;">
              <span class="small">{item}</span>
              <input type="range" min="0" max="5" step="1" bind:value={rsi[i]} on:change={save} />
              <span class="mono small" style="text-align:right;">{rsi[i]}</span>
            </div>
          {/each}
        </div>
      </div>

      <div class="glass-card" style="margin-top:14px;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div class="kpi-label">GERD-Q</div>
            <div class="kpi" style="color:{gerdResult2.positive ? 'var(--amber)' : 'var(--accent)'};">{gerdResult2.total}<span class="small"> / 18</span></div>
          </div>
          <span class="pill" class:warn={gerdResult2.positive} class:ok={!gerdResult2.positive}>
            <span class="dot"></span>{gerdResult2.positive ? 'GERD LIKELY' : 'GERD UNLIKELY'}
          </span>
        </div>
        <div class="small muted" style="margin-top:4px;">{gerdResult2.interpretation}</div>
        <div style="margin-top:8px; display:grid; gap:6px;">
          {#each ['Heartburn', 'Regurgitation', 'Epigastric pain', 'Nausea', 'Sleep disturbance', 'Extra dose needed'] as label, i}
            <div style="display:grid; grid-template-columns:1fr 130px 28px; gap:8px; align-items:center;">
              <span class="small">{label}</span>
              <input type="range" min="0" max="3" step="1" bind:value={gerdq[i]} />
              <span class="mono small" style="text-align:right;">{gerdq[i]}</span>
            </div>
          {/each}
        </div>
      </div>
    </div>
  </div>

  <div class="grid-2" style="margin-top:14px; align-items:start;">
    <div class="glass-card">
      <div class="kpi-label">Nocturnal bed-wedge clinometer</div>
      <div style="display:flex; gap:16px; align-items:center; margin-top:8px;">
        <svg viewBox="0 0 140 90" width="150" height="100" aria-label="Bed wedge angle">
          <line x1="10" y1="78" x2="130" y2="78" stroke="rgba(148,197,255,0.4)" stroke-width="2" />
          <line x1="10" y1="78" x2={10 + 110 * Math.cos((angle * Math.PI) / 180)} y2={78 - 110 * Math.sin((angle * Math.PI) / 180)} stroke="#10b981" stroke-width="4" stroke-linecap="round" />
          <path d={`M 40 78 A 30 30 0 0 0 ${40 * Math.cos((angle * Math.PI) / 180) + 10} ${78 - 30 * Math.sin((angle * Math.PI) / 180)}`} fill="none" stroke="#f59e0b" stroke-width="2" />
          <text x="46" y="70" font-size="10" fill="#f59e0b" font-weight="700">{angle.toFixed(1)}°</text>
          <rect x="10" y="80" width="120" height="6" rx="3" fill="rgba(148,197,255,0.2)" />
        </svg>
        <div style="flex:1;">
          <label for="ang">Head-of-bed elevation: <span class="mono">{angle.toFixed(1)}°</span></label>
          <input id="ang" type="range" min="0" max="45" step="0.5" bind:value={angle} style="width:100%;" />
          <label for="roll" style="margin-top:8px;">Body roll: <span class="mono">{roll}°</span> {Math.abs(roll) > 60 ? '(left-lateral)' : '(supine/right)'}</label>
          <input id="roll" type="range" min="-90" max="90" step="1" bind:value={roll} style="width:100%;" />
          <button class="btn ghost" style="margin-top:6px;" on:click={toggleLive}>{stopClinometer ? '■ Stop live IMU' : '📐 Use live DeviceOrientation'}</button>
        </div>
      </div>
      <div class="alert-box {verdict.inZone ? 'ok' : 'warn'}" style="margin-top:10px;">
        <strong>{verdict.message}</strong>
        <div class="small" style="margin-top:4px;">{verdict.lateralMessage}</div>
        {#if live}<div class="small mono" style="margin-top:4px;">live pitch {live.pitch.toFixed(1)}° · roll {live.roll.toFixed(1)}°</div>{/if}
      </div>
    </div>

    <div class="glass-card">
      <div class="kpi-label">Gastric acid neutralizing capacity</div>
      <div class="grid-2" style="margin-top:8px; gap:8px;">
        <div><div class="lbl">Alginate volume (mL)</div><input type="number" bind:value={ancInput.alginateMl} /></div>
        <div><div class="lbl">Bicarbonate (mmol)</div><input type="number" bind:value={ancInput.bicarbMmol} /></div>
        <div><div class="lbl">CaCO₃ (mg)</div><input type="number" bind:value={ancInput.caco3Mg} /></div>
        <div><div class="lbl">Mg(OH)₂ (mg)</div><input type="number" bind:value={ancInput.mgOhMg} /></div>
        <div><div class="lbl">Gastric pH</div><input type="number" step="0.1" bind:value={ancInput.gastricPh} /></div>
        <div><div class="lbl">Gastric volume (mL)</div><input type="number" bind:value={ancInput.gastricVolMl} /></div>
      </div>
      <button class="btn primary" style="margin-top:10px;" on:click={() => (anc = acidNeutralizingCapacity(ancInput))}>Compute ANC</button>
      <div class="grid-3" style="margin-top:12px;">
        <div><div class="kpi-label">ANC</div><div class="kpi" style="color:var(--accent);">{anc.totalAnc.toFixed(1)}<span class="small"> mEq</span></div></div>
        <div><div class="kpi-label">Free acid</div><div class="kpi">{anc.freeAcidMmol.toFixed(2)}<span class="small"> mmol</span></div></div>
        <div><div class="kpi-label">Residual pH</div><div class="kpi" style="color:var(--accent-2);">{anc.residualPh.toFixed(2)}</div></div>
      </div>
      <div class="small muted" style="margin-top:8px;">{anc.raftNote}</div>
      <div class="small muted" style="margin-top:4px;">{anc.ppiWindow}</div>
    </div>
  </div>
</section>
