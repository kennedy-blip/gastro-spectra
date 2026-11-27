<script>
  import { onMount } from 'svelte';
  import { PHANTOMS, rgbToLab, classifyPigment, bbpsScore, bristolFromLab, sampleCanvasROI } from '$lib/engines/stoolPrepColorimeterEngine.js';
  import { vaultPut } from '$lib/db/indexedDbGastroVault.js';
  import chromaShader from '../../../shaders/gastro_chroma_segmentation_lens.glsl?raw';
  import { rbac } from '$lib/gastroStore.js';

  let glCanvas;
  let gl = null, program = null, texture = null, vao = null;
  let useWebGL = false;
  let privacyMode = false;
  let d65Adapt = 0.85;
  let pigmentMode = 0;
  let phantomId = 'bristol4';
  let rgb = [...PHANTOMS[0].rgb];
  let lab = rgbToLab(rgb);
  let pigment = classifyPigment(lab);
  let bbps = bbpsScore(lab);
  let uploaded = null;
  let segments = [2, 2, 2];
  let saved = '';
  let raf = 0;
  let startTime = performance.now();
  let fileInput;
  let sourceCanvas;

  const VERT = `#version 300 es
in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

  onMount(() => {
    sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = 512;
    sourceCanvas.height = 512;
    initGL();
    paintSource();
    if (gl) raf = requestAnimationFrame(loop);
    return () => { if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(raf); };
  });

  function initGL() {
    gl = glCanvas.getContext('webgl2', { alpha: false, antialias: false });
    if (!gl) { useWebGL = false; return; }
    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(sh) || 'shader compile failed');
      }
      return sh;
    };
    try {
      const vs = compile(gl.VERTEX_SHADER, VERT);
      const fs = compile(gl.FRAGMENT_SHADER, chromaShader);
      program = gl.createProgram();
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      gl.useProgram(program);
      vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(program, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      useWebGL = true;
    } catch (e) {
      useWebGL = false;
      gl = null;
    }
  }

  function paintSource() {
    if (!sourceCanvas) return;
    const ctx = sourceCanvas.getContext('2d');
    ctx.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    ctx.fillRect(0, 0, 512, 512);
    // procedural specimen texture: mottling + contour rings for Sobel/Gabor response
    let seed = rgb[0] * 31 + rgb[1] * 17 + rgb[2] * 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = 0; i < 900; i++) {
      const x = rnd() * 512, y = rnd() * 512, r = 2 + rnd() * 26;
      const d = (rnd() - 0.5) * 34;
      ctx.fillStyle = `rgba(${Math.max(0, Math.min(255, rgb[0] + d))}, ${Math.max(0, Math.min(255, rgb[1] + d))}, ${Math.max(0, Math.min(255, rgb[2] + d))}, 0.20)`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    for (let i = 0; i < 14; i++) {
      ctx.beginPath();
      ctx.ellipse(256 + (rnd() - 0.5) * 300, 256 + (rnd() - 0.5) * 300, 30 + rnd() * 90, 18 + rnd() * 60, rnd() * 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (gl && texture) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);
    }
  }

  function loop() {
    if (!useWebGL || !gl) { raf = requestAnimationFrame(loop); return; }
    const t = (performance.now() - startTime) / 1000;
    gl.viewport(0, 0, glCanvas.width, glCanvas.height);
    gl.useProgram(program);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    const set1i = (n, v) => gl.uniform1i(gl.getUniformLocation(program, n), v);
    const set1f = (n, v) => gl.uniform1f(gl.getUniformLocation(program, n), v);
    const set2f = (n, a, b) => gl.uniform2f(gl.getUniformLocation(program, n), a, b);
    set1i('u_texture', 0);
    set1f('u_time', t);
    set1f('u_privacyMode', privacyMode ? 1 : 0);
    set1f('u_d65Adapt', d65Adapt);
    set1f('u_bbpsTurbidity', Math.max(0, Math.min(1, 1 - bbps.segment / 3)));
    set1f('u_pigmentMode', pigmentMode);
    set2f('u_resolution', glCanvas.width, glCanvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    raf = requestAnimationFrame(loop);
  }

  function selectPhantom(id) {
    phantomId = id;
    const p = PHANTOMS.find((x) => x.id === id);
    rgb = [...p.rgb];
    uploaded = null;
    recompute();
    paintSource();
  }

  function recompute() {
    lab = rgbToLab(rgb);
    pigment = classifyPigment(lab);
    bbps = bbpsScore(lab);
    if (pigment.id === 'prep_clear') segments = [3, 3, 3];
    else if (pigment.id === 'prep_amber') segments = [1, 1, 1];
    else segments = segments;
  }

  function onUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = 512; c.height = 512;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, 512, 512);
      sourceCanvas = c;
      const l = sampleCanvasROI(c, 0.25, 0.25, 0.5, 0.5);
      lab = l;
      rgb = [Math.round(l.L), 0, 0];
      pigment = classifyPigment(l);
      bbps = bbpsScore(l);
      uploaded = file.name;
      if (gl && texture) {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
      }
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  }

  async function save() {
    try {
      await vaultPut('optical_pigment_prep_audits', {
        phantomId, uploaded, rgb, lab, pigment: pigment.id,
        bristol: bristolFromLab(lab), bbpsSegments: segments,
        bbpsTotal: segments.reduce((a, b) => a + b, 0), privacyMode
      });
      saved = `Optical audit saved ${new Date().toLocaleTimeString()}`;
    } catch (e) { saved = `Vault error: ${e.message}`; }
  }

  $: total = segments.reduce((a, b) => a + b, 0);
  $: adequate = total >= 6 && segments.every((s) => s >= 2);
  $: if (gl) { /* uniforms read reactively inside the RAF loop */ }
</script>

<section>
  <div class="grid-2" style="align-items:start;">
    <div class="glass-card">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div class="kpi-label">Module 4 · Optical Colorimeter</div>
          <h2 style="margin:4px 0 0; font-size:20px;">Bristol · Acholic · Melena · BBPS Lens</h2>
        </div>
        <span class="pill" class:ok={useWebGL} class:warn={!useWebGL}>
          <span class="dot"></span>{useWebGL ? 'WebGL2 60 FPS' : 'CPU fallback'}
        </span>
      </div>

      <canvas bind:this={glCanvas} width="512" height="330"
        style="width:100%; height:330px; border-radius:16px; margin-top:10px; border:1px solid var(--border); display:block; background:#111;"></canvas>

      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;">
        <button class="btn" class:active={privacyMode} on:click={() => (privacyMode = !privacyMode)}>
          {privacyMode ? '🙈 Privacy contour mode ON' : '👁 Privacy contour mode OFF'}
        </button>
        <div class="seg">
          {#each [['0', 'Natural'], ['1', 'Stercobilin'], ['2', 'Acholic'], ['3', 'Melena'], ['4', 'Heme']] as opt}
            <button class:active={pigmentMode === Number(opt[0])} on:click={() => (pigmentMode = Number(opt[0]))}>{opt[1]}</button>
          {/each}
        </div>
        <button class="btn ghost" on:click={() => fileInput.click()}>⬆ Upload specimen photo</button>
        <input bind:this={fileInput} type="file" accept="image/*" on:change={onUpload} style="display:none" />
      </div>

      <div class="kpi-label" style="margin-top:14px;">1-Tap clinical specimen phantoms</div>
      <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:6px;">
        {#each PHANTOMS as p}
          <button class="btn" class:primary={phantomId === p.id} on:click={() => selectPhantom(p.id)}>{p.label}</button>
        {/each}
      </div>

      {#if $rbac !== 'patient'}
        <div style="margin-top:12px;">
          <div class="lbl">Bradford D65 adaptation strength: <span class="mono">{d65Adapt.toFixed(2)}</span></div>
          <input type="range" min="0" max="1" step="0.01" bind:value={d65Adapt} style="width:100%;" />
        </div>
      {/if}
    </div>

    <div>
      <div class="glass-card">
        <div class="kpi-label">CIELAB chromaticity (D65)</div>
        <div class="grid-4" style="margin-top:8px;">
          <div><div class="kpi-label">L*</div><div class="kpi" style="font-size:24px;">{lab.L.toFixed(1)}</div></div>
          <div><div class="kpi-label">a*</div><div class="kpi" style="font-size:24px;">{lab.a.toFixed(1)}</div></div>
          <div><div class="kpi-label">b*</div><div class="kpi" style="font-size:24px;">{lab.b.toFixed(1)}</div></div>
          <div><div class="kpi-label">C*ab</div><div class="kpi" style="font-size:24px;">{lab.Cab.toFixed(1)}</div></div>
        </div>
        <div style="display:flex; align-items:center; gap:10px; margin-top:10px;">
          <div style="width:54px; height:54px; border-radius:14px; border:1px solid var(--border); background:rgb({rgb[0]}, {rgb[1]}, {rgb[2]});"></div>
          <div class="small muted">
            {uploaded ? `Uploaded: ${uploaded} (in-memory only, never persisted as an image)` : 'Simulated phantom — no camera required.'}
          </div>
        </div>
        <div class="alert-box {pigment.severity === 'bad' ? 'bad' : pigment.severity === 'warn' ? 'warn' : 'ok'}" style="margin-top:10px;">
          <strong>{pigment.label}</strong>
          <div class="small" style="margin-top:4px;">{pigment.advice}</div>
        </div>
        <div class="small muted" style="margin-top:8px;">Bristol morphology estimate: type {bristolFromLab(lab)}</div>
      </div>

      <div class="glass-card" style="margin-top:14px;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div class="kpi-label">Split-dose BBPS optical clarity coach</div>
          <span class="pill" class:ok={adequate} class:warn={!adequate}><span class="dot"></span>{adequate ? 'ADEQUATE' : 'NOT READY'}</span>
        </div>
        <div class="grid-3" style="margin-top:10px;">
          {#each ['Right colon', 'Transverse', 'Left colon'] as name, i}
            <div>
              <div class="lbl">{name}</div>
              <div class="seg" style="width:100%;">
                {#each [0, 1, 2, 3] as s}
                  <button style="flex:1;" class:active={segments[i] === s} on:click={() => { segments = segments.map((v, idx) => (idx === i ? s : v)); }}>{s}</button>
                {/each}
              </div>
            </div>
          {/each}
        </div>
        <div style="display:flex; align-items:center; gap:14px; margin-top:12px;">
          <div>
            <div class="kpi-label">Total BBPS</div>
            <div class="kpi" style="color:{adequate ? 'var(--accent)' : 'var(--amber)'};">{total}<span class="small"> / 9</span></div>
          </div>
          <div class="small muted" style="flex:1;">
            Adequacy requires BBPS ≥ 6 with every segment ≥ 2. Auto-effluent reading: {bbps.label}.
          </div>
        </div>
        <button class="btn primary" style="margin-top:10px;" on:click={save}>Save optical audit</button>
        {#if saved}<div class="small muted" style="margin-top:8px;">{saved}</div>{/if}
        <div class="small muted" style="margin-top:8px;">
          Acholic L*&gt;60 &amp; C*ab&lt;13 → biliary obstruction. Melena L*&lt;17 &amp; C*ab&lt;6 (iron/bismuth gives a*&lt;−2).
        </div>
      </div>
    </div>
  </div>
</section>
