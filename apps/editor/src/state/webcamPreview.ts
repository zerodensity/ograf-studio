import { LIVE_MEDIA_ELEMENT_TAG } from '@ograf-editor/scene-model';
import {
  initialWebcamControls,
  normalizeWebcamSettings,
  restoredWebcamControls,
  validateWebcamControls,
  webcamActualSettings,
  webcamCapabilities,
  webcamConstraints,
  WEBCAM_IMAGE_CONTROL_LABELS,
  WEBCAM_MANUAL_CONTROL_MODES,
  type WebcamActualSettings,
  type WebcamCameraCapabilities,
  type WebcamCameraSettingsState,
  type WebcamCaptureSettings,
  type WebcamControlValues,
  type WebcamImageControl,
} from './webcamCameraSettings';

export * from './webcamCameraSettings';

export interface WebcamPreviewState {
  status: 'idle' | 'starting' | 'running' | 'error';
  tag: string | null;
  presentation: boolean;
  deviceId: string;
  devices: Array<{ deviceId: string; label: string }>;
  error: string | null;
  cameraSettings: WebcamCameraSettingsState;
}

const idle: WebcamPreviewState = {
  status: 'idle',
  tag: null,
  presentation: false,
  deviceId: '',
  devices: [],
  error: null,
  cameraSettings: {
    deviceLabel: null,
    requested: { controls: {} },
    actual: null,
    capabilities: null,
    status: 'idle',
    error: null,
  },
};

let state = idle;
let stream: MediaStream | null = null;
let video: HTMLVideoElement | null = null;
let captureWindow: (Window & typeof globalThis) | null = null;
let generation = 0;
interface CameraController {
  track: MediaStreamTrack;
  generation: number;
  revision: number;
  queue: Promise<void>;
  initialControls: WebcamControlValues;
  applied: WebcamCaptureSettings;
}
let cameraController: CameraController | null = null;
const listeners = new Set<() => void>();
const adapterConstructors = new WeakMap<CustomElementRegistry, CustomElementConstructor>();

function publish(patch: Partial<WebcamPreviewState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function publishSettings(patch: Partial<WebcamCameraSettingsState>): void {
  publish({ cameraSettings: { ...state.cameraSettings, ...patch } });
}

function readActual(track: MediaStreamTrack): WebcamActualSettings | null {
  try {
    return webcamActualSettings(track.getSettings?.());
  } catch {
    return null;
  }
}

function readCapabilities(track: MediaStreamTrack): WebcamCameraCapabilities | null {
  try {
    return webcamCapabilities(track.getCapabilities?.());
  } catch {
    return null;
  }
}

function isCurrent(controller: CameraController): boolean {
  return cameraController === controller && controller.generation === generation;
}

function settingsChanged(
  before: WebcamActualSettings | null,
  after: WebcamActualSettings | null,
  controls: WebcamControlValues,
): boolean {
  if (!before || !after) return false;
  return (
    (['width', 'height', 'frameRate'] as const).some(
      (key) => before[key] !== undefined && after[key] !== undefined && before[key] !== after[key],
    ) ||
    (Object.keys(controls) as WebcamImageControl[]).some(
      (key) =>
        before.controls[key] !== undefined &&
        after.controls[key] !== undefined &&
        before.controls[key] !== after.controls[key],
    )
  );
}

function verifyImageControls(
  controls: WebcamControlValues,
  actual: WebcamActualSettings | null,
  capabilities: WebcamCameraCapabilities | null,
): void {
  for (const [name, requested] of Object.entries(controls)) {
    const key = name as WebcamImageControl;
    const value = actual?.controls[key];
    // Older browsers do not expose image controls in getSettings. Never invent readback.
    if (value === undefined) continue;
    const capability = capabilities?.controls[key];
    const tolerance =
      capability?.type === 'number'
        ? Math.max(
            (capability.step ?? 0) * 0.00001,
            Math.abs(Number(requested)) * 0.000001,
            0.000001,
          )
        : 0;
    if (
      typeof value === 'number' && typeof requested === 'number'
        ? Math.abs(value - requested) > tolerance
        : value !== requested
    )
      throw new Error(
        `The camera did not apply ${WEBCAM_IMAGE_CONTROL_LABELS[key].toLowerCase()}.`,
      );
  }
}

function settingsError(cause: unknown): string {
  if (cause instanceof Error) {
    const constraint = (cause as Error & { constraint?: string }).constraint;
    return `${cause.message || cause.name}${constraint ? ` (${constraint})` : ''}`;
  }
  return String(cause);
}

class SupersededCameraSettings extends Error {}

function effectiveImageControls(
  values: WebcamControlValues,
  capabilities: WebcamCameraCapabilities | null,
  actual: WebcamActualSettings | null,
): WebcamControlValues {
  const controls = { ...values };
  for (const name of Object.keys(controls) as WebcamImageControl[])
    if (!capabilities?.controls[name]) delete controls[name];
  for (const [name, mode] of Object.entries(WEBCAM_MANUAL_CONTROL_MODES))
    if (capabilities?.controls[mode] && (controls[mode] ?? actual?.controls[mode]) !== 'manual')
      delete controls[name as WebcamImageControl];
  return controls;
}

async function restoreCameraSettings(
  controller: CameraController,
  deviceId: string,
  before: WebcamActualSettings | null,
  capabilities: WebcamCameraCapabilities | null,
): Promise<string[]> {
  const previous = controller.applied;
  const capture: WebcamCaptureSettings = {
    ...(before?.width === undefined ? {} : { width: before.width }),
    ...(before?.height === undefined ? {} : { height: before.height }),
    ...(before?.frameRate === undefined ? {} : { frameRate: before.frameRate }),
    ...previous,
    controls: {},
  };
  const controls = effectiveImageControls(
    { ...previous.controls, ...initialWebcamControls(before, capabilities) },
    capabilities,
    before,
  );
  const errors: string[] = [];
  // Chromium reports Image Capture constraints instead of capture constraints in
  // getConstraints(). Restore our confirmed preferences/readback in separate phases.
  try {
    await controller.track.applyConstraints(webcamConstraints(capture, deviceId));
  } catch (cause) {
    errors.push(settingsError(cause));
  }
  if (!isCurrent(controller)) return errors;
  if (Object.keys(controls).length) {
    try {
      await controller.track.applyConstraints(webcamConstraints({ controls }, ''));
      if (isCurrent(controller))
        verifyImageControls(controls, readActual(controller.track), capabilities);
    } catch (cause) {
      errors.push(settingsError(cause));
    }
  }
  return errors;
}

function releaseMedia(): void {
  captureWindow?.removeEventListener?.('pagehide', stopWebcamPreview);
  captureWindow = null;
  cameraController = null;
  if (video) {
    video.pause();
    video.srcObject = null;
    video = null;
  }
  const released = stream;
  stream = null;
  released?.getTracks().forEach((track) => track.stop());
}

export function subscribeWebcamPreview(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getWebcamPreviewState(): WebcamPreviewState {
  return state;
}

export function getWebcamPreviewFrame(tag: string): HTMLVideoElement | null {
  return state.status === 'running' &&
    state.tag === tag &&
    video &&
    video.readyState >= 2 &&
    video.videoWidth > 0 &&
    video.videoHeight > 0
    ? video
    : null;
}

export function getWebcamPresentationStream(): MediaStream | null {
  return state.status === 'running' && state.presentation ? stream : null;
}

export function stopWebcamPreview(): void {
  generation++;
  releaseMedia();
  publish({ status: 'idle', tag: null, presentation: false, error: null });
  publishSettings({
    deviceLabel: null,
    actual: null,
    capabilities: null,
    status: 'idle',
    error: null,
  });
}

/** Change session preferences only until Start; update the existing shared track when running. */
export async function applyWebcamSettings(settings: WebcamCaptureSettings): Promise<boolean> {
  let requested: WebcamCaptureSettings;
  try {
    requested = normalizeWebcamSettings(settings);
  } catch (cause) {
    publishSettings({ error: settingsError(cause) });
    return false;
  }
  if (state.status === 'starting') {
    publishSettings({ error: 'Wait for the camera to start before applying settings.' });
    return false;
  }
  const controller = cameraController;
  if (state.status !== 'running' || !controller) {
    const remembered = state.cameraSettings.requested.controls;
    const keys = new Set([...Object.keys(remembered), ...Object.keys(requested.controls)]);
    if (
      [...keys].some(
        (key) =>
          remembered[key as WebcamImageControl] !== requested.controls[key as WebcamImageControl],
      )
    ) {
      publishSettings({ error: 'Start the camera before changing its image controls.' });
      return false;
    }
    publishSettings({ requested, status: 'idle', error: null });
    return true;
  }
  return enqueueSettings(controller, requested, false);
}

/** Restore readable image settings from this stream's startup and clear capture preferences. */
export async function resetWebcamSettings(): Promise<boolean> {
  if (state.status === 'starting') {
    publishSettings({ error: 'Wait for the camera to start before resetting settings.' });
    return false;
  }
  const controller = cameraController;
  if (state.status !== 'running' || !controller) {
    publishSettings({ requested: { controls: {} }, status: 'idle', error: null });
    return true;
  }
  return enqueueSettings(controller, { controls: {} }, true);
}

function enqueueSettings(
  controller: CameraController,
  requested: WebcamCaptureSettings,
  reset: boolean,
): Promise<boolean> {
  const revision = ++controller.revision;
  publishSettings({ status: 'applying', error: null });
  const job = controller.queue.then(async () => {
    if (!isCurrent(controller) || revision !== controller.revision) return false;
    const track = controller.track;
    const deviceId = state.deviceId;
    const capabilities = readCapabilities(track);
    const before = readActual(track);
    const controls = effectiveImageControls(
      reset
        ? controller.initialControls
        : {
            ...initialWebcamControls(before, capabilities),
            ...restoredWebcamControls(
              controller.applied.controls,
              requested.controls,
              controller.initialControls,
            ),
          },
      capabilities,
      before,
    );
    let attemptedNativeApply = false;
    let captureApplied = false;
    try {
      validateWebcamControls(requested.controls, capabilities, controls, before);
      if (!track.applyConstraints)
        throw new Error(
          'This browser cannot change camera settings while the camera is running. Stop the camera, set resolution or FPS, then start it again.',
        );
      attemptedNativeApply = true;
      // Chromium routes mixed capture + Image Capture dictionaries entirely into
      // Image Capture, silently dropping width/height/FPS. Keep the phases separate
      // on the same track, then reapply the complete readable image state because
      // changing the capture format can reset hardware image settings.
      await track.applyConstraints(webcamConstraints(requested, deviceId, {}));
      captureApplied = true;
      if (!isCurrent(controller)) return false;
      if (revision !== controller.revision) throw new SupersededCameraSettings();
      if (Object.keys(controls).length) {
        validateWebcamControls(
          requested.controls,
          readCapabilities(track),
          controls,
          readActual(track),
        );
        await track.applyConstraints(webcamConstraints({ controls }, ''));
        if (!isCurrent(controller)) return false;
        if (revision !== controller.revision) throw new SupersededCameraSettings();
      }
      const actual = readActual(track);
      verifyImageControls(controls, actual, capabilities);
      controller.applied = requested;
      if (revision !== controller.revision) return false;
      publishSettings({
        requested,
        actual,
        capabilities: readCapabilities(track),
        status: 'idle',
        error: null,
      });
      return true;
    } catch (cause) {
      if (!isCurrent(controller)) return false;
      let message = settingsError(cause);
      const after = readActual(track);
      if (attemptedNativeApply && (captureApplied || settingsChanged(before, after, controls))) {
        const errors = await restoreCameraSettings(controller, deviceId, before, capabilities);
        if (errors.length)
          message += ` The camera could not restore all previous settings: ${errors.join('; ')}`;
      }
      if (!isCurrent(controller) || revision !== controller.revision) return false;
      publishSettings({
        requested: controller.applied,
        actual: readActual(track),
        capabilities: readCapabilities(track),
        status: 'idle',
        error: message,
      });
      return false;
    }
  });
  controller.queue = job.then(() => {});
  return job;
}

export function stopLiveWebcamPreview(): void {
  if (state.presentation) publish({ tag: null });
  else stopWebcamPreview();
}

export function stopWebcamPresentation(): void {
  if (state.tag) publish({ presentation: false });
  else stopWebcamPreview();
}

export async function startWebcamPreview(
  tag: string,
  deviceId = '',
  ownerWindow: Window & typeof globalThis = globalThis as Window & typeof globalThis,
): Promise<void> {
  const sourceTag = tag.trim();
  if (!sourceTag) {
    publish({ status: 'error', error: 'Enter a live tag before starting the webcam.' });
    return;
  }
  if (!registerWebcamPreviewAdapter()) {
    publish({
      status: 'error',
      error: 'Another live-media adapter is already registered in this browser tab.',
    });
    return;
  }
  if (
    state.status === 'running' &&
    stream &&
    deviceId === state.deviceId &&
    captureWindow === ownerWindow
  ) {
    publish({ tag: sourceTag, error: null });
    return;
  }
  await startCapture(sourceTag, state.presentation, deviceId, ownerWindow);
}

export async function startWebcamPresentation(
  deviceId = '',
  ownerWindow: Window & typeof globalThis = globalThis as Window & typeof globalThis,
): Promise<void> {
  if (
    state.status === 'running' &&
    stream &&
    deviceId === state.deviceId &&
    captureWindow === ownerWindow
  ) {
    publish({ presentation: true, error: null });
    return;
  }
  await startCapture(state.tag, true, deviceId, ownerWindow);
}

async function startCapture(
  tag: string | null,
  presentation: boolean,
  deviceId: string,
  ownerWindow: Window & typeof globalThis,
): Promise<void> {
  const request = ++generation;
  const requested = {
    ...state.cameraSettings.requested,
    controls: deviceId === state.deviceId ? { ...state.cameraSettings.requested.controls } : {},
  };
  releaseMedia();
  captureWindow = ownerWindow;
  captureWindow.addEventListener?.('pagehide', stopWebcamPreview);
  publish({ status: 'starting', tag, presentation, deviceId, error: null });
  publishSettings({
    requested,
    deviceLabel: null,
    actual: null,
    capabilities: null,
    status: 'idle',
    error: null,
  });
  try {
    const mediaDevices = ownerWindow.navigator.mediaDevices;
    if (!mediaDevices?.getUserMedia)
      throw new Error('Camera capture is unavailable. Open Studio on localhost or HTTPS.');
    const captureConstraints = webcamConstraints({ ...requested, controls: {} }, deviceId);
    const captured = await mediaDevices.getUserMedia({
      video: Object.keys(captureConstraints).length ? captureConstraints : true,
      audio: false,
    });
    if (request !== generation) {
      captured.getTracks().forEach((track) => track.stop());
      return;
    }
    stream = captured;
    const track = captured.getVideoTracks()[0];
    if (!track) throw new Error('The camera did not provide a video track.');
    const player = ownerWindow.document.createElement('video');
    player.muted = true;
    player.defaultMuted = true;
    player.playsInline = true;
    player.autoplay = true;
    player.srcObject = captured;
    video = player;
    await player.play();
    if (request !== generation) return;
    captured.getVideoTracks().forEach((track) =>
      track.addEventListener('ended', () => {
        if (stream === captured) stopWebcamPreview();
      }),
    );
    if (track.readyState === 'ended') throw new Error('The camera video track has ended.');
    const actual = readActual(track);
    const capabilities = readCapabilities(track);
    const controller: CameraController = {
      track,
      generation: request,
      revision: 0,
      queue: Promise.resolve(),
      initialControls: initialWebcamControls(actual, capabilities),
      applied: { ...requested, controls: {} },
    };
    cameraController = controller;
    const devices = mediaDevices.enumerateDevices
      ? await mediaDevices.enumerateDevices().catch(() => [])
      : [];
    if (request !== generation) return;
    const cameras = (devices ?? [])
      .filter((candidate) => candidate.kind === 'videoinput')
      .map((candidate, index) => ({
        deviceId: candidate.deviceId,
        label: candidate.label || `Camera ${index + 1}`,
      }));
    publish({ status: 'running', devices: cameras, error: null });
    publishSettings({
      requested: controller.applied,
      deviceLabel: track.label?.trim() || null,
      actual,
      capabilities,
      status: 'idle',
      error: null,
    });
    if (Object.keys(requested.controls).length) await enqueueSettings(controller, requested, false);
  } catch (cause) {
    if (request !== generation) return;
    releaseMedia();
    publish({
      status: 'error',
      tag: null,
      presentation: false,
      error: cause instanceof Error ? cause.message : String(cause),
    });
    publishSettings({
      deviceLabel: null,
      actual: null,
      capabilities: null,
      status: 'idle',
      error: null,
    });
  }
}

export function registerWebcamPreviewAdapter(
  registry?: CustomElementRegistry,
  elementBase?: typeof HTMLElement,
): boolean {
  const targetRegistry = registry ?? globalThis.customElements;
  const base = elementBase ?? globalThis.HTMLElement;
  if (!targetRegistry || !base) return false;
  const existing = targetRegistry.get(LIVE_MEDIA_ELEMENT_TAG);
  if (existing) return existing === adapterConstructors.get(targetRegistry);
  class StudioWebcamMediaElement extends base {
    getFrame(): HTMLVideoElement | null {
      return getWebcamPreviewFrame(this.dataset.sourceTag ?? '');
    }
  }
  adapterConstructors.set(targetRegistry, StudioWebcamMediaElement);
  targetRegistry.define(LIVE_MEDIA_ELEMENT_TAG, StudioWebcamMediaElement);
  return true;
}
