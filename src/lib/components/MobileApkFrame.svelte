<script>
  import { gyroTilt } from '$lib/gastroStore.js';
  import { onMount } from 'svelte';

  export let title = 'GASTRO-SPECTRA';
  let clock = '';
  let battery = 87;

  onMount(() => {
    const tick = () => {
      const d = new Date();
      clock = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };
    tick();
    const id = setInterval(tick, 20000);
    return () => clearInterval(id);
  });
</script>

<div class="phone-frame" style="transform: perspective(1200px) rotateY({$gyroTilt.y * 0.35}deg) rotateX({-$gyroTilt.x * 0.35}deg);">
  <div class="phone-notch"></div>
  <div class="phone-status">
    <span>{clock}</span>
    <span>◐ {battery}% · 5G</span>
  </div>
  <div class="phone-screen">
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
      <strong style="font-size:13px;">{title}</strong>
      <span class="pill ok"><span class="dot"></span>APK BRIDGE</span>
    </div>
    <slot />
  </div>
  <div style="display:grid; place-items:center; padding-top:8px; color:#5b6b85; font:600 10px var(--mono);">
    com.gastrospectra.clinical
  </div>
</div>
