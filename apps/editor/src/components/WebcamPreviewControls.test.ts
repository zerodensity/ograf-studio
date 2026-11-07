import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getWebcamPreviewState, type WebcamPreviewState } from '../state/webcamPreview';
import { WebcamPreviewControls } from './WebcamPreviewControls';

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}));
vi.mock('../layout/EditorWindow', () => ({
  useEditorWindow: () => ({ window: {} }),
}));
vi.mock('../state/webcamPreview', () => ({
  getWebcamPreviewState: vi.fn(),
  subscribeWebcamPreview: vi.fn(),
  startWebcamPreview: vi.fn(),
  startWebcamPresentation: vi.fn(),
  stopLiveWebcamPreview: vi.fn(),
  stopWebcamPresentation: vi.fn(),
}));
vi.mock('./WebcamCameraSettingsDialog', () => ({ WebcamCameraSettingsDialog: () => null }));

const active: WebcamPreviewState = {
  status: 'running',
  tag: 'camera.program',
  presentation: false,
  deviceId: '',
  devices: [
    { deviceId: 'camera-1', label: 'Desk camera' },
    { deviceId: 'camera-2', label: 'USB camera' },
  ],
  error: null,
  cameraSettings: {
    deviceLabel: 'Desk camera',
    status: 'applying',
    requested: { controls: {} },
    actual: { width: 1280, height: 720, controls: {} },
    capabilities: { controls: {} },
    error: null,
  },
};

function render(props: Parameters<typeof WebcamPreviewControls>[0] = { tag: 'camera.program' }) {
  return renderToStaticMarkup(createElement(WebcamPreviewControls, props));
}

describe('webcam capture controls during a pending native settings apply', () => {
  beforeEach(() => {
    vi.mocked(getWebcamPreviewState).mockReturnValue(active);
  });

  it('keeps Stop live webcam available while locking camera switching and settings', () => {
    const markup = render();
    expect(markup).toContain('<button type="button">Stop live webcam</button>');
    expect(markup).toMatch(/<select[^>]*aria-label="Preview camera"[^>]*disabled=""/);
    expect(markup).toContain('<button type="button" disabled="">Camera Settings</button>');
  });

  it('keeps Stop background webcam available for the active presentation consumer', () => {
    vi.mocked(getWebcamPreviewState).mockReturnValue({ ...active, presentation: true });
    expect(render({ presentation: true })).toContain(
      '<button type="button">Stop background webcam</button>',
    );
  });

  it('prevents starting or reusing capture elsewhere and switching devices during apply', () => {
    expect(render({ tag: 'camera.other' })).toContain(
      '<button type="button" disabled="">Use webcam here</button>',
    );
    vi.mocked(getWebcamPreviewState).mockReturnValue({ ...active, deviceId: 'camera-1' });
    expect(render()).toContain('<button type="button" disabled="">Switch camera</button>');
  });
});
