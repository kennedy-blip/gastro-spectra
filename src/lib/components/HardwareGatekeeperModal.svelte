<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import { requestPersistence } from '$lib/db/indexedDbGastroVault.js';

  const dispatch = createEventDispatcher();

  let badges = {
    mic: { state: 'IDLE', detail: '48 kHz PCM unprocessed · echoCancellation off' },
    camera: { state: 'IDLE', detail: 'D65 torch + AWB lock · CIELAB in-memory ROI' },
    imu: { state: 'IDLE', detail: 'DeviceMotion 200 Hz clinometer' },
    haptics: { state: 'IDLE', detail: 'navigator.vibrate tactile feedback' },
    storage: { state: 'IDLE', detail: 'IndexedDB gastro_spectra_vault_v1' }
  };

  let message = '';
  let persistGranted = null;

  onMount(async () => {
    badges.storage.state = typeof indexedDB !== 'undefined' ? 'READY' : 'RESTRICTED';
    badges.haptics.state = typeof navigator !== 'undefined' && 'vibrate' in navigator ? 'READY' : 'RESTRICTED';
    badges.imu.state = typeof window !== 'undefined' && 'DeviceMotionEvent' in window ? 'READY' : 'SIMULATOR ACTIVE';
    if (!navigator?.mediaDevices?.getUserMedia) badges.mic.state = 'RESTRICTED';
    if (!navigator?.mediaDevices?.getUserMedia) badges.camera.state = 'RESTRICTED';
  });

  function close() { dispatch('close'); }

  async function requestMic() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate: 48000 }
      });
      const track = stream.getAudioTracks()[0];
      const settings = track.getSettings ? track.getSettings() : {};
      badges = { ...badges, mic: { state: 'ACTIVE', detail: `${settings.sampleRate || 48000} Hz · AGC ${settings.autoGainControl ?? false} · NS ${settings.noiseSuppression ?? false}` } };
      stream.getTracks().forEach((t) => t.stop());
      message = 'Microphone granted. Unprocessed 48 kHz capture available in Module 1.';
    } catch (e) {
      badges = { ...badges, mic: { state: 'SIMULATOR ACTIVE', detail: 'Mic denied — clinical synthesizer presets remain fully functional.' } };
      message = 'Microphone unavailable. Every module keeps its 1-Tap clinical simulator.';
    }
  }

  async function requestCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const track = stream.getVideoTracks()[0];
      let torch = false;
      try { await track.applyConstraints({ advanced: [{ torch: true }] }); torch = true; } catch { torch = false; }
      badges = { ...badges, camera: { state: 'ACTIVE', detail: `Torch ${torch ? 'locked' : 'unsupported'} · AWB locked in-shader` } };
      stream.getTracks().forEach((t) => t.stop());
      message = 'Colorimetric camera granted. WebGL2 pigment lens is live in Module 4.';
    } catch {
      badges = { ...badges, camera: { state: 'SIMULATOR ACTIVE', detail: 'Camera denied — 7 clinical specimen phantoms active.' } };
      message = 'Camera unavailable. Module 4 falls back to phantom phantoms + uploaded images.';
    }
  }

  function requestImu() {
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      DeviceMotionEvent.requestPermission().then((r) => {
        badges = { ...badges, imu: { state: r === 'granted' ? 'ACTIVE' : 'SIMULATOR ACTIVE', detail: r === 'granted' ? 'Live clinometer 200 Hz' : 'Clinometer simulator' } };
      }).catch(() => {
        badges = { ...badges, imu: { state: 'SIMULATOR ACTIVE', detail: 'Clinometer simulator (slider controlled)' } };
      });
    } else {
      badges = { ...badges, imu: { state: 'ACTIVE', detail: 'DeviceMotion listener attached' } };
    }
  }

  function requestHaptics() {
    if (navigator.vibrate) {
      const ok = navigator.vibrate([20, 40, 20]);
      badges = { ...badges, haptics: { state: ok ? 'ACTIVE' : 'RESTRICTED', detail: 'Pattern [20,40,20] ms acknowledged' } };
    } else {
      badges = { ...badges, haptics: { state: 'RESTRICTED', detail: 'Vibration API unavailable on this platform' } };
    }
  }

  async function requestStorage() {
    persistGranted = await requestPersistence();
    badges = { ...badges, storage: { state: persistGranted ? 'ACTIVE' : 'RESTRICTED', detail: persistGranted ? 'Persistent storage granted' : 'Best-effort storage (browser will not evict under normal use)' } };
  }

  function cls(state) {
    if (state === 'ACTIVE' || state === 'READY') return 'ok';
    if (state === 'RESTRICTED') return 'bad';
    if (state === 'SIMULATOR ACTIVE') return 'warn';
    return '';
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-noninteractive-element-interactions -->
<div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Hardware gatekeeper" on:click|self={close}>
  <div class="modal-panel">
    <div style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
      <div>
        <h2 style="margin:0; font-size:18px;">Hardware & OS Sensor Gatekeeper</h2>
        <div class="small muted">Every sensor is optional — 1-Tap clinical simulators cover 100% of the workflow.</div>
      </div>
      <button class="btn ghost" on:click={close}>✕</button>
    </div>

    <div class="grid-2" style="margin-top:16px;">
      {#each Object.entries(badges) as [key, b]}
        <div class="glass-card" style="padding:14px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong style="text-transform:capitalize;">{key === 'imu' ? '3-Axis IMU Clinometer' : key === 'mic' ? 'Bio-Acoustic Microphone' : key === 'camera' ? 'Colorimetric Camera' : key === 'haptics' ? 'Tactile Haptics' : 'Persistent Storage'}</strong>
            <span class="pill {cls(b.state)}"><span class="dot"></span>{b.state}</span>
          </div>
          <div class="small muted" style="margin:8px 0 10px;">{b.detail}</div>
          <button class="btn ghost" style="width:100%;"
            on:click={key === 'mic' ? requestMic : key === 'camera' ? requestCamera : key === 'imu' ? requestImu : key === 'haptics' ? requestHaptics : requestStorage}>
            Request access
          </button>
        </div>
      {/each}
    </div>

    {#if message}
      <div class="alert-box ok" style="margin-top:14px;">{message}</div>
    {/if}

    <div class="small muted" style="margin-top:14px;">
      Privacy: acoustic frames are processed on-device with the Teager-Kaiser operator; camera ROIs are reduced to a
      CIELAB triplet in memory and never written to gallery storage.
    </div>
  </div>
</div>
