import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  enterPreviewFullscreen,
  exitPreviewFullscreen,
  installPreviewShortcuts,
  isPreviewPresented,
} from './previewPresentation';
import { usePlayoutControlsStore, type PlayoutControlsSession } from './playoutControlsStore';
afterEach(() => usePlayoutControlsStore.setState({ session: null, owner: null }));

function target(kind = 'DIV', editable = false, control = false) {
  return {
    nodeType: 1,
    tagName: kind,
    isContentEditable: editable,
    closest: (selector: string) => {
      if (editable) return {};
      if (control && selector.includes('[data-preview-controls]')) return {};
      if (kind === 'BUTTON' && /(^|[,\s])button([,\s]|$)|\[role="button"\]/.test(selector))
        return {};
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(kind)) return {};
      return null;
    },
  } as unknown as HTMLElement;
}

function fixture() {
  const listeners = new Map<string, Set<(event: KeyboardEvent) => void>>();
  const viewport = target(),
    inside = target(),
    outside = target();
  const members = new Set([inside, viewport]);
  Object.assign(viewport, { contains: (node: HTMLElement) => members.has(node) });
  const panel = { contains: (node: HTMLElement) => members.has(node) } as HTMLElement;
  const owner = {
    fullscreenElement: null,
    exitFullscreen: vi.fn().mockResolvedValue(undefined),
    addEventListener: vi.fn((name: string, handler: (e: KeyboardEvent) => void) => {
      const handlers = listeners.get(name) ?? new Set();
      handlers.add(handler);
      listeners.set(name, handlers);
    }),
    removeEventListener: vi.fn((name: string, handler: (e: KeyboardEvent) => void) =>
      listeners.get(name)?.delete(handler),
    ),
  } as unknown as Document;
  const step = vi.fn();
  const toggleControls = vi.fn();
  const keyboard = vi.fn((_event: KeyboardEvent) => false);
  let ready = true;
  const uninstall = installPreviewShortcuts(owner, panel, viewport, step, () => ready, {
    toggleControls,
    onKeyboard: keyboard,
  });
  const emit = (patch: Partial<KeyboardEvent> = {}) => {
    const event = {
      key: ' ',
      type: 'keydown',
      code: 'Space',
      target: inside,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      defaultPrevented: false,
      repeat: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      ...patch,
    } as unknown as KeyboardEvent;
    for (const listener of listeners.get(event.type) ?? []) listener(event);
    return event;
  };
  return {
    owner,
    viewport,
    inside,
    outside,
    members,
    step,
    toggleControls,
    keyboard,
    emit,
    uninstall,
    setReady: (value: boolean) => {
      ready = value;
    },
  };
}

describe('preview presentation controls', () => {
  it('routes program Take, Update and Out while leaving data fields and authored keys alone', () => {
    const f = fixture();
    const play = vi.fn(),
      updateDataBatch = vi.fn(),
      out = vi.fn();
    usePlayoutControlsStore.setState({
      session: {
        ready: true,
        editorSynchronized: false,
        values: { headline: 'News' },
        play,
        updateDataBatch,
        out,
      } as unknown as PlayoutControlsSession,
    });
    f.emit({ key: 't' });
    f.emit({ key: 'u' });
    f.emit({ key: 'o' });
    expect(play).toHaveBeenCalledWith({ goto: 0 });
    expect(updateDataBatch).toHaveBeenCalledWith({ headline: 'News' });
    expect(out).toHaveBeenCalledOnce();
    f.emit({ key: 't', target: target('INPUT') });
    expect(play).toHaveBeenCalledOnce();
    f.keyboard.mockReturnValue(true);
    f.emit({ key: 'o' });
    expect(out).toHaveBeenCalledOnce();
    usePlayoutControlsStore.setState({ session: null, owner: null });
    f.uninstall();
  });
  it('routes authored press/release combinations before navigation, including claimed repeats', () => {
    const f = fixture();
    f.keyboard.mockReturnValue(true);
    const pressed = f.emit({ key: 'ArrowRight', code: 'ArrowRight' });
    expect(f.keyboard).toHaveBeenLastCalledWith(pressed);
    expect(pressed.preventDefault).toHaveBeenCalledOnce();
    f.emit({ key: 'ArrowRight', code: 'ArrowRight', repeat: true });
    const released = f.emit({ type: 'keyup', key: 'Enter', ctrlKey: true });
    expect(f.keyboard).toHaveBeenLastCalledWith(released);
    expect(released.preventDefault).toHaveBeenCalledOnce();
    expect(f.step).not.toHaveBeenCalled();
  });

  it('keeps unassigned navigation but never routes fields, controls, IME or other panes to Rules', () => {
    const f = fixture();
    f.emit({ key: 'ArrowRight', code: 'ArrowRight' });
    expect(f.step).toHaveBeenCalledWith(1);
    f.keyboard.mockClear();
    f.keyboard.mockReturnValue(true);
    for (const node of [target('INPUT'), target('BUTTON'), target('DIV', false, true), f.outside]) {
      f.emit({ key: 'k', target: node });
      f.emit({ type: 'keyup', key: 'k', target: node });
    }
    f.emit({ key: 'k', isComposing: true });
    f.emit({ type: 'keyup', key: 'k', isComposing: true });
    f.emit({ key: 'k', composedPath: () => [target('INPUT'), f.viewport] });
    expect(f.keyboard).not.toHaveBeenCalled();
  });

  it('reserves both Escape edges for Studio and removes both document listeners', () => {
    const f = fixture();
    f.keyboard.mockReturnValue(true);
    Object.defineProperty(f.owner, 'fullscreenElement', { value: f.viewport, writable: true });
    f.emit({ key: 'Escape' });
    f.emit({ type: 'keyup', key: 'Escape' });
    expect(f.owner.exitFullscreen).toHaveBeenCalledOnce();
    expect(f.keyboard).not.toHaveBeenCalled();
    f.uninstall();
    f.emit({ key: 'k' });
    f.emit({ type: 'keyup', key: 'k' });
    expect(f.keyboard).not.toHaveBeenCalled();
    expect(f.owner.removeEventListener).toHaveBeenCalledWith('keyup', expect.any(Function), true);
  });

  it('keeps shadow inputs and an active recorder out of navigation and fullscreen shortcuts', () => {
    const f = fixture();
    Object.defineProperty(f.owner, 'fullscreenElement', { value: f.viewport, writable: true });
    f.emit({ composedPath: () => [target('INPUT'), f.viewport] });
    expect(f.step).not.toHaveBeenCalled();
    const recorder = {
      closest: (selector: string) => (selector.includes('data-rule-key-recording') ? {} : null),
    } as unknown as HTMLElement;
    for (const key of ['Escape', 'd', ' ']) {
      f.emit({ key, composedPath: () => [recorder, f.viewport] });
      f.emit({ type: 'keyup', key, composedPath: () => [recorder, f.viewport] });
    }
    expect(f.owner.exitFullscreen).not.toHaveBeenCalled();
    expect(f.toggleControls).not.toHaveBeenCalled();
    expect(f.keyboard).not.toHaveBeenCalled();
  });

  it('exits only its own fullscreen preview on Escape, including embedded browser hosts', () => {
    const f = fixture();
    f.emit({ key: 'Escape', code: 'Escape' });
    expect(f.owner.exitFullscreen).not.toHaveBeenCalled();
    Object.defineProperty(f.owner, 'fullscreenElement', { value: f.viewport, writable: true });
    const event = f.emit({ key: 'Escape', code: 'Escape' });
    expect(f.owner.exitFullscreen).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(f.step).not.toHaveBeenCalled();
  });
  it('routes Space and arrows to preview steps before editor Timeline listeners', () => {
    const f = fixture();
    for (const patch of [
      {},
      { key: 'ArrowRight', code: 'ArrowRight' },
      { key: 'ArrowLeft', code: 'ArrowLeft' },
    ]) {
      const e = f.emit(patch);
      expect(e.preventDefault).toHaveBeenCalledOnce();
      expect(e.stopPropagation).toHaveBeenCalledOnce();
    }
    expect(f.step.mock.calls).toEqual([[1], [1], [-1]]);
    expect(f.owner.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function), true);
  });

  it('leaves unrelated surfaces and data-entry keys alone', () => {
    const f = fixture();
    for (const node of [
      f.outside,
      target('INPUT'),
      target('SELECT'),
      target('TEXTAREA'),
      target('SPAN', true),
      target('BUTTON'),
    ]) {
      if (node !== f.outside) f.members.add(node);
      expect(f.emit({ target: node }).preventDefault).not.toHaveBeenCalled();
    }
    expect(f.step).not.toHaveBeenCalled();
  });

  it('keeps native form arrows and modified shortcuts while consuming held presentation keys', () => {
    const f = fixture(),
      input = target('INPUT');
    f.members.add(input);
    expect(
      f.emit({ key: 'ArrowLeft', code: 'ArrowLeft', target: input }).preventDefault,
    ).not.toHaveBeenCalled();
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey'])
      expect(f.emit({ [modifier]: true }).preventDefault).not.toHaveBeenCalled();
    expect(f.emit({ repeat: true }).preventDefault).toHaveBeenCalledOnce();
    expect(f.step).not.toHaveBeenCalled();
    f.setReady(false);
    expect(f.emit().preventDefault).toHaveBeenCalledOnce();
    expect(f.step).not.toHaveBeenCalled();
  });

  it('toggles fullscreen data from the viewport and focused toolbar buttons without advancing playback', () => {
    const f = fixture();
    f.emit({ key: 'd', code: 'KeyD' });
    expect(f.toggleControls).not.toHaveBeenCalled();
    Object.defineProperty(f.owner, 'fullscreenElement', { value: f.viewport, writable: true });
    for (const node of [f.viewport, target('BUTTON')]) {
      const event = f.emit({ key: 'd', code: 'KeyD', target: node });
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(event.stopPropagation).toHaveBeenCalledOnce();
    }
    f.emit({ key: 'd', code: 'KeyD', repeat: true });
    expect(f.toggleControls).toHaveBeenCalledTimes(2);
    expect(f.step).not.toHaveBeenCalled();
  });

  it('leaves data typing, native buttons, and controls untouched while fullscreen', () => {
    const f = fixture();
    Object.defineProperty(f.owner, 'fullscreenElement', { value: f.viewport, writable: true });
    for (const node of [
      target('INPUT'),
      target('TEXTAREA'),
      target('SELECT'),
      target('SPAN', true),
    ]) {
      expect(
        f.emit({ key: 'd', code: 'KeyD', target: node }).preventDefault,
      ).not.toHaveBeenCalled();
    }
    for (const node of [target('BUTTON'), target('DIV', false, true)]) {
      expect(f.emit({ target: node }).preventDefault).not.toHaveBeenCalled();
      expect(
        f.emit({ key: 'ArrowRight', code: 'ArrowRight', target: node }).preventDefault,
      ).not.toHaveBeenCalled();
    }
    expect(f.toggleControls).not.toHaveBeenCalled();
    expect(f.step).not.toHaveBeenCalled();
  });

  it('uses the owning document fullscreen surface, including when focus falls on its body', () => {
    const f = fixture();
    Object.defineProperty(f.owner, 'fullscreenElement', { value: f.viewport, writable: true });
    f.emit({ target: f.outside });
    expect(f.step).toHaveBeenCalledWith(1);
    const other = fixture();
    other.emit({ target: other.outside });
    expect(other.step).not.toHaveBeenCalled();
    f.uninstall();
    f.emit();
    expect(f.step).toHaveBeenCalledOnce();
    expect(f.owner.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function), true);
  });

  it('requests real fullscreen without browser navigation and focuses its viewport', async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined),
      focus = vi.fn();
    const viewport = {
      ownerDocument: { fullscreenEnabled: true },
      requestFullscreen,
      focus,
    } as unknown as HTMLElement;
    await enterPreviewFullscreen(viewport);
    expect(requestFullscreen).toHaveBeenCalledWith({ navigationUI: 'hide' });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it.each([false, true])(
    'opens and closes a window overlay when fullscreen is unavailable or rejected (%s)',
    async (enabled) => {
      const attributes = new Set<string>();
      const owner = Object.assign(new EventTarget(), {
        fullscreenEnabled: enabled,
        fullscreenElement: null,
      });
      const viewport = {
        ownerDocument: owner,
        requestFullscreen: vi.fn().mockRejectedValue(new Error('Denied')),
        hasAttribute: (name: string) => attributes.has(name),
        setAttribute: (name: string) => attributes.add(name),
        removeAttribute: (name: string) => attributes.delete(name),
        focus: vi.fn(),
      } as unknown as HTMLElement;
      const changed = vi.fn();
      owner.addEventListener('fullscreenchange', changed);
      await enterPreviewFullscreen(viewport);
      expect(isPreviewPresented(viewport)).toBe(true);
      expect(viewport.focus).toHaveBeenCalledWith({ preventScroll: true });
      await exitPreviewFullscreen(viewport);
      expect(isPreviewPresented(viewport)).toBe(false);
      expect(changed).toHaveBeenCalledTimes(2);
    },
  );
});
