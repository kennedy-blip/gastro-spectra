<script>
  import { theme, rbac, layoutMode, ecoGlass } from '$lib/gastroStore.js';

  export let onApk = () => {};
  export let onGatekeeper = () => {};
  export let onAdmin = () => {};
  export let onReport = () => {};

  const themes = [
    { id: 'obsidian', label: 'Obsidian Endoscopy' },
    { id: 'daylight', label: 'Daylight Ward' },
    { id: 'nocturnal', label: 'Nocturnal Darkroom' },
    { id: 'eco', label: 'Eco-Glass' }
  ];

  function pickTheme(id) {
    $theme = id;
    $ecoGlass = id === 'eco';
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', id);
      try { localStorage.setItem('gastro-theme', id); } catch { /* private mode */ }
    }
  }

  function pickRbac(e) {
    $rbac = e.currentTarget.value;
  }
</script>

<header class="glass-deck header-bar">
  <div style="display:flex; align-items:center; gap:12px;">
    <div class="logo" aria-hidden="true">
      <svg viewBox="0 0 44 44" width="42" height="42">
        <defs>
          <linearGradient id="gsp" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#10b981" />
            <stop offset="100%" stop-color="#06b6d4" />
          </linearGradient>
        </defs>
        <circle cx="22" cy="22" r="20" fill="none" stroke="url(#gsp)" stroke-width="2" />
        <path d="M10 22c4-9 8 9 12 0s8 9 12 0" fill="none" stroke="url(#gsp)" stroke-width="2.6" stroke-linecap="round" />
        <circle cx="22" cy="31" r="2.2" fill="#f59e0b" />
      </svg>
    </div>
    <div>
      <div style="font:800 17px var(--font); letter-spacing:.02em;">GASTRO-SPECTRA</div>
      <div class="small muted mono">v29.0.0-polyglot · GI acoustics · fermentation · optics · hepatology</div>
    </div>
  </div>

  <div class="header-controls">
    <div class="seg" role="group" aria-label="Theme">
      {#each themes as t}
        <button class:active={$theme === t.id} on:click={() => pickTheme(t.id)} title={t.label}>
          {t.label.split(' ')[0]}
        </button>
      {/each}
    </div>

    <div class="seg" role="group" aria-label="Layout">
      <button class:active={$layoutMode === 'desktop'} on:click={() => ($layoutMode = 'desktop')}>Desktop Workstation</button>
      <button class:active={$layoutMode === 'mobile'} on:click={() => ($layoutMode = 'mobile')}>Mobile APK Frame</button>
    </div>

    <select aria-label="Access tier" value={$rbac} on:change={pickRbac} title="Role-based access tier">
      <option value="patient">Patient & Digestive Tracker</option>
      <option value="pro">Gastroenterologist / Hepatologist</option>
      <option value="admin">Systems Architect</option>
    </select>

    <button class="btn ghost" on:click={onGatekeeper} title="Hardware permissions">🛡 Sensors</button>
    <button class="btn ghost" on:click={onReport} title="Export clinical report">⬇ Report</button>
    {#if $rbac === 'admin'}
      <button class="btn ghost" on:click={onAdmin} title="Polyglot runtime inspector">⚙ Runtime</button>
    {/if}
    <button class="btn primary" on:click={onApk}>📱 Get .APK</button>
  </div>
</header>

<style>
  .logo { display: grid; place-items: center; filter: drop-shadow(0 4px 14px rgba(16, 185, 129, .35)); }
  header { margin-bottom: 12px; }
</style>
