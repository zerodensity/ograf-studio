import { afterAll, describe, expect, it, vi } from 'vitest';
import { revealPaneOnFirstUse } from './firstUsePanes';
import { usePaneRequestStore } from './paneRequestStore';

describe('first-use panes', () => {
  afterAll(() => vi.unstubAllGlobals());
  it('reveals the pane once and does not force it back after the designer hides it', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    vi.stubGlobal('window', { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      'CustomEvent',
      class {
        constructor(_type: string, _options: unknown) {}
      },
    );
    expect(revealPaneOnFirstUse('data')).toBe(true);
    const request = usePaneRequestStore.getState().request;
    expect(request?.pane).toBe('data');
    expect(revealPaneOnFirstUse('data')).toBe(false);
    expect(usePaneRequestStore.getState().request).toBe(request);
  });
});
