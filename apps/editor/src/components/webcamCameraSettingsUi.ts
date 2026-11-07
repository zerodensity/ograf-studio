import type {
  WebcamCameraCapabilities,
  WebcamCaptureSettings,
  WebcamNumberRange,
} from '../state/webcamPreview';

export const CAMERA_RESOLUTIONS = [
  [640, 480],
  [1280, 720],
  [1920, 1080],
  [2560, 1440],
  [3840, 2160],
] as const;
export const CAMERA_FRAME_RATES = [15, 24, 25, 29.97, 30, 50, 59.94, 60, 120];

export function cameraRangeAllows(value: number, range?: WebcamNumberRange): boolean {
  if (!range) return true;
  if (value < range.min || value > range.max) return false;
  if (!range.step || range.step <= 0) return true;
  const steps = (value - range.min) / range.step;
  return Math.abs(steps - Math.round(steps)) < 0.0001;
}

export function cameraResolutionChoices(capabilities: WebcamCameraCapabilities | null) {
  return CAMERA_RESOLUTIONS.filter(
    ([width, height]) =>
      cameraRangeAllows(width, capabilities?.width) &&
      cameraRangeAllows(height, capabilities?.height),
  );
}

export function cameraFrameRateChoices(capabilities: WebcamCameraCapabilities | null) {
  return CAMERA_FRAME_RATES.filter((value) => cameraRangeAllows(value, capabilities?.frameRate));
}

export function cameraResolutionChoice(
  settings: WebcamCaptureSettings,
  capabilities: WebcamCameraCapabilities | null,
) {
  if (settings.width === undefined && settings.height === undefined) return 'auto';
  const preset = cameraResolutionChoices(capabilities).find(
    ([width, height]) => settings.width === width && settings.height === height,
  );
  return preset ? preset.join('x') : 'custom';
}

export function cameraFrameRateChoice(
  settings: WebcamCaptureSettings,
  capabilities: WebcamCameraCapabilities | null,
) {
  if (settings.frameRate === undefined) return 'auto';
  return cameraFrameRateChoices(capabilities).includes(settings.frameRate)
    ? String(settings.frameRate)
    : 'custom';
}

export function cameraCaptureSummary(settings: WebcamCaptureSettings | null) {
  if (!settings) return 'Not running';
  const size =
    settings.width !== undefined && settings.height !== undefined
      ? `${settings.width} × ${settings.height}`
      : 'Resolution unavailable';
  return settings.frameRate === undefined
    ? size
    : `${size} · ${Number(settings.frameRate.toFixed(2))} FPS`;
}
