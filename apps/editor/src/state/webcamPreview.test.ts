import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyWebcamSettings,
  getWebcamPreviewFrame,
  getWebcamPresentationStream,
  getWebcamPreviewState,
  registerWebcamPreviewAdapter,
  resetWebcamSettings,
  startWebcamPresentation,
  startWebcamPreview,
  stopLiveWebcamPreview,
  stopWebcamPresentation,
  stopWebcamPreview,
} from './webcamPreview';

describe('local webcam preview adapter', () => {
  const stop = vi.fn();
  const getUserMedia = vi.fn();
  const play = vi.fn(async () => {});
  const registered = new Map<string, CustomElementConstructor>();
  const player = {
    readyState: 2,
    videoWidth: 1280,
    videoHeight: 720,
    srcObject: null as MediaStream | null,
    play,
    pause: vi.fn(),
    muted: false,
    defaultMuted: false,
    playsInline: false,
    autoplay: false,
  };

  beforeEach(async () => {
    stopWebcamPreview();
    await resetWebcamSettings();
    stop.mockClear();
    getUserMedia.mockReset();
    play.mockClear();
    player.srcObject = null;
    registered.clear();
    vi.stubGlobal(
      'HTMLElement',
      class {
        dataset: Record<string, string> = {};
      },
    );
    vi.stubGlobal('customElements', {
      get: (name: string) => registered.get(name),
      define: (name: string, constructor: CustomElementConstructor) => {
        registered.set(name, constructor);
      },
    });
    vi.stubGlobal('document', { createElement: () => player });
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia,
        enumerateDevices: vi.fn(async () => [
          { kind: 'videoinput', deviceId: 'cam-1', label: 'Desk camera' },
          { kind: 'videoinput', deviceId: 'cam-2', label: 'USB camera' },
        ]),
      },
    });
  });

  afterEach(() => {
    stopWebcamPreview();
    vi.unstubAllGlobals();
  });

  function camera() {
    const track = { stop, addEventListener: vi.fn() };
    return {
      getTracks: () => [track],
      getVideoTracks: () => [track],
    } as unknown as MediaStream;
  }

  function settingsCamera(
    settings: Record<string, unknown> = {
      width: 1280,
      height: 720,
      frameRate: 30,
      brightness: 0.5,
    },
    capabilities: Record<string, unknown> = {
      width: { min: 640, max: 1920 },
      height: { min: 360, max: 1080 },
      frameRate: { min: 1, max: 60 },
      brightness: { min: 0, max: 1, step: 0.1 },
    },
  ) {
    let constraints: MediaTrackConstraints = {};
    const ended = new Set<() => void>();
    const driver = {
      settings: { ...settings },
      apply: async (value: MediaTrackConstraints) => {
        constraints = value;
        for (const key of ['width', 'height', 'frameRate'] as const) {
          const request = value[key];
          if (request && typeof request === 'object' && 'ideal' in request)
            driver.settings[key] = request.ideal;
        }
        for (const controls of value.advanced ?? []) Object.assign(driver.settings, controls);
      },
      track: {
        readyState: 'live',
        stop,
        addEventListener: vi.fn((event: string, callback: () => void) => {
          if (event === 'ended') ended.add(callback);
        }),
        getCapabilities: vi.fn(() => capabilities),
        getSettings: vi.fn(() => ({ ...driver.settings })),
        getConstraints: vi.fn(() => constraints),
        applyConstraints: vi.fn((value: MediaTrackConstraints) => driver.apply(value)),
      },
      end: () => {
        driver.track.readyState = 'ended';
        for (const callback of ended) callback();
      },
      stream: null as unknown as MediaStream,
    };
    driver.stream = {
      getTracks: () => [driver.track],
      getVideoTracks: () => [driver.track],
    } as unknown as MediaStream;
    return driver;
  }

  it('does not request permission until Start and serves only the selected tag', async () => {
    expect(registerWebcamPreviewAdapter()).toBe(true);
    expect(getUserMedia).not.toHaveBeenCalled();
    getUserMedia.mockResolvedValue(camera());

    await startWebcamPreview('camera.program');
    expect(getUserMedia).toHaveBeenCalledWith({ video: true, audio: false });
    expect(player.muted).toBe(true);
    expect(getWebcamPreviewFrame('camera.program')).toBe(player);
    expect(getWebcamPreviewFrame('other.camera')).toBeNull();
    const detached = new Map<string, CustomElementConstructor>();
    const registry = {
      get: (name: string) => detached.get(name),
      define: (name: string, constructor: CustomElementConstructor) => {
        detached.set(name, constructor);
      },
    } as CustomElementRegistry;
    expect(registerWebcamPreviewAdapter(registry, HTMLElement)).toBe(true);
    const hook = new (
      detached.get('zd-ograf-media') as CustomElementConstructor
    )() as HTMLElement & {
      getFrame(): HTMLVideoElement | null;
    };
    hook.dataset.sourceTag = 'camera.program';
    expect(hook.getFrame()).toBe(player);
    expect(getWebcamPreviewState()).toMatchObject({
      status: 'running',
      tag: 'camera.program',
      devices: [
        { deviceId: 'cam-1', label: 'Desk camera' },
        { deviceId: 'cam-2', label: 'USB camera' },
      ],
    });

    stopWebcamPreview();
    expect(stop).toHaveBeenCalledOnce();
    expect(player.srcObject).toBeNull();
    expect(getWebcamPreviewFrame('camera.program')).toBeNull();
  });

  it('switches camera using a device ID and releases the old stream', async () => {
    getUserMedia.mockImplementation(async () => camera());
    await startWebcamPreview('camera.program');
    await startWebcamPreview('camera.program', 'cam-2');

    expect(stop).toHaveBeenCalledOnce();
    expect(getUserMedia).toHaveBeenLastCalledWith({
      video: { deviceId: { exact: 'cam-2' } },
      audio: false,
    });
    expect(getWebcamPreviewState()).toMatchObject({ status: 'running', deviceId: 'cam-2' });

    await startWebcamPreview('camera.program');
    expect(stop).toHaveBeenCalledTimes(2);
    expect(getUserMedia).toHaveBeenLastCalledWith({ video: true, audio: false });
  });

  it('shares one camera with the presentation background and stops each use independently', async () => {
    const captured = camera();
    getUserMedia.mockResolvedValue(captured);
    await startWebcamPreview('camera.program');
    await startWebcamPresentation();

    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(getWebcamPresentationStream()).toBe(captured);
    stopLiveWebcamPreview();
    expect(getWebcamPreviewFrame('camera.program')).toBeNull();
    expect(getWebcamPresentationStream()).toBe(captured);
    expect(stop).not.toHaveBeenCalled();

    await startWebcamPreview('camera.program');
    stopWebcamPresentation();
    expect(getWebcamPreviewFrame('camera.program')).toBe(player);
    expect(getWebcamPresentationStream()).toBeNull();
    expect(stop).not.toHaveBeenCalled();

    stopLiveWebcamPreview();
    expect(stop).toHaveBeenCalledOnce();
    expect(getWebcamPreviewState().status).toBe('idle');
  });

  it('starts a webcam presentation background without creating a live Media tag', async () => {
    const captured = camera();
    getUserMedia.mockResolvedValue(captured);

    await startWebcamPresentation();
    expect(getWebcamPreviewState()).toMatchObject({
      status: 'running',
      tag: null,
      presentation: true,
    });
    expect(getWebcamPresentationStream()).toBe(captured);
    expect(getWebcamPreviewFrame('camera.program')).toBeNull();

    stopWebcamPresentation();
    expect(stop).toHaveBeenCalledOnce();
    expect(getWebcamPresentationStream()).toBeNull();
  });

  it('stops a late permission grant after Stop is pressed', async () => {
    let grant!: (stream: MediaStream) => void;
    getUserMedia.mockReturnValue(new Promise<MediaStream>((resolve) => (grant = resolve)));
    const starting = startWebcamPreview('camera.program');
    expect(getWebcamPreviewState().status).toBe('starting');
    stopWebcamPreview();
    grant(camera());
    await starting;

    expect(stop).toHaveBeenCalledOnce();
    expect(getWebcamPreviewState().status).toBe('idle');
    expect(getWebcamPreviewFrame('camera.program')).toBeNull();
  });

  it('reports a denied camera request without leaving a live preview', async () => {
    getUserMedia.mockRejectedValue(new Error('Camera permission denied'));
    await startWebcamPreview('camera.program');

    expect(getWebcamPreviewState()).toMatchObject({
      status: 'error',
      tag: null,
      error: 'Camera permission denied',
    });
    expect(getWebcamPreviewFrame('camera.program')).toBeNull();
  });

  it('uses the initiating window and releases its camera when that window closes', async () => {
    getUserMedia.mockResolvedValue(camera());
    let pagehide: (() => void) | undefined;
    const ownerWindow = {
      navigator,
      document,
      addEventListener: vi.fn((type: string, listener: () => void) => {
        if (type === 'pagehide') pagehide = listener;
      }),
      removeEventListener: vi.fn(),
    } as unknown as Window & typeof globalThis;

    await startWebcamPreview('camera.program', '', ownerWindow);
    expect(ownerWindow.addEventListener).toHaveBeenCalledWith('pagehide', stopWebcamPreview);
    expect(getWebcamPreviewState().status).toBe('running');
    pagehide?.();
    expect(stop).toHaveBeenCalledOnce();
    expect(ownerWindow.removeEventListener).toHaveBeenCalledWith('pagehide', stopWebcamPreview);
    expect(getWebcamPreviewState().status).toBe('idle');
  });

  it('stores idle resolution and FPS preferences without permission and requests ideals only on Start', async () => {
    expect(
      await applyWebcamSettings({ width: 1920, height: 1080, frameRate: 29.97, controls: {} }),
    ).toBe(true);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(getWebcamPreviewState().cameraSettings.actual).toBeNull();
    const driver = settingsCamera();
    getUserMedia.mockResolvedValue(driver.stream);
    await startWebcamPreview('camera.program', 'cam-2');
    expect(getUserMedia).toHaveBeenCalledWith({
      video: {
        deviceId: { exact: 'cam-2' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 29.97 },
      },
      audio: false,
    });
    // Actual values come from the track rather than the requested ideals.
    expect(getWebcamPreviewState().cameraSettings).toMatchObject({
      requested: { width: 1920, height: 1080, frameRate: 29.97 },
      actual: { width: 1280, height: 720, frameRate: 30 },
    });
  });

  it('rejects malformed or idle hardware controls without requesting a camera', async () => {
    expect(await applyWebcamSettings({ width: 0, controls: {} })).toBe(false);
    expect(await applyWebcamSettings({ width: 1.5, controls: {} })).toBe(false);
    expect(await applyWebcamSettings({ frameRate: Number.NaN, controls: {} })).toBe(false);
    expect(await applyWebcamSettings({ controls: { brightness: 0.6 } })).toBe(false);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(getWebcamPreviewState().cameraSettings.requested).toEqual({ controls: {} });
    expect(getWebcamPreviewState().cameraSettings.error).toContain('Start the camera');
  });

  it('applies settings to one shared track, retaining the device and complete requested constraints', async () => {
    const driver = settingsCamera();
    getUserMedia.mockResolvedValue(driver.stream);
    await startWebcamPreview('camera.program', 'cam-2');
    await startWebcamPresentation('cam-2');
    expect(
      await applyWebcamSettings({
        width: 1920,
        height: 1080,
        frameRate: 60,
        controls: { brightness: 0.7 },
      }),
    ).toBe(true);
    expect(driver.track.applyConstraints).toHaveBeenNthCalledWith(1, {
      deviceId: { exact: 'cam-2' },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 60 },
    });
    expect(driver.track.applyConstraints).toHaveBeenNthCalledWith(2, {
      advanced: [{ brightness: 0.7 }],
    });
    expect(getWebcamPresentationStream()).toBe(driver.stream);
    expect(getWebcamPreviewFrame('camera.program')).toBe(player);
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(stop).not.toHaveBeenCalled();
    expect(getWebcamPreviewState().cameraSettings.actual).toEqual({
      width: 1920,
      height: 1080,
      frameRate: 60,
      controls: { brightness: 0.7 },
    });
    expect(
      await applyWebcamSettings({
        width: 1920,
        height: 1080,
        frameRate: 60,
        controls: { brightness: 0.8 },
      }),
    ).toBe(true);
    expect(driver.track.applyConstraints).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        deviceId: { exact: 'cam-2' },
        width: { ideal: 1920 },
        frameRate: { ideal: 60 },
      }),
    );
    expect(driver.track.applyConstraints).toHaveBeenLastCalledWith({
      advanced: [{ brightness: 0.8 }],
    });
  });

  it('shows actual resolution/FPS when a driver chooses different values from the requested ideals', async () => {
    const driver = settingsCamera();
    driver.apply = async () => {};
    getUserMedia.mockResolvedValue(driver.stream);
    await startWebcamPreview('camera.program');
    expect(await applyWebcamSettings({ width: 1920, frameRate: 60, controls: {} })).toBe(true);
    expect(getWebcamPreviewState().cameraSettings).toMatchObject({
      requested: { width: 1920, frameRate: 60 },
      actual: { width: 1280, frameRate: 30 },
      error: null,
    });
  });

  it('separates capture and image phases for Chromium drivers that silently drop mixed capture constraints', async () => {
    const driver = settingsCamera(
      { width: 1920, height: 1080, frameRate: 30, brightness: 128, contrast: 32 },
      { brightness: { min: 0, max: 255, step: 1 }, contrast: { min: 0, max: 255, step: 1 } },
    );
    const normalApply = driver.apply;
    driver.apply = async (constraints) => {
      // Chromium's Image Capture path ignores basic constraints whenever an
      // image control exists in the dictionary. It can hide basic constraints
      // in getConstraints even after a successful capture-only request.
      await normalApply(
        constraints.advanced?.length ? { advanced: constraints.advanced } : constraints,
      );
    };
    driver.track.getConstraints.mockReturnValue({
      advanced: [{ brightness: 128 } as MediaTrackConstraintSet],
    });
    getUserMedia.mockResolvedValue(driver.stream);
    await startWebcamPreview('camera.program', 'cam-2');
    await startWebcamPresentation('cam-2');
    expect(
      await applyWebcamSettings({
        width: 1280,
        height: 720,
        frameRate: 24,
        controls: { brightness: 129 },
      }),
    ).toBe(true);
    expect(driver.track.applyConstraints.mock.calls.map(([constraints]) => constraints)).toEqual([
      {
        deviceId: { exact: 'cam-2' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 24 },
      },
      { advanced: [{ brightness: 129, contrast: 32 }] },
    ]);
    expect(driver.track.getConstraints).not.toHaveBeenCalled();
    expect(getWebcamPreviewState().cameraSettings.actual).toEqual({
      width: 1280,
      height: 720,
      frameRate: 24,
      controls: { brightness: 129, contrast: 32 },
    });
    expect(getWebcamPresentationStream()).toBe(driver.stream);
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(stop).not.toHaveBeenCalled();
  });

  it('reapplies all readable supported image settings when capture format changes reset hardware controls', async () => {
    const driver = settingsCamera(
      { width: 1280, height: 720, frameRate: 30, brightness: 0.5, contrast: 0.6 },
      { brightness: { min: 0, max: 1, step: 0.1 }, contrast: { min: 0, max: 1, step: 0.1 } },
    );
    const normalApply = driver.apply;
    driver.apply = async (constraints) => {
      await normalApply(constraints);
      if (!constraints.advanced?.length) {
        driver.settings.brightness = 0;
        driver.settings.contrast = 0;
      }
    };
    getUserMedia.mockResolvedValue(driver.stream);
    await startWebcamPreview('camera.program');
    expect(
      await applyWebcamSettings({ width: 640, frameRate: 24, controls: { brightness: 0.8 } }),
    ).toBe(true);
    expect(driver.track.applyConstraints).toHaveBeenLastCalledWith({
      advanced: [{ brightness: 0.8, contrast: 0.6 }],
    });
    expect(getWebcamPreviewState().cameraSettings.actual).toMatchObject({
      width: 640,
      frameRate: 24,
      controls: { brightness: 0.8, contrast: 0.6 },
    });
    expect(await resetWebcamSettings()).toBe(true);
    expect(getWebcamPreviewState().cameraSettings.actual?.controls).toEqual({
      brightness: 0.5,
      contrast: 0.6,
    });
  });

  it('rolls back both phases when the image request fails after a successful capture change', async () => {
    const driver = settingsCamera();
    const normalApply = driver.apply;
    getUserMedia.mockResolvedValue(driver.stream);
    await startWebcamPreview('camera.program', 'cam-1');
    driver.track.applyConstraints
      .mockImplementationOnce(normalApply)
      .mockImplementationOnce(async () => {
        driver.settings.brightness = 0.9;
        throw new Error('Image control rejected');
      });
    expect(
      await applyWebcamSettings({
        width: 640,
        height: 360,
        frameRate: 24,
        controls: { brightness: 0.8 },
      }),
    ).toBe(false);
    expect(driver.track.applyConstraints.mock.calls.map(([constraints]) => constraints)).toEqual([
      {
        deviceId: { exact: 'cam-1' },
        width: { ideal: 640 },
        height: { ideal: 360 },
        frameRate: { ideal: 24 },
      },
      { advanced: [{ brightness: 0.8 }] },
      {
        deviceId: { exact: 'cam-1' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
      },
      { advanced: [{ brightness: 0.5 }] },
    ]);
    expect(getWebcamPreviewState().cameraSettings).toMatchObject({
      requested: { controls: {} },
      actual: { width: 1280, height: 720, frameRate: 30, controls: { brightness: 0.5 } },
      error: 'Image control rejected',
    });
    expect(getWebcamPreviewState().status).toBe('running');
    expect(stop).not.toHaveBeenCalled();
  });

  it('does not let an old pending image phase roll back or overwrite a switched camera', async () => {
    const oldCamera = settingsCamera();
    const newCamera = settingsCamera({ width: 1920, frameRate: 25 }, {});
    getUserMedia.mockResolvedValueOnce(oldCamera.stream).mockResolvedValueOnce(newCamera.stream);
    await startWebcamPreview('camera.program', 'cam-1');
    let finish!: () => void;
    oldCamera.track.applyConstraints.mockImplementationOnce(oldCamera.apply).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const applying = applyWebcamSettings({ width: 640, controls: { brightness: 0.8 } });
    await vi.waitFor(() => expect(oldCamera.track.applyConstraints).toHaveBeenCalledTimes(2));
    await startWebcamPreview('camera.program', 'cam-2');
    finish();
    expect(await applying).toBe(false);
    expect(oldCamera.track.applyConstraints).toHaveBeenCalledTimes(2);
    expect(newCamera.track.applyConstraints).not.toHaveBeenCalled();
    expect(getWebcamPreviewState()).toMatchObject({
      status: 'running',
      deviceId: 'cam-2',
      cameraSettings: {
        requested: { controls: {} },
        actual: { width: 1920, frameRate: 25 },
        error: null,
      },
    });
  });

  it('reports silently ignored image controls without claiming they were applied or stopping the stream', async () => {
    const driver = settingsCamera();
    driver.apply = async () => {};
    getUserMedia.mockResolvedValue(driver.stream);
    await startWebcamPreview('camera.program');
    expect(await applyWebcamSettings({ controls: { brightness: 0.8 } })).toBe(false);
    expect(driver.track.applyConstraints).toHaveBeenCalledTimes(4);
    expect(getWebcamPreviewState().cameraSettings).toMatchObject({
      requested: { controls: {} },
      actual: { controls: { brightness: 0.5 } },
      error: 'The camera did not apply brightness.',
    });
    expect(getWebcamPreviewState().status).toBe('running');
    expect(stop).not.toHaveBeenCalled();
  });

  it('keeps the last successful preferences and stream on a rejected constraint', async () => {
    const driver = settingsCamera();
    getUserMedia.mockResolvedValue(driver.stream);
    await startWebcamPreview('camera.program');
    expect(await applyWebcamSettings({ width: 1280, controls: { brightness: 0.6 } })).toBe(true);
    driver.track.applyConstraints.mockRejectedValueOnce(
      Object.assign(new Error('Unsupported capture request'), {
        name: 'OverconstrainedError',
        constraint: 'width',
      }),
    );
    expect(await applyWebcamSettings({ width: 1920, controls: { brightness: 0.8 } })).toBe(false);
    expect(driver.track.applyConstraints).toHaveBeenCalledTimes(3);
    expect(getWebcamPreviewState().cameraSettings).toMatchObject({
      requested: { width: 1280, controls: { brightness: 0.6 } },
      actual: { width: 1280, controls: { brightness: 0.6 } },
      status: 'idle',
      error: 'Unsupported capture request (width)',
    });
    expect(getWebcamPreviewFrame('camera.program')).toBe(player);
    expect(stop).not.toHaveBeenCalled();
  });

  it('restores a partial driver mutation after a rejected apply without replacing the shared stream', async () => {
    const driver = settingsCamera();
    getUserMedia.mockResolvedValue(driver.stream);
    await startWebcamPreview('camera.program', 'cam-1');
    await applyWebcamSettings({ width: 1280, controls: { brightness: 0.6 } });
    driver.track.applyConstraints.mockImplementationOnce(async () => {
      driver.settings.brightness = 0.8;
      driver.settings.width = 640;
      throw new Error('Driver could not complete the request');
    });
    expect(await applyWebcamSettings({ width: 1920, controls: { brightness: 0.8 } })).toBe(false);
    expect(driver.track.applyConstraints).toHaveBeenCalledTimes(5);
    expect(driver.track.applyConstraints.mock.calls[3]?.[0]).toMatchObject({
      deviceId: { exact: 'cam-1' },
      width: { ideal: 1280 },
    });
    expect(driver.track.applyConstraints).toHaveBeenLastCalledWith({
      advanced: [{ brightness: 0.6 }],
    });
    expect(getWebcamPreviewState().cameraSettings.actual).toMatchObject({
      width: 1280,
      controls: { brightness: 0.6 },
    });
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(stop).not.toHaveBeenCalled();
  });

  it('restores readable original dimensions when a failed first apply mutated an unconstrained stream', async () => {
    const driver = settingsCamera();
    getUserMedia.mockResolvedValue(driver.stream);
    await startWebcamPreview('camera.program');
    driver.track.applyConstraints.mockImplementationOnce(async () => {
      driver.settings.width = 640;
      driver.settings.brightness = 0.8;
      throw new Error('Partial driver failure');
    });
    expect(await applyWebcamSettings({ width: 1920, controls: { brightness: 0.8 } })).toBe(false);
    expect(driver.track.applyConstraints).toHaveBeenNthCalledWith(2, {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 },
    });
    expect(driver.track.applyConstraints).toHaveBeenLastCalledWith({
      advanced: [{ brightness: 0.5 }],
    });
    expect(getWebcamPreviewState().cameraSettings).toMatchObject({
      requested: { controls: {} },
      actual: { width: 1280, controls: { brightness: 0.5 } },
      error: 'Partial driver failure',
    });
    expect(stop).not.toHaveBeenCalled();
  });

  it('keeps the stream and reports actual values even when a driver also rejects rollback', async () => {
    const driver = settingsCamera();
    getUserMedia.mockResolvedValue(driver.stream);
    await startWebcamPreview('camera.program');
    driver.track.applyConstraints
      .mockImplementationOnce(async () => {
        driver.settings.brightness = 0.8;
        throw new Error('Partial driver failure');
      })
      .mockRejectedValueOnce(new Error('Rollback capture unsupported'))
      .mockRejectedValueOnce(new Error('Rollback image controls unsupported'));
    expect(await applyWebcamSettings({ controls: { brightness: 0.8 } })).toBe(false);
    expect(getWebcamPreviewState().cameraSettings).toMatchObject({
      requested: { controls: {} },
      actual: { controls: { brightness: 0.8 } },
    });
    expect(getWebcamPreviewState().cameraSettings.error).toContain(
      'could not restore all previous settings: Rollback capture unsupported; Rollback image controls unsupported',
    );
    expect(getWebcamPreviewState().status).toBe('running');
    expect(stop).not.toHaveBeenCalled();
  });

  it('does not restore unknown manual-dependent startup values when resetting an automatic-mode camera', async () => {
    const driver = settingsCamera(
      { focusMode: 'continuous', focusDistance: 0.2 },
      { focusMode: ['continuous', 'manual'], focusDistance: { min: 0, max: 1, step: 0.1 } },
    );
    getUserMedia.mockResolvedValue(driver.stream);
    await startWebcamPreview('camera.program');
    expect(
      await applyWebcamSettings({ controls: { focusMode: 'manual', focusDistance: 0.8 } }),
    ).toBe(true);
    expect(await resetWebcamSettings()).toBe(true);
    expect(driver.track.applyConstraints).toHaveBeenLastCalledWith({
      advanced: [{ focusMode: 'continuous' }],
    });
    expect(getWebcamPreviewState().cameraSettings.actual?.controls.focusMode).toBe('continuous');
  });

  it('exposes browser-reported image capabilities and label without device identifiers in actual settings', async () => {
    const driver = settingsCamera(
      { width: 1280, deviceId: 'opaque-device', brightness: 0.5, torch: false },
      {
        brightness: { min: 0, max: 1, step: 0.1 },
        torch: true,
        pan: { min: -90, max: 90, step: 1 },
      },
    );
    Object.assign(driver.track, { label: 'Desk camera' });
    getUserMedia.mockResolvedValue(driver.stream);
    await startWebcamPreview('camera.program');
    expect(getWebcamPreviewState().cameraSettings).toMatchObject({
      deviceLabel: 'Desk camera',
      actual: { width: 1280, controls: { brightness: 0.5, torch: false } },
      capabilities: {
        controls: {
          torch: { type: 'boolean', values: [false, true] },
          pan: { type: 'number', min: -90, max: 90, step: 1 },
        },
      },
    });
    expect(getWebcamPreviewState().cameraSettings.actual).not.toHaveProperty('deviceId');
    expect(await applyWebcamSettings({ controls: { torch: true, pan: 20 } })).toBe(true);
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(getUserMedia.mock.lastCall?.[0]).toEqual({ video: true, audio: false });
    stopWebcamPreview();
    expect(getWebcamPreviewState().cameraSettings.deviceLabel).toBeNull();
  });

  it('resets readable startup image values and clears requested dimensions without claiming a default resolution', async () => {
    const driver = settingsCamera();
    getUserMedia.mockResolvedValue(driver.stream);
    await startWebcamPreview('camera.program', 'cam-2');
    await applyWebcamSettings({
      width: 1920,
      height: 1080,
      frameRate: 60,
      controls: { brightness: 0.8 },
    });
    expect(await resetWebcamSettings()).toBe(true);
    expect(driver.track.applyConstraints).toHaveBeenNthCalledWith(3, {
      deviceId: { exact: 'cam-2' },
    });
    expect(driver.track.applyConstraints).toHaveBeenLastCalledWith({
      advanced: [{ brightness: 0.5 }],
    });
    expect(getWebcamPreviewState().cameraSettings).toMatchObject({
      requested: { controls: {} },
      actual: { width: 1920, height: 1080, frameRate: 60, controls: { brightness: 0.5 } },
    });
  });

  it('allows automatic focus after a stream starts in manual focus and its distance was overridden', async () => {
    const driver = settingsCamera(
      { width: 1280, focusMode: 'manual', focusDistance: 0.2 },
      { focusMode: ['manual', 'continuous'], focusDistance: { min: 0, max: 1, step: 0.1 } },
    );
    getUserMedia.mockResolvedValue(driver.stream);
    await startWebcamPreview('camera.program');
    expect(
      await applyWebcamSettings({ controls: { focusMode: 'manual', focusDistance: 0.8 } }),
    ).toBe(true);
    expect(await applyWebcamSettings({ controls: { focusMode: 'continuous' } })).toBe(true);
    expect(driver.track.applyConstraints).toHaveBeenLastCalledWith({
      advanced: [{ focusMode: 'continuous' }],
    });
    expect(getWebcamPreviewState().cameraSettings.actual?.controls.focusMode).toBe('continuous');
    expect(await resetWebcamSettings()).toBe(true);
    expect(getWebcamPreviewState().cameraSettings.actual?.controls).toEqual({
      focusMode: 'manual',
      focusDistance: 0.2,
    });
  });

  it('serializes applies, skips superseded queued requests, and publishes only the latest result', async () => {
    const driver = settingsCamera();
    getUserMedia.mockResolvedValue(driver.stream);
    await startWebcamPreview('camera.program');
    let finish!: () => void;
    const normalApply = driver.apply;
    driver.track.applyConstraints.mockImplementationOnce(async (constraints) => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      await normalApply(constraints);
    });
    const first = applyWebcamSettings({ controls: { brightness: 0.6 } });
    await vi.waitFor(() => expect(driver.track.applyConstraints).toHaveBeenCalledOnce());
    const second = applyWebcamSettings({ controls: { brightness: 0.7 } });
    const third = applyWebcamSettings({ controls: { brightness: 0.8 } });
    expect(getWebcamPreviewState().cameraSettings.status).toBe('applying');
    finish();
    expect(await Promise.all([first, second, third])).toEqual([false, false, true]);
    expect(driver.track.applyConstraints).toHaveBeenCalledTimes(5);
    expect(driver.track.applyConstraints).not.toHaveBeenCalledWith({
      advanced: [{ brightness: 0.6 }],
    });
    expect(driver.track.applyConstraints).not.toHaveBeenCalledWith({
      advanced: [{ brightness: 0.7 }],
    });
    expect(getWebcamPreviewState().cameraSettings).toMatchObject({
      requested: { controls: { brightness: 0.8 } },
      actual: { controls: { brightness: 0.8 } },
      status: 'idle',
      error: null,
    });
  });

  it('ignores a late native apply after Stop and leaves new idle preferences intact', async () => {
    const driver = settingsCamera();
    getUserMedia.mockResolvedValue(driver.stream);
    await startWebcamPreview('camera.program');
    let finish!: () => void;
    driver.track.applyConstraints.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const applying = applyWebcamSettings({ controls: { brightness: 0.8 } });
    await vi.waitFor(() => expect(driver.track.applyConstraints).toHaveBeenCalledOnce());
    stopWebcamPreview();
    expect(await applyWebcamSettings({ width: 640, controls: {} })).toBe(true);
    finish();
    expect(await applying).toBe(false);
    expect(driver.track.applyConstraints).toHaveBeenCalledOnce();
    expect(getWebcamPreviewState()).toMatchObject({
      status: 'idle',
      cameraSettings: {
        requested: { width: 640, controls: {} },
        actual: null,
        capabilities: null,
        status: 'idle',
      },
    });
  });

  it('clears hardware preferences on camera switch and does not let a late old apply affect the new track', async () => {
    const oldCamera = settingsCamera();
    const newCamera = settingsCamera({ width: 640, frameRate: 25 }, {});
    getUserMedia.mockResolvedValueOnce(oldCamera.stream).mockResolvedValueOnce(newCamera.stream);
    await startWebcamPreview('camera.program', 'cam-1');
    await applyWebcamSettings({ width: 1920, frameRate: 60, controls: { brightness: 0.6 } });
    let finish!: () => void;
    oldCamera.track.applyConstraints.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const applying = applyWebcamSettings({ width: 1280, controls: { brightness: 0.8 } });
    await vi.waitFor(() => expect(oldCamera.track.applyConstraints).toHaveBeenCalledTimes(3));
    await startWebcamPreview('camera.program', 'cam-2');
    expect(newCamera.track.applyConstraints).not.toHaveBeenCalled();
    expect(getUserMedia.mock.lastCall?.[0]).toEqual({
      video: { deviceId: { exact: 'cam-2' }, width: { ideal: 1920 }, frameRate: { ideal: 60 } },
      audio: false,
    });
    finish();
    expect(await applying).toBe(false);
    expect(getWebcamPreviewState()).toMatchObject({
      status: 'running',
      deviceId: 'cam-2',
      cameraSettings: {
        requested: { width: 1920, frameRate: 60, controls: {} },
        actual: { width: 640, frameRate: 25, controls: {} },
        status: 'idle',
        error: null,
      },
    });
    expect(newCamera.track.applyConstraints).not.toHaveBeenCalled();
  });

  it('reuses remembered hardware preferences after stopping and restarting the same selected camera', async () => {
    const oldCamera = settingsCamera();
    const nextCamera = settingsCamera();
    getUserMedia.mockResolvedValueOnce(oldCamera.stream).mockResolvedValueOnce(nextCamera.stream);
    await startWebcamPreview('camera.program', 'cam-1');
    await applyWebcamSettings({ width: 1920, controls: { brightness: 0.6 } });
    stopWebcamPreview();
    await startWebcamPreview('camera.program', 'cam-1');
    expect(nextCamera.track.applyConstraints).toHaveBeenNthCalledWith(1, {
      deviceId: { exact: 'cam-1' },
      width: { ideal: 1920 },
    });
    expect(nextCamera.track.applyConstraints).toHaveBeenLastCalledWith({
      advanced: [{ brightness: 0.6 }],
    });
    expect(getWebcamPreviewState().cameraSettings).toMatchObject({
      requested: { width: 1920, controls: { brightness: 0.6 } },
      error: null,
    });
  });

  it('falls back when capabilities or actual settings are unavailable without inventing values', async () => {
    const driver = settingsCamera();
    driver.track.getCapabilities.mockImplementation(() => {
      throw new Error('Not supported');
    });
    driver.track.getSettings.mockImplementation(() => {
      throw new Error('Not supported');
    });
    getUserMedia.mockResolvedValue(driver.stream);
    await startWebcamPreview('camera.program');
    expect(getWebcamPreviewState().cameraSettings).toMatchObject({
      capabilities: null,
      actual: null,
    });
    expect(await applyWebcamSettings({ width: 1920, frameRate: 60, controls: {} })).toBe(true);
    expect(getWebcamPreviewState().cameraSettings.actual).toBeNull();
    expect(await applyWebcamSettings({ controls: { brightness: 0.8 } })).toBe(false);
    expect(driver.track.applyConstraints).toHaveBeenCalledOnce();
    expect(getWebcamPreviewState().cameraSettings.error).toContain('not supported');
  });

  it('reports browsers without applyConstraints and retains their active stream', async () => {
    getUserMedia.mockResolvedValue(camera());
    await startWebcamPreview('camera.program');
    expect(await applyWebcamSettings({ width: 1920, controls: {} })).toBe(false);
    expect(getWebcamPreviewState().status).toBe('running');
    expect(getWebcamPreviewState().cameraSettings.error).toContain('Stop the camera');
    expect(stop).not.toHaveBeenCalled();
  });

  it('clears capability/readback state when the active camera ends', async () => {
    const driver = settingsCamera();
    getUserMedia.mockResolvedValue(driver.stream);
    await startWebcamPreview('camera.program');
    driver.end();
    expect(getWebcamPreviewState()).toMatchObject({
      status: 'idle',
      cameraSettings: { actual: null, capabilities: null, status: 'idle' },
    });
    expect(getWebcamPreviewFrame('camera.program')).toBeNull();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('does not race preference edits against a pending permission request', async () => {
    let grant!: (stream: MediaStream) => void;
    getUserMedia.mockReturnValue(
      new Promise<MediaStream>((resolve) => {
        grant = resolve;
      }),
    );
    const starting = startWebcamPreview('camera.program');
    expect(await applyWebcamSettings({ width: 640, controls: {} })).toBe(false);
    expect(await resetWebcamSettings()).toBe(false);
    expect(getUserMedia).toHaveBeenCalledOnce();
    grant(settingsCamera().stream);
    await starting;
    expect(getWebcamPreviewState().cameraSettings).toMatchObject({
      requested: { controls: {} },
      error: null,
    });
  });
});
