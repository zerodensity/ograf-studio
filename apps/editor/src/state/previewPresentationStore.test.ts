import { describe, expect, it } from 'vitest';
import {
  isPreviewPresentationFullscreen,
  registerPreviewPresentation,
  subscribePreviewPresentationFullscreen,
} from './previewPresentationStore';

describe('preview surface ownership', () => {
  it('subscribes in the destination document before the portal host is adopted', () => {
    const original = Object.assign(new EventTarget(), { fullscreenElement: null as unknown });
    const destination = Object.assign(new EventTarget(), { fullscreenElement: null as unknown });
    const viewport = { isConnected: true, ownerDocument: original } as unknown as HTMLElement;
    const unregister = registerPreviewPresentation({
      viewport,
      ownerDocument: destination as unknown as Document,
      enter: async () => undefined,
    });
    let calls = 0;
    const unsubscribe = subscribePreviewPresentationFullscreen(() => calls++);
    Object.assign(viewport, { ownerDocument: destination });
    destination.fullscreenElement = viewport;
    destination.dispatchEvent(new Event('fullscreenchange'));
    expect(calls).toBe(1);
    expect(isPreviewPresentationFullscreen()).toBe(true);
    original.dispatchEvent(new Event('fullscreenchange'));
    expect(calls).toBe(1);
    destination.fullscreenElement = null;
    destination.dispatchEvent(new Event('fullscreenchange'));
    expect(calls).toBe(2);
    expect(isPreviewPresentationFullscreen()).toBe(false);
    unsubscribe();
    unregister();
  });

  it('rebinds to the main document when the stable viewport docks back', () => {
    const main = Object.assign(new EventTarget(), { fullscreenElement: null as unknown });
    const detached = Object.assign(new EventTarget(), { fullscreenElement: null as unknown });
    const viewport = { isConnected: true, ownerDocument: main } as unknown as HTMLElement;
    const unregisterDetached = registerPreviewPresentation({
      viewport,
      ownerDocument: detached as unknown as Document,
      enter: async () => undefined,
    });
    Object.assign(viewport, { ownerDocument: detached });
    const unregisterMain = registerPreviewPresentation({
      viewport,
      ownerDocument: main as unknown as Document,
      enter: async () => undefined,
    });
    Object.assign(viewport, { ownerDocument: main });
    unregisterDetached();
    let calls = 0;
    const unsubscribe = subscribePreviewPresentationFullscreen(() => calls++);
    main.fullscreenElement = viewport;
    main.dispatchEvent(new Event('fullscreenchange'));
    expect(calls).toBe(1);
    expect(isPreviewPresentationFullscreen()).toBe(true);
    detached.dispatchEvent(new Event('fullscreenchange'));
    expect(calls).toBe(1);
    unsubscribe();
    unregisterMain();
  });

  it('recognizes only its connected fullscreen viewport, including detached documents', () => {
    const owner = Object.assign(new EventTarget(), { fullscreenElement: null as unknown });
    const viewport = { isConnected: true, ownerDocument: owner } as unknown as HTMLElement;
    const unregister = registerPreviewPresentation({ viewport, enter: async () => undefined });
    expect(isPreviewPresentationFullscreen()).toBe(false);
    owner.fullscreenElement = viewport;
    expect(isPreviewPresentationFullscreen()).toBe(true);
    owner.fullscreenElement = {};
    expect(isPreviewPresentationFullscreen()).toBe(false);
    owner.fullscreenElement = viewport;
    Object.assign(viewport, { isConnected: false });
    expect(isPreviewPresentationFullscreen()).toBe(false);
    unregister();
    expect(isPreviewPresentationFullscreen()).toBe(false);
  });

  it('follows the newly registered document without old cleanup removing its listener', () => {
    const owner = Object.assign(new EventTarget(), { fullscreenElement: null as unknown });
    const viewport = { isConnected: true, ownerDocument: owner } as unknown as HTMLElement;
    const unregisterOld = registerPreviewPresentation({ viewport, enter: async () => undefined });
    const unregisterCurrent = registerPreviewPresentation({
      viewport,
      enter: async () => undefined,
    });
    unregisterOld();
    let calls = 0;
    const unsubscribe = subscribePreviewPresentationFullscreen(() => calls++);
    owner.fullscreenElement = viewport;
    owner.dispatchEvent(new Event('fullscreenchange'));
    expect(calls).toBe(1);
    expect(isPreviewPresentationFullscreen()).toBe(true);
    unsubscribe();
    unregisterCurrent();
  });
});
