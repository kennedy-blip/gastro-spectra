<script>
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import {
    activeModule, theme, layoutMode, ecoGlass, bowelSoundsPerMin,
    lumenGasPressureKpa, phLevel, motilityState, gyroTilt, rbac
  } from '$lib/gastroStore.js';
  import HeaderWorkstation from '$lib/components/HeaderWorkstation.svelte';
  import GooeyNavDock from '$lib/components/GooeyNavDock.svelte';
  import MobileApkFrame from '$lib/components/MobileApkFrame.svelte';
  import HardwareGatekeeperModal from '$lib/components/HardwareGatekeeperModal.svelte';
  import PolyglotAdminModal from '$lib/components/PolyglotAdminModal.svelte';
  import ApkDownloadModal from '$lib/components/ApkDownloadModal.svelte';
  import PhonoEnterographyLab from '$lib/components/modules/PhonoEnterographyLab.svelte';
  import SwallowRefluxClinometerLab from '$lib/components/modules/SwallowRefluxClinometerLab.svelte';
  import FodmapSiboFermentationLab from '$lib/components/modules/FodmapSiboFermentationLab.svelte';
  import OpticalStoolPrepScanner from '$lib/components/modules/OpticalStoolPrepScanner.svelte';
  import HepatologyEndoscopyAuditor from '$lib/components/modules/HepatologyEndoscopyAuditor.svelte';
  import underlayShader from '$lib/../shaders/peristaltic_fluid_underlay.glsl?raw';
  import { exportClinicalReport, printClinicalSummary, installOnlineReplay, openVault } from '$lib/db/indexedDbGastroVault.js';

  let showApk = false;
  let showGate = false;
  let showAdmin = false;
  let glCanvas;
  let gl = null;
  let program = null;
  let rafId = 0;
  let frameCount = 0;
  let lastFrame = 0;
  let lastPaint = 0;
  let glError = '';
  let reportNote = '';

  const VERT = `#version 300 es
  in vec2 aPos;
  out vec2 vUv;
  void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

  onMount(() => {
    // restore theme
    try {
      const saved = localStorage.getItem('gastro-theme');
      if (saved) {
        theme.set(saved);
        ecoGlass.set(saved === 'eco');
        document.documentElement.setAttribute('data-theme', saved);
      }
    } catch { /* private mode */ }

    const unsubscribeTheme = theme.subscribe((t) => {
      if (typeof document !== 'undefined') document.documentElement.setAttribute('data-theme', t);
    });

    initUnderlay();

    const pointer = (e) => {
      if (!gl || !program) return;
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = (e.clientY / window.innerHeight) * 2 - 1;
      gl.uniform2f(gl.getUniformLocation(program, 'u_pointer'), nx, -ny);
      document.documentElement.style.setProperty('--spec-angle', `${((Math.atan2(ny, nx) * 180) / Math.PI + 360) % 360}deg`);
    };
    const motion = (e) => {
      const beta = e.beta ?? 0;
      const gamma = e.gamma ?? 0;
      gyroTilt.set({ x: beta, y: gamma });
      if (gl && program) gl.uniform2f(gl.getUniformLocation(program, 'u_gyroTilt'), gamma / 45, beta / 45);
    };
    window.addEventListener('pointermove', pointer);
    window.addEventListener('deviceorientation', motion);
    const stopReplay = installOnlineReplay();
    openVault().catch(() => {});

    return () => {
      unsubscribeTheme();
      window.removeEventListener('pointermove', pointer);
      window.removeEventListener('deviceorientation', motion);
      stopReplay();
      if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(rafId);
    };
  });

  onDestroy(() => { if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(rafId); });

  function initUnderlay() {
    gl = glCanvas.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'low-power' });
    if (!gl) { glError = 'WebGL2 unavailable — static procedural gradient underlay active'; return; }
    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      return sh;
    };
    try {
      const vs = compile(gl.VERTEX_SHADER, VERT);
      const fs = compile(gl.FRAGMENT_SHADER, underlayShader);
      program = gl.createProgram();
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      gl.useProgram(program);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(program, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      resize();
      window.addEventListener('resize', resize);
      rafId = requestAnimationFrame(loop);
    } catch (e) {
      glError = `Shader error: ${e.message}`;
    }
  }

  function resize() {
    if (!glCanvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    glCanvas.width = Math.floor(window.innerWidth * dpr);
    glCanvas.height = Math.floor(window.innerHeight * dpr);
    if (gl) gl.viewport(0, 0, glCanvas.width, glCanvas.height);
  }

  function loop(now) {
    rafId = requestAnimationFrame(loop);
    if (!gl || !program) return;
    const eco = get(ecoGlass) || get(theme) === 'eco';
    const minDelta = eco ? 1000 / 15 : 1000 / 60;
    if (now - lastPaint < minDelta) return;
    lastPaint = now;
    frameCount++;
    const alertLevel = (() => {
      const m = get(motilityState);
      return m === 'obstruction' || m === 'ileus' ? 2 : m === 'borborygmi' ? 1 : 0;
    })();
    gl.uniform1f(gl.getUniformLocation(program, 'u_time'), now / 1000);
    gl.uniform1f(gl.getUniformLocation(program, 'u_bowelSoundsPerMin'), get(bowelSoundsPerMin));
    gl.uniform1f(gl.getUniformLocation(program, 'u_lumenGasPressureKpa'), get(lumenGasPressureKpa));
    gl.uniform1f(gl.getUniformLocation(program, 'u_phLevel'), get(phLevel));
    gl.uniform1f(gl.getUniformLocation(program, 'u_alert'), alertLevel);
    gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), glCanvas.width, glCanvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  async function handleReport() {
    try {
      const report = await exportClinicalReport();
      printClinicalSummary(report);
      reportNote = 'Clinical JSON report exported + printable physician summary opened.';
      setTimeout(() => (reportNote = ''), 4000);
    } catch (e) {
      reportNote = `Export failed: ${e.message}`;
    }
  }
</script>

<svelte:head>
  <title>GASTRO-SPECTRA · Clinical GI Acoustics & Fermentation Workstation</title>
</svelte:head>

<canvas id="gl-underlay" bind:this={glCanvas} aria-hidden="true"></canvas>

<svg class="grain-overlay" aria-hidden="true" width="100%" height="100%">
  <filter id="grain">
    <feTurbulence type="fractalNoise" baseFrequency="0.78" numOctaves="3" stitchTiles="stitch" />
  </filter>
  <rect width="100%" height="100%" filter="url(#grain)" />
</svg>

<div class="workspace" class:depth-push={showApk || showGate || showAdmin}>
  <HeaderWorkstation
    onApk={() => (showApk = true)}
    onGatekeeper={() => (showGate = true)}
    onAdmin={() => (showAdmin = true)}
    onReport={handleReport}
  />

  {#if glError}
    <div class="alert-box warn" style="margin-bottom:12px;">{glError}</div>
  {/if}
  {#if reportNote}
    <div class="alert-box ok" style="margin-bottom:12px;">{reportNote}</div>
  {/if}

  {#if $layoutMode === 'desktop'}
    <main class="glass-deck" style="padding:16px;">
      {#if $activeModule === 'peg'}
        <PhonoEnterographyLab />
      {:else if $activeModule === 'swallow'}
        <SwallowRefluxClinometerLab />
      {:else if $activeModule === 'fodmap'}
        <FodmapSiboFermentationLab />
      {:else if $activeModule === 'optical'}
        <OpticalStoolPrepScanner />
      {:else if $activeModule === 'hepatology'}
        <HepatologyEndoscopyAuditor />
      {/if}
    </main>

    <div style="display:flex; flex-wrap:wrap; gap:10px; margin-top:12px; justify-content:space-between;">
      <div class="small muted" style="max-width:760px;">
        Clinical decision-support only — not a substitute for physician diagnosis. All acoustic, optical and
        biochemical computations run locally (IndexedDB vault) and mirror the Python 3.12 solvers deterministically.
      </div>
      <div style="display:flex; gap:8px;">
        <span class="pill ok"><span class="dot"></span>{$activeModule.toUpperCase()}</span>
        <span class="pill"><span class="dot"></span>{$rbac.toUpperCase()}</span>
      </div>
    </div>
  {:else}
    <div style="display:grid; place-items:start center;">
      <MobileApkFrame title="GASTRO-SPECTRA · APK Preview">
        <div class="seg" style="width:100%; margin-bottom:8px;">
          {#each [['peg', 'PEG'], ['swallow', 'Swallow'], ['fodmap', 'FODMAP'], ['optical', 'Optical'], ['hepatology', 'Hep']] as m}
            <button style="flex:1; font-size:10px; padding:6px 2px;" class:active={$activeModule === m[0]} on:click={() => ($activeModule = m[0])}>{m[1]}</button>
          {/each}
        </div>
        {#if $activeModule === 'peg'}
          <PhonoEnterographyLab />
        {:else if $activeModule === 'swallow'}
          <SwallowRefluxClinometerLab />
        {:else if $activeModule === 'fodmap'}
          <FodmapSiboFermentationLab />
        {:else if $activeModule === 'optical'}
          <OpticalStoolPrepScanner />
        {:else}
          <HepatologyEndoscopyAuditor />
        {/if}
      </MobileApkFrame>
      <div class="small muted" style="margin-top:8px; text-align:center;">
        Interactive bezel preview — the identical shell ships in the Capacitor APK.
      </div>
    </div>
  {/if}
</div>

<GooeyNavDock />

{#if showApk}
  <ApkDownloadModal on:close={() => (showApk = false)} />
{/if}
{#if showGate}
  <HardwareGatekeeperModal on:close={() => (showGate = false)} />
{/if}
{#if showAdmin}
  <PolyglotAdminModal on:close={() => (showAdmin = false)} />
{/if}

<style>
  :global(body) { min-height: 100vh; }
</style>
