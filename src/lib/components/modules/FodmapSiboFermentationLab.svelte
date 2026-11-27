<script>
  import { onMount } from 'svelte';
  import {
    FODMAP_GROUPS, MW, MEAL_PRESETS, glutTransport, osmoticVolume,
    fermentationODE, laplaceTension, enzymeDoses, stackingScore
  } from '$lib/engines/fodmapFermentationEngine.js';
  import { callPython } from '$lib/engines/pythonBridge.js';
  import { vaultPut } from '$lib/db/indexedDbGastroVault.js';
  import { lumenGasPressureKpa, phLevel, rbac } from '$lib/gastroStore.js';

  const LABELS = {
    fructans: 'Fructans (garlic/onion/wheat)',
    gos: 'GOS (legumes)',
    lactose: 'Lactose (dairy)',
    excessFructose: 'Excess fructose (honey/apple)',
    sorbitol: 'Sorbitol (stone fruit)',
    mannitol: 'Mannitol (mushroom/cauliflower)'
  };

  let grams = { ...MEAL_PRESETS[2].grams };
  let glucoseG = 0;
  let fatG = MEAL_PRESETS[2].fatG;
  let weightKg = 70;
  let methanogenLoad = 0.4;
  let pressureKpa = 0.8;
  let radiusCm = 2.8;
  let wallMm = 3.0;
  let sibo = true;
  let canvas;
  let saved = '';
  let engine = 'ES2024';
  let kmGlut5 = 11;
  let glut5Capacity = 4.5;
  let yH2 = 16;
  let kmeth = 0.0018;

  let ode = fermentationODE({ substrateG: totalG(), methanogenLoad, sibo });
  let glut = glutTransport(grams.excessFructose, glucoseG, glut5Capacity, kmGlut5);
  let osm = osmoticVolume(grams);
  let stack = stackingScore(grams);
  let tension = laplaceTension({ pressureKpa, radiusCm, wallMm });
  let enzymes = enzymeDoses({ lactoseG: grams.lactose, gosG: grams.gos, fructanG: grams.fructans, fatG, weightKg });

  function totalG() {
    return FODMAP_GROUPS.reduce((a, g) => a + (Number(grams[g]) || 0), 0);
  }

  onMount(() => {
    recompute();
    return () => { if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(anim); };
  });
  let anim = 0;

  function recompute() {
    stack = stackingScore(grams);
    glut = glutTransport(Number(grams.excessFructose) || 0, Number(glucoseG) || 0, glut5Capacity, kmGlut5);
    osm = osmoticVolume(grams);
    ode = fermentationODE({ substrateG: Math.max(1, stack.total), methanogenLoad, sibo, yH2, kmeth });
    tension = laplaceTension({ pressureKpa, radiusCm, wallMm });
    enzymes = enzymeDoses({ lactoseG: grams.lactose, gosG: grams.gos, fructanG: grams.fructans, fatG, weightKg });
    if (typeof window !== 'undefined') {
      lumenGasPressureKpa.set(pressureKpa);
      phLevel.set(glut.unabsorbed > 0 ? 3.4 : 5.8);
    }
    draw();
  }

  function loadPreset(id) {
    const p = MEAL_PRESETS.find((m) => m.id === id);
    grams = { ...p.grams };
    glucoseG = p.glucoseG;
    fatG = p.fatG;
    recompute();
    save();
  }

  function draw() {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width = canvas.clientWidth * 2;
    const H = canvas.height = 380;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(16,185,129,0.05)';
    ctx.fillRect(0, 0, W, H);
    const maxY = Math.max(30, ode.peakH2 * 1.15, ode.peakCH4 * 1.3, 40);
    ctx.strokeStyle = 'rgba(148,197,255,0.16)';
    ctx.font = '600 14px JetBrains Mono';
    for (let i = 0; i <= 5; i++) {
      const y = (H / 5) * i;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      ctx.fillStyle = 'rgba(230,240,255,0.45)';
      ctx.fillText(`${Math.round(maxY * (1 - i / 5))} ppm`, 8, y + 16);
    }
    for (let t = 0; t <= 480; t += 60) {
      const x = (t / 480) * W;
      ctx.strokeStyle = 'rgba(148,197,255,0.10)';
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      ctx.fillStyle = 'rgba(230,240,255,0.45)';
      ctx.fillText(`${t}m`, x + 4, H - 8);
    }
    const plot = (key, color, width) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ode.series.forEach((p, i) => {
        const x = (p.t / 480) * W;
        const y = H - (p[key] / maxY) * (H - 26);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    };
    // SIBO / IMO thresholds
    const yLine = (val, color) => {
      const y = H - (val / maxY) * (H - 26);
      ctx.strokeStyle = color; ctx.setLineDash([6, 6]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      ctx.setLineDash([]);
    };
    yLine(20, 'rgba(245,158,11,0.55)');
    yLine(10, 'rgba(6,182,212,0.55)');
    plot('H2', 'rgba(16,185,129,0.95)', 2.6);
    plot('CH4', 'rgba(6,182,212,0.95)', 2.4);
    plot('H2S', 'rgba(245,158,11,0.9)', 1.8);
    ctx.font = '700 16px JetBrains Mono';
    ctx.fillStyle = '#10b981'; ctx.fillText('H2', 12, 24);
    ctx.fillStyle = '#06b6d4'; ctx.fillText('CH4', 60, 24);
    ctx.fillStyle = '#f59e0b'; ctx.fillText('H2S', 116, 24);
  }

  async function save() {
    try {
      await vaultPut('fodmap_fermentation_plans', {
        grams, glucoseG, fatG, methanogenLoad, sibo,
        totalG: stack.total, h2Peak: ode.peakH2, ch4Peak: ode.peakCH4,
        siboPositive: ode.siboPositive, imoPositive: ode.imoPositive,
        enzymes, osmoticMl: osm.volumeMl, tensionKpa: tension.T
      });
      saved = `FODMAP plan saved ${new Date().toLocaleTimeString()}`;
    } catch (e) { saved = `Vault error: ${e.message}`; }
  }

  async function runPython() {
    const py = await callPython('fodmap', {
      ...grams, glucose_g: glucoseG, fat_g: fatG, weight_kg: weightKg,
      methanogen_load: methanogenLoad, pressure_kpa: pressureKpa, radius_cm: radiusCm
    });
    if (!py.fallback && py.data?.fermentation) {
      engine = `Python 3.12 · ${py.latencyMs.toFixed(1)} ms`;
      ode = {
        series: py.data.fermentation.series.map((p) => ({ t: p.t, S: p.S, H2: p.H2, CH4: p.CH4, H2S: p.H2S })),
        peakH2: py.data.fermentation.peak_H2_ppm,
        peakCH4: py.data.fermentation.peak_CH4_ppm,
        h2Rise90: py.data.fermentation.h2_rise_90min_ppm,
        siboPositive: py.data.fermentation.sibo_positive,
        imoPositive: py.data.fermentation.imo_positive,
        criteria: { sibo: py.data.fermentation.criteria.sibo, imo: py.data.fermentation.criteria.imo }
      };
      draw();
    } else {
      engine = `ES2024 mirror · ${py.latencyMs.toFixed(1)} ms (Python offline)`;
    }
  }

  $: {
    // Any clinical input change invalidates the whole gas-kinetics solution.
    grams;
    glucoseG;
    methanogenLoad;
    pressureKpa;
    sibo;
    yH2;
    kmeth;
    kmGlut5;
    glut5Capacity;
    radiusCm;
    wallMm;
    fatG;
    weightKg;
    recompute();
  }
</script>

<section>
  <div class="grid-2" style="align-items:start;">
    <div class="glass-card">
      <div class="kpi-label">Module 3 · Monash FODMAP Stacking & Fermentation Kinetics</div>
      <h2 style="margin:4px 0 12px; font-size:20px;">SIBO / IMO Gas-Kinetics Architect</h2>

      <div style="display:flex; flex-wrap:wrap; gap:6px;">
        {#each MEAL_PRESETS as p}
          <button class="btn" on:click={() => loadPreset(p.id)}>{p.label}</button>
        {/each}
      </div>

      <div style="margin-top:14px; display:grid; gap:8px;">
        {#each FODMAP_GROUPS as g}
          <div style="display:grid; grid-template-columns:190px 1fr 66px; gap:8px; align-items:center;">
            <span class="small">{LABELS[g]}</span>
            <input type="range" min="0" max="40" step="0.1" bind:value={grams[g]} />
            <span class="mono small" style="text-align:right;">{Number(grams[g]).toFixed(1)} g</span>
          </div>
        {/each}
        <div style="display:grid; grid-template-columns:190px 1fr 66px; gap:8px; align-items:center;">
          <span class="small">Glucose rescue (dextrose)</span>
          <input type="range" min="0" max="30" step="0.5" bind:value={glucoseG} />
          <span class="mono small" style="text-align:right;">{Number(glucoseG).toFixed(1)} g</span>
        </div>
        <div style="display:grid; grid-template-columns:190px 1fr 66px; gap:8px; align-items:center;">
          <span class="small">Dietary fat (PERT dosing)</span>
          <input type="range" min="0" max="80" step="1" bind:value={fatG} />
          <span class="mono small" style="text-align:right;">{fatG} g</span>
        </div>
      </div>

      <div class="grid-3" style="margin-top:12px;">
        <div>
          <div class="kpi-label">Total FODMAP</div>
          <div class="kpi" style="color:var(--accent);">{stack.total.toFixed(1)}<span class="small"> g</span></div>
        </div>
        <div>
          <div class="kpi-label">Osmotic Jw</div>
          <div class="kpi" style="color:var(--accent-2);">{osm.volumeMl.toFixed(0)}<span class="small"> mL</span></div>
        </div>
        <div>
          <div class="kpi-label">Wall tension</div>
          <div class="kpi" style="color:{tension.T > 4.0 ? 'var(--danger)' : 'var(--amber)'};">{tension.T.toFixed(2)}<span class="small"> kPa</span></div>
        </div>
      </div>
      <div class="alert-box {stack.total > 12 ? 'warn' : 'ok'}" style="margin-top:10px;">
        <strong>{stack.verdict}</strong>
        <div class="small" style="margin-top:4px;">{glut.note}</div>
      </div>

      {#if $rbac !== 'patient'}
        <div class="grid-2" style="margin-top:12px; gap:8px;">
          <div><div class="lbl">GLUT5 Km (mM)</div><input type="number" bind:value={kmGlut5} /></div>
          <div><div class="lbl">GLUT5 capacity (g)</div><input type="number" step="0.5" bind:value={glut5Capacity} /></div>
          <div><div class="lbl">H2 yield Y</div><input type="number" step="0.5" bind:value={yH2} /></div>
          <div><div class="lbl">k_meth</div><input type="number" step="0.0002" bind:value={kmeth} /></div>
        </div>
      {/if}
    </div>

    <div>
      <div class="glass-card">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div class="kpi-label">Simulated 3-hour lactulose/glucose breath test</div>
          <span class="pill ok"><span class="dot"></span>{engine}</span>
        </div>
        <canvas class="scope" bind:this={canvas} style="height:230px; margin-top:8px;"></canvas>
        <div class="grid-4" style="margin-top:10px;">
          <div><div class="kpi-label">H2 peak</div><div class="kpi" style="font-size:22px; color:var(--accent);">{ode.peakH2.toFixed(1)}</div></div>
          <div><div class="kpi-label">CH4 peak</div><div class="kpi" style="font-size:22px; color:var(--accent-2);">{ode.peakCH4.toFixed(1)}</div></div>
          <div><div class="kpi-label">H2 rise ≤90m</div><div class="kpi" style="font-size:22px;">{ode.h2Rise90.toFixed(1)}</div></div>
          <div><div class="kpi-label">t peak</div><div class="kpi" style="font-size:22px;">{ode.tPeak ?? '—'}<span class="small"> min</span></div></div>
        </div>
        <div class="alert-box {ode.siboPositive ? 'warn' : 'ok'}" style="margin-top:10px;">
          <strong>{ode.siboPositive ? 'SIBO POSITIVE' : 'SIBO negative'}</strong> · {ode.criteria.sibo}
        </div>
        <div class="alert-box {ode.imoPositive ? 'warn' : 'ok'}" style="margin-top:8px;">
          <strong>{ode.imoPositive ? 'IMO POSITIVE' : 'IMO negative'}</strong> · {ode.criteria.imo}
        </div>
        <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
          <button class="btn" on:click={runPython}>Run Python 3.12 solver</button>
          <button class="btn primary" on:click={save}>Save plan</button>
        </div>
        {#if saved}<div class="small muted" style="margin-top:8px;">{saved}</div>{/if}
      </div>

      <div class="glass-card" style="margin-top:14px;">
        <div class="kpi-label">Precision exogenous enzyme rescue</div>
        <table class="data" style="margin-top:6px;">
          <tbody>
            <tr><td>β-Galactosidase (lactase)</td><td class="mono">{enzymes.lactaseALU.toLocaleString()} ALU</td></tr>
            <tr><td>α-Galactosidase (GOS + fructans)</td><td class="mono">{enzymes.alphaGalGALU.toLocaleString()} GALU</td></tr>
            <tr><td>Pancreatic lipase (PERT)</td><td class="mono">{enzymes.lipaseUSP.toLocaleString()} USP{enzymes.lipaseCapped ? ' (capped)' : ''}</td></tr>
          </tbody>
        </table>
        <div class="small muted" style="margin-top:6px;">{enzymes.note}</div>
        <div class="small muted" style="margin-top:4px;">{tension.painNote} Gas volume estimate {(osm.volumeMl * 0.62).toFixed(0)} mL.</div>
      </div>
    </div>
  </div>
</section>
