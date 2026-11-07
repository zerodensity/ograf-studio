import { afterEach, describe, expect, it, vi } from 'vitest';
import { shouldRenderEditorCanvas } from './canvasVisibility';

function fixture() {
  const document = {
    hidden: false,
    fullscreenElement: null as { contains(node: unknown): boolean } | null,
  };
  const root = { isConnected: true, ownerDocument: document } as unknown as HTMLElement;
  return { document, root };
}

afterEach(() => vi.unstubAllGlobals());

describe('editor canvas rendering visibility', () => {
  it('suspends only when another fullscreen surface in the same document covers the canvas', () => {
    const { document, root } = fixture();
    expect(shouldRenderEditorCanvas(root, false)).toBe(true);
    document.fullscreenElement = { contains: () => false };
    expect(shouldRenderEditorCanvas(root, false)).toBe(false);
    document.fullscreenElement = { contains: (candidate) => candidate === root };
    expect(shouldRenderEditorCanvas(root, false)).toBe(true);
    document.fullscreenElement = null;
    expect(shouldRenderEditorCanvas(root, false)).toBe(true);
  });

  it('keeps a visible editor rendering while another document is fullscreen on a second monitor', () => {
    const { root } = fixture();
    const detachedDocument = { hidden: false, fullscreenElement: { contains: () => false } };
    vi.stubGlobal('document', detachedDocument);
    expect(shouldRenderEditorCanvas(root, false)).toBe(true);
  });

  it('keeps synced output live through fullscreen and visibility changes', () => {
    const { document, root } = fixture();
    document.fullscreenElement = { contains: () => false };
    expect(shouldRenderEditorCanvas(root, true)).toBe(true);
    document.hidden = true;
    expect(shouldRenderEditorCanvas(root, true)).toBe(true);
    expect(shouldRenderEditorCanvas(root, false)).toBe(false);
  });

  it('resumes a hidden document without treating focus loss as occlusion', () => {
    const { document, root } = fixture();
    document.hidden = true;
    expect(shouldRenderEditorCanvas(root, false)).toBe(false);
    document.hidden = false;
    expect(shouldRenderEditorCanvas(root, false)).toBe(true);
    expect(shouldRenderEditorCanvas(null, false)).toBe(false);
    expect(shouldRenderEditorCanvas({ ...root, isConnected: false } as HTMLElement, false)).toBe(
      false,
    );
  });
});
