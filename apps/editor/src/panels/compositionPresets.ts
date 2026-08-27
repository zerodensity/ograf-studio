export interface CompositionPreset {
  label: string;
  width: number;
  height: number;
  frameRate: number;
}

const FULL_HD = { width: 1920, height: 1080 } as const;
const UHD = { width: 3840, height: 2160 } as const;

/**
 * Current Full HD and UHD broadcast formats. Fractional NTSC rates use their exact rational values
 * so editor timing and exported OGraf render requirements do not drift against playout clocks.
 */
export const COMPOSITION_PRESETS: CompositionPreset[] = [
  { label: 'Full HD 1080p · 25 fps', ...FULL_HD, frameRate: 25 },
  { label: 'Full HD 1080p · 29.97 fps', ...FULL_HD, frameRate: 30_000 / 1_001 },
  { label: 'Full HD 1080p · 30 fps', ...FULL_HD, frameRate: 30 },
  { label: 'Full HD 1080p · 50 fps', ...FULL_HD, frameRate: 50 },
  { label: 'Full HD 1080p · 59.94 fps', ...FULL_HD, frameRate: 60_000 / 1_001 },
  { label: 'Full HD 1080p · 60 fps', ...FULL_HD, frameRate: 60 },
  { label: 'UHD 2160p · 25 fps', ...UHD, frameRate: 25 },
  { label: 'UHD 2160p · 29.97 fps', ...UHD, frameRate: 30_000 / 1_001 },
  { label: 'UHD 2160p · 30 fps', ...UHD, frameRate: 30 },
  { label: 'UHD 2160p · 50 fps', ...UHD, frameRate: 50 },
  { label: 'UHD 2160p · 59.94 fps', ...UHD, frameRate: 60_000 / 1_001 },
  { label: 'UHD 2160p · 60 fps', ...UHD, frameRate: 60 },
];

const FRAME_RATE_EPSILON = 0.001;

export function matchesCompositionPreset(
  preset: CompositionPreset,
  width: number,
  height: number,
  frameRate: number,
): boolean {
  return (
    preset.width === width &&
    preset.height === height &&
    Math.abs(preset.frameRate - frameRate) < FRAME_RATE_EPSILON
  );
}
