import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { WebcamCameraCapabilities, WebcamCaptureSettings } from '../state/webcamPreview';
import { CameraSettingsFields } from './WebcamCameraSettingsDialog';
import {
  cameraCaptureSummary,
  cameraFrameRateChoice,
  cameraFrameRateChoices,
  cameraRangeAllows,
  cameraResolutionChoice,
  cameraResolutionChoices,
} from './webcamCameraSettingsUi';

vi.mock('../state/webcamPreview', async () => {
  const metadata = await import('../state/webcamCameraSettings');
  return {
    WEBCAM_IMAGE_CONTROL_LABELS: metadata.WEBCAM_IMAGE_CONTROL_LABELS,
    WEBCAM_MANUAL_CONTROL_MODES: metadata.WEBCAM_MANUAL_CONTROL_MODES,
    applyWebcamSettings: vi.fn(),
    resetWebcamSettings: vi.fn(),
    getWebcamPreviewState: vi.fn(),
  };
});

const empty: WebcamCaptureSettings = { controls: {} };
const caps: WebcamCameraCapabilities = {
  width: { min: 640, max: 1920 },
  height: { min: 480, max: 1080 },
  frameRate: { min: 15, max: 60 },
  controls: {
    brightness: { type: 'number', min: 0, max: 100, step: 1 },
    focusMode: { type: 'mode', values: ['continuous', 'manual'] },
    focusDistance: { type: 'number', min: 0, max: 10, step: 0.1 },
    torch: { type: 'boolean', values: [false, true] },
  },
};

function fields(overrides: Partial<Parameters<typeof CameraSettingsFields>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(CameraSettingsFields, {
      draft: empty,
      actual: null,
      capabilities: null,
      disabled: false,
      resolutionChoice: 'auto',
      frameRateChoice: 'auto',
      onChange: vi.fn(),
      onResolutionChoice: vi.fn(),
      onFrameRateChoice: vi.fn(),
      ...overrides,
    }),
  );
}

describe('camera capture preferences', () => {
  it('uses Automatic until a preference is requested', () => {
    expect(cameraResolutionChoice(empty, null)).toBe('auto');
    expect(cameraFrameRateChoice(empty, null)).toBe('auto');
    expect(cameraResolutionChoice({ ...empty, width: 1280, height: 720 }, null)).toBe('1280x720');
    expect(cameraFrameRateChoice({ ...empty, frameRate: 30 }, null)).toBe('30');
  });

  it('preserves custom or partial requests rather than labeling them as a common preset', () => {
    expect(cameraResolutionChoice({ ...empty, width: 1000, height: 500 }, null)).toBe('custom');
    expect(cameraResolutionChoice({ ...empty, width: 1280 }, null)).toBe('custom');
    expect(cameraFrameRateChoice({ ...empty, frameRate: 27 }, null)).toBe('custom');
  });

  it('bounds presets by reported ranges without claiming every combination is guaranteed', () => {
    expect(cameraResolutionChoices(caps)).toEqual([
      [640, 480],
      [1280, 720],
      [1920, 1080],
    ]);
    expect(cameraFrameRateChoices(caps)).toEqual([15, 24, 25, 29.97, 30, 50, 59.94, 60]);
    expect(cameraRangeAllows(29.97, { min: 15, max: 60, step: 1 })).toBe(false);
    expect(cameraRangeAllows(30, { min: 15, max: 60, step: 1 })).toBe(true);
    expect(fields()).toContain('may use another supported combination');
  });

  it('formats actual values independently from requested preferences', () => {
    expect(cameraCaptureSummary(null)).toBe('Not running');
    expect(
      cameraCaptureSummary({ width: 1280, height: 720, frameRate: 29.970001, controls: {} }),
    ).toBe('1280 × 720 · 29.97 FPS');
    expect(cameraCaptureSummary({ controls: {} })).toBe('Resolution unavailable');
  });

  it('offers custom numeric preferences and native limits without enabling the camera', () => {
    const markup = fields({
      resolutionChoice: 'custom',
      frameRateChoice: 'custom',
      capabilities: caps,
    });
    expect(markup).toContain('Width');
    expect(markup).toContain('Height');
    expect(markup).toContain('min="640"');
    expect(markup).toContain('max="1920"');
    expect(markup).toContain('Start the webcam to discover');
    expect(markup).not.toContain('Start webcam</button>');
  });
});

describe('native camera image controls', () => {
  const actual: WebcamCaptureSettings = {
    width: 1280,
    height: 720,
    frameRate: 30,
    controls: { brightness: 50, focusMode: 'continuous', focusDistance: 2, torch: true },
  };

  it('renders only reported native controls with numeric, mode and checkbox controls', () => {
    const markup = fields({ actual, capabilities: caps });
    expect(markup).toContain('Brightness slider');
    expect(markup).toContain('value="50"');
    expect(markup).toContain('Continuous');
    expect(markup).toContain('Manual');
    expect(markup).toContain('type="checkbox" checked=""');
    expect(markup).not.toContain('Exposure compensation');
    expect(markup).not.toContain('Color temperature');
  });

  it('gates manual controls using actual mode until a manual mode is requested', () => {
    const automatic = fields({ actual, capabilities: caps });
    expect(automatic).toMatch(/type="number"[^>]*value="2"/);
    expect(automatic).toContain('Select Manual for Focus mode');
    const manual = fields({
      actual,
      capabilities: caps,
      draft: { controls: { focusMode: 'manual' } },
    });
    expect(manual).not.toContain('Select Manual for Focus mode');
    expect(manual).toContain('value="manual" selected=""');
  });

  it('permits a numeric control when the browser exposes no corresponding mode control', () => {
    const markup = fields({
      actual,
      capabilities: { controls: { focusDistance: caps.controls.focusDistance } },
    });
    expect(markup).not.toContain('Select Manual');
    expect(markup).toContain('Focus distance slider');
  });

  it('explains when the native mode cannot enable manual adjustments', () => {
    const markup = fields({
      actual,
      capabilities: {
        controls: {
          focusMode: { type: 'mode', values: ['continuous'] },
          focusDistance: caps.controls.focusDistance,
        },
      },
    });
    expect(markup).toContain('Focus mode does not support Manual on this camera.');
    expect(markup).not.toContain('Select Manual for');
  });

  it('shows an explanation when the browser exposes no controls', () => {
    expect(fields({ actual, capabilities: { controls: {} } })).toContain(
      'does not expose image controls',
    );
    expect(fields()).toContain('Start the webcam to discover');
  });

  it('disables all fields while applying or starting and fixed ranges stay read-only', () => {
    const busy = fields({ actual, capabilities: caps, disabled: true });
    expect(busy.match(/<fieldset disabled=""/g)).toHaveLength(2);
    const fixed = fields({
      actual,
      capabilities: { controls: { brightness: { type: 'number', min: 50, max: 50 } } },
    });
    expect(fixed).toMatch(/type="range"[^>]*disabled=""/);
    expect(fixed).toMatch(/type="number"[^>]*disabled=""/);
  });
});
