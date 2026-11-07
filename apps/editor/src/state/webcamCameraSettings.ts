export const WEBCAM_IMAGE_CONTROL_LABELS = {
  brightness: 'Brightness',
  contrast: 'Contrast',
  saturation: 'Saturation',
  sharpness: 'Sharpness',
  exposureCompensation: 'Exposure compensation',
  exposureTime: 'Exposure time',
  focusDistance: 'Focus distance',
  colorTemperature: 'Color temperature',
  zoom: 'Zoom',
  pan: 'Pan',
  tilt: 'Tilt',
  exposureMode: 'Exposure mode',
  focusMode: 'Focus mode',
  whiteBalanceMode: 'White balance mode',
  torch: 'Torch',
} as const;

export type WebcamImageControl = keyof typeof WEBCAM_IMAGE_CONTROL_LABELS;
export type WebcamControlValue = number | string | boolean;
export type WebcamControlValues = Partial<Record<WebcamImageControl, WebcamControlValue>>;
export interface WebcamNumberRange {
  min: number;
  max: number;
  step?: number;
}
export type WebcamControlCapability =
  | ({ type: 'number' } & WebcamNumberRange)
  | { type: 'mode'; values: string[] }
  | { type: 'boolean'; values: boolean[] };
export interface WebcamCaptureSettings {
  width?: number;
  height?: number;
  frameRate?: number;
  controls: WebcamControlValues;
}
export interface WebcamActualSettings extends WebcamCaptureSettings {}
export interface WebcamCameraCapabilities {
  width?: WebcamNumberRange;
  height?: WebcamNumberRange;
  frameRate?: WebcamNumberRange;
  controls: Partial<Record<WebcamImageControl, WebcamControlCapability>>;
}
export interface WebcamCameraSettingsState {
  deviceLabel: string | null;
  requested: WebcamCaptureSettings;
  actual: WebcamActualSettings | null;
  capabilities: WebcamCameraCapabilities | null;
  status: 'idle' | 'applying';
  error: string | null;
}
export const WEBCAM_MANUAL_CONTROL_MODES = {
  exposureTime: 'exposureMode',
  focusDistance: 'focusMode',
  colorTemperature: 'whiteBalanceMode',
} as const;
const modeControls = new Set<WebcamImageControl>(['exposureMode', 'focusMode', 'whiteBalanceMode']);
const controlNames = Object.keys(WEBCAM_IMAGE_CONTROL_LABELS) as WebcamImageControl[];
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function range(value: unknown): WebcamNumberRange | undefined {
  if (!object(value) || !finite(value.min) || !finite(value.max) || value.max < value.min) return;
  return {
    min: value.min,
    max: value.max,
    ...(finite(value.step) && value.step > 0 ? { step: value.step } : {}),
  };
}

export function webcamCapabilities(value: unknown): WebcamCameraCapabilities | null {
  if (!object(value)) return null;
  const result: WebcamCameraCapabilities = { controls: {} };
  for (const key of ['width', 'height', 'frameRate'] as const) {
    const limits = range(value[key]);
    if (limits && limits.min >= 0) result[key] = limits;
  }
  for (const key of controlNames) {
    const entry = value[key];
    if (key === 'torch') {
      const values =
        entry === true
          ? [false, true]
          : Array.isArray(entry)
            ? [...new Set(entry.filter((v): v is boolean => typeof v === 'boolean'))]
            : [];
      if (values.includes(true)) result.controls[key] = { type: 'boolean', values };
    } else if (modeControls.has(key)) {
      const values = Array.isArray(entry)
        ? [...new Set(entry.filter((v): v is string => typeof v === 'string' && !!v))]
        : [];
      if (values.length) result.controls[key] = { type: 'mode', values };
    } else {
      const limits = range(entry);
      if (limits) result.controls[key] = { type: 'number', ...limits };
    }
  }
  return result;
}

export function webcamActualSettings(value: unknown): WebcamActualSettings | null {
  if (!object(value)) return null;
  const result: WebcamActualSettings = { controls: {} };
  for (const key of ['width', 'height', 'frameRate'] as const)
    if (finite(value[key]) && value[key] > 0) result[key] = value[key];
  for (const key of controlNames) {
    const item = value[key];
    if (
      (key === 'torch' && typeof item === 'boolean') ||
      (modeControls.has(key) && typeof item === 'string' && !!item) ||
      (!modeControls.has(key) && key !== 'torch' && finite(item))
    )
      result.controls[key] = item as WebcamControlValue;
  }
  return result;
}

export function normalizeWebcamSettings(value: WebcamCaptureSettings): WebcamCaptureSettings {
  if (!object(value)) throw new Error('Camera settings must be an object.');
  for (const key of Object.keys(value))
    if (!['width', 'height', 'frameRate', 'controls'].includes(key))
      throw new Error(`Unknown camera setting: ${key}.`);
  const settings: WebcamCaptureSettings = { controls: {} };
  for (const key of ['width', 'height', 'frameRate'] as const) {
    const number = value[key];
    if (number === undefined) continue;
    if (
      !finite(number) ||
      number <= 0 ||
      (key !== 'frameRate' && (!Number.isInteger(number) || number > 4_294_967_295))
    )
      throw new Error(
        `${key === 'frameRate' ? 'Frame rate' : key === 'width' ? 'Width' : 'Height'} must be a positive ${key === 'frameRate' ? 'number' : 'integer'}.`,
      );
    settings[key] = number;
  }
  if (value.controls !== undefined && !object(value.controls))
    throw new Error('Camera image controls must be an object.');
  for (const [name, item] of Object.entries(value.controls ?? {})) {
    if (!controlNames.includes(name as WebcamImageControl))
      throw new Error(`Unknown camera image control: ${name}.`);
    const key = name as WebcamImageControl;
    if (
      (key === 'torch' && typeof item !== 'boolean') ||
      (modeControls.has(key) && (typeof item !== 'string' || !item)) ||
      (!modeControls.has(key) && key !== 'torch' && !finite(item))
    )
      throw new Error(`Invalid ${WEBCAM_IMAGE_CONTROL_LABELS[key]} value.`);
    settings.controls[key] = item;
  }
  return settings;
}

export function validateWebcamControls(
  requested: WebcamControlValues,
  capabilities: WebcamCameraCapabilities | null,
  effective: WebcamControlValues,
  actual: WebcamActualSettings | null,
): void {
  for (const [name, value] of Object.entries(requested)) {
    const key = name as WebcamImageControl;
    const capability = capabilities?.controls[key];
    const label = WEBCAM_IMAGE_CONTROL_LABELS[key];
    if (!capability) throw new Error(`${label} is not supported by this camera and browser.`);
    if (capability.type === 'number') {
      if (!finite(value) || value < capability.min || value > capability.max)
        throw new Error(`${label} must be between ${capability.min} and ${capability.max}.`);
      if (capability.step) {
        const steps = (value - capability.min) / capability.step;
        if (Math.abs(steps - Math.round(steps)) > 0.000001)
          throw new Error(`${label} must use steps of ${capability.step}.`);
      }
    } else if (
      (capability.type === 'mode' &&
        (typeof value !== 'string' || !capability.values.includes(value))) ||
      (capability.type === 'boolean' &&
        (typeof value !== 'boolean' || !capability.values.includes(value)))
    )
      throw new Error(`${label} is not a supported camera value.`);
    const mode = WEBCAM_MANUAL_CONTROL_MODES[key as keyof typeof WEBCAM_MANUAL_CONTROL_MODES];
    if (
      mode &&
      capabilities?.controls[mode] &&
      (effective[mode] ?? actual?.controls[mode]) !== 'manual'
    )
      throw new Error(
        `Set ${WEBCAM_IMAGE_CONTROL_LABELS[mode].toLowerCase()} to manual before changing ${label.toLowerCase()}.`,
      );
  }
}

export function webcamConstraints(
  settings: WebcamCaptureSettings,
  deviceId: string,
  controls: WebcamControlValues = settings.controls,
): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    ...(settings.width === undefined ? {} : { width: { ideal: settings.width } }),
    ...(settings.height === undefined ? {} : { height: { ideal: settings.height } }),
    ...(settings.frameRate === undefined ? {} : { frameRate: { ideal: settings.frameRate } }),
    ...(Object.keys(controls).length
      ? { advanced: [{ ...controls } as MediaTrackConstraintSet] }
      : {}),
  };
}

export function restoredWebcamControls(
  previous: WebcamControlValues,
  next: WebcamControlValues,
  initial: WebcamControlValues,
): WebcamControlValues {
  const restored: WebcamControlValues = {};
  for (const name of Object.keys(previous) as WebcamImageControl[])
    if (next[name] === undefined && initial[name] !== undefined) restored[name] = initial[name];
  return { ...restored, ...next };
}

export function initialWebcamControls(
  actual: WebcamActualSettings | null,
  capabilities: WebcamCameraCapabilities | null,
): WebcamControlValues {
  const result: WebcamControlValues = {};
  for (const [name, value] of Object.entries(actual?.controls ?? {})) {
    const key = name as WebcamImageControl;
    if (!capabilities?.controls[key]) continue;
    const mode = WEBCAM_MANUAL_CONTROL_MODES[key as keyof typeof WEBCAM_MANUAL_CONTROL_MODES];
    if (mode && capabilities.controls[mode] && actual?.controls[mode] !== 'manual') continue;
    try {
      validateWebcamControls({ [key]: value }, capabilities, actual?.controls ?? {}, actual);
      result[key] = value;
    } catch {
      // Driver readback can contain values outside its advertised constraint range.
      // Such a value can be shown, but must not become a new hardware constraint.
    }
  }
  return result;
}
