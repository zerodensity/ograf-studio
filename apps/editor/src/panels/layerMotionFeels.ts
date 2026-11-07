import type { EasingPreset } from '@ograf-editor/scene-model';

/** Friendly easing names shared by the picker and its documentation checks. */
export const LAYER_MOTION_FEELS: Array<{ label: string; in: EasingPreset; out: EasingPreset }> = [
  { label: 'Smooth', in: 'cubic-out', out: 'cubic-in' },
  { label: 'Gentle', in: 'sine-out', out: 'sine-in' },
  { label: 'Snappy', in: 'expo-out', out: 'expo-in' },
  { label: 'Overshoot', in: 'back-out', out: 'back-in' },
  { label: 'Bounce', in: 'bounce-out', out: 'bounce-in' },
  { label: 'Elastic', in: 'elastic-out', out: 'elastic-in' },
  { label: 'Linear', in: 'linear', out: 'linear' },
];
