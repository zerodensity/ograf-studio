import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('canvas backdrop preferences', () => {
  it('keeps existing profiles following their presentation background', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify({ mode: 'solid', color: '#123456' }),
      setItem: vi.fn(),
    });
    vi.resetModules();
    const { useCanvasBackdropStore } = await import('./canvasBackdropStore');
    expect(useCanvasBackdropStore.getState()).toMatchObject({
      mode: 'solid',
      color: '#123456',
      showPresentation: true,
    });
  });

  it('persists a local-only backdrop choice without changing presentation preferences', async () => {
    const setItem = vi.fn();
    vi.stubGlobal('localStorage', { getItem: () => null, setItem });
    vi.resetModules();
    const { useCanvasBackdropStore } = await import('./canvasBackdropStore');
    useCanvasBackdropStore.getState().setBackdrop({ mode: 'light', showPresentation: false });
    expect(JSON.parse(setItem.mock.calls.at(-1)![1])).toEqual({
      mode: 'light',
      color: '#30343b',
      showPresentation: false,
    });
  });
});
