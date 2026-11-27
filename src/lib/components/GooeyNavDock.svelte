<script>
  import { MODULES, activeModule } from '$lib/gastroStore.js';
  import { spring } from 'svelte/motion';
  import { onMount } from 'svelte';

  let buttons = [];
  let blobX = 0;
  let blobW = 0;
  const blob = spring({ x: 0, w: 0 }, { stiffness: 0.18, damping: 0.68 });

  function measure() {
    const idx = MODULES.findIndex((m) => m.id === $activeModule);
    const el = buttons[idx];
    if (!el) return;
    blobX = el.offsetLeft;
    blobW = el.offsetWidth;
    blob.set({ x: blobX, w: blobW });
  }

  $: $activeModule, measure();

  onMount(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  });
</script>

<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <defs>
    <filter id="gastro-gooey-dock">
      <feGaussianBlur in="SourceGraphic" stdDeviation="9" result="blur" />
      <feColorMatrix in="blur" mode="matrix"
        values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 21 -9" result="goo" />
      <feBlend in="SourceGraphic" in2="goo" />
    </filter>
  </defs>
</svg>

<nav class="gooey-dock" aria-label="Diagnostic modules">
  <div class="blob-inner"
    style="left:{$blob.x}px; width:{$blob.w}px; transition:none; opacity:.9;">
  </div>
  {#each MODULES as m, i}
    <button
      bind:this={buttons[i]}
      class:active={$activeModule === m.id}
      on:click={() => ($activeModule = m.id)}
      title={m.label}>
      <span style="margin-right:6px;">{m.icon}</span>{m.short}
    </button>
  {/each}
</nav>

<style>
  .gooey-dock { filter: none; }
  .blob-inner { position: absolute; top: 4px; bottom: 4px; border-radius: 999px; filter: url(#gastro-gooey-dock); }
  nav { isolation: isolate; }
</style>
