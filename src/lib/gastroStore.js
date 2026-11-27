import { writable } from 'svelte/store';

/** Shared clinical telemetry bus — drives WebGL2 shader uniforms + cross-module readouts. */
export const bowelSoundsPerMin = writable(12);
export const lumenGasPressureKpa = writable(0.8);
export const phLevel = writable(4.2);
export const motilityState = writable('normoactive');
export const activeModule = writable('peg');
export const theme = writable('obsidian');
export const rbac = writable('patient');
export const layoutMode = writable('desktop');
export const ecoGlass = writable(false);
export const gyroTilt = writable({ x: 0, y: 0 });

export const MODULES = [
  { id: 'peg', label: 'Phonoenterography', short: 'PEG', icon: '🎙️' },
  { id: 'swallow', label: 'Swallow & Reflux', short: 'SWAL', icon: '🗣️' },
  { id: 'fodmap', label: 'FODMAP · SIBO', short: 'FOD', icon: '🧪' },
  { id: 'optical', label: 'Optical · BBPS', short: 'OPT', icon: '🔬' },
  { id: 'hepatology', label: 'Hepatology · CPT', short: 'HEP', icon: '🏥' }
];
