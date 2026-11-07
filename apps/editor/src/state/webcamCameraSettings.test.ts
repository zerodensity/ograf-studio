import { describe, expect, it } from 'vitest';
import {
  initialWebcamControls,
  normalizeWebcamSettings,
  validateWebcamControls,
  webcamActualSettings,
  webcamCapabilities,
} from './webcamCameraSettings';

describe('camera capability and setting normalization', () => {
  it('keeps only finite declared numeric ranges, supported modes, and boolean controls', () => {
    expect(
      webcamCapabilities({
        deviceId: 'private-device-id',
        brightness: { min: 0, max: 1, step: 0.1 },
        sharpness: { min: 2, max: 2, step: 0 },
        contrast: { min: 1, max: 0 },
        saturation: { min: 0, max: Number.POSITIVE_INFINITY },
        width: { min: 640, max: 1920, step: 1 },
        height: { min: -1, max: 1080 },
        frameRate: { min: 1, max: 59.94 },
        focusMode: ['continuous', 'manual', 'manual', '', 12],
        exposureMode: 'continuous',
        torch: true,
        unknown: { min: 0, max: 5 },
      }),
    ).toEqual({
      width: { min: 640, max: 1920, step: 1 },
      frameRate: { min: 1, max: 59.94 },
      controls: {
        brightness: { type: 'number', min: 0, max: 1, step: 0.1 },
        sharpness: { type: 'number', min: 2, max: 2 },
        focusMode: { type: 'mode', values: ['continuous', 'manual'] },
        torch: { type: 'boolean', values: [false, true] },
      },
    });
    expect(webcamCapabilities({ torch: false })?.controls).toEqual({});
    expect(webcamCapabilities({ torch: [false, true, true, 'true'] })?.controls.torch).toEqual({
      type: 'boolean',
      values: [false, true],
    });
    expect(webcamCapabilities(undefined)).toBeNull();
  });

  it('sanitizes actual values without leaking opaque browser IDs or fabricating missing settings', () => {
    expect(
      webcamActualSettings({
        deviceId: 'opaque',
        groupId: 'opaque',
        width: 1280,
        height: 0,
        frameRate: 29.97,
        brightness: 0.3,
        pan: Number.NaN,
        torch: false,
        focusMode: 'continuous',
        fake: 42,
      }),
    ).toEqual({
      width: 1280,
      frameRate: 29.97,
      controls: { brightness: 0.3, torch: false, focusMode: 'continuous' },
    });
    expect(webcamActualSettings(undefined)).toBeNull();
    expect(webcamActualSettings({})).toEqual({ controls: {} });
  });

  it('validates native precision, range, mode and boolean values without guessing or clamping', () => {
    const capabilities = webcamCapabilities({
      brightness: { min: -0.3, max: 0.3, step: 0.1 },
      focusMode: ['continuous', 'manual'],
      torch: true,
    });
    expect(() =>
      validateWebcamControls({ brightness: 0.1, torch: false }, capabilities, {}, null),
    ).not.toThrow();
    expect(() => validateWebcamControls({ brightness: 0.15 }, capabilities, {}, null)).toThrow(
      'steps of 0.1',
    );
    expect(() => validateWebcamControls({ brightness: 0.4 }, capabilities, {}, null)).toThrow(
      'between -0.3 and 0.3',
    );
    expect(() => validateWebcamControls({ focusMode: 'auto' }, capabilities, {}, null)).toThrow(
      'not a supported',
    );
    expect(() => validateWebcamControls({ contrast: 1 }, capabilities, {}, null)).toThrow(
      'not supported',
    );
    expect(() => normalizeWebcamSettings({ controls: { torch: 1 } } as never)).toThrow('Torch');
    expect(() => normalizeWebcamSettings({ controls: { unknown: 1 } } as never)).toThrow(
      'Unknown camera image control',
    );
    expect(() => normalizeWebcamSettings({ extra: true, controls: {} } as never)).toThrow(
      'Unknown camera setting',
    );
  });

  it('requires a discovered manual mode before changing gated native controls', () => {
    const capabilities = webcamCapabilities({
      focusMode: ['continuous', 'manual'],
      focusDistance: { min: 0, max: 1, step: 0.1 },
    });
    expect(() =>
      validateWebcamControls(
        { focusDistance: 0.2 },
        capabilities,
        {},
        { controls: { focusMode: 'continuous' } },
      ),
    ).toThrow('manual');
    expect(() =>
      validateWebcamControls(
        { focusDistance: 0.2 },
        capabilities,
        { focusMode: 'manual' },
        { controls: { focusMode: 'continuous' } },
      ),
    ).not.toThrow();
    expect(() =>
      validateWebcamControls(
        { focusDistance: 0.2 },
        webcamCapabilities({ focusDistance: { min: 0, max: 1 } }),
        {},
        null,
      ),
    ).not.toThrow();
    expect(
      initialWebcamControls(
        { controls: { focusMode: 'continuous', focusDistance: 0.2, brightness: 0.5 } },
        capabilities,
      ),
    ).toEqual({ focusMode: 'continuous' });
  });

  it('does not turn invalid driver readback into a new image constraint', () => {
    const capabilities = webcamCapabilities({
      brightness: { min: 0, max: 1, step: 0.1 },
      focusMode: ['manual'],
    });
    expect(
      initialWebcamControls(
        { controls: { brightness: 0.15, focusMode: 'continuous' } },
        capabilities,
      ),
    ).toEqual({});
    expect(
      initialWebcamControls({ controls: { brightness: 0.3, focusMode: 'manual' } }, capabilities),
    ).toEqual({ brightness: 0.3, focusMode: 'manual' });
  });
});
