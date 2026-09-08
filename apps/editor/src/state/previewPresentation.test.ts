import { describe, expect, it, vi } from 'vitest';
import { enterPreviewFullscreen, installPreviewShortcuts } from './previewPresentation';

function target(kind = 'DIV', editable = false) {
  return {
    nodeType: 1,
    tagName: kind,
    isContentEditable: editable,
    closest: (selector: string) =>
      selector.startsWith('button')
        ? kind === 'BUTTON'
          ? {}
          : null
        : ['INPUT', 'SELECT', 'TEXTAREA'].includes(kind) || editable
          ? {}
          : null,
  } as unknown as HTMLElement;
}

function fixture() {
  const listeners = new Set<(event: KeyboardEvent) => void>();
  const viewport = target(),
    inside = target(),
    outside = target();
  const members = new Set([inside, viewport]);
  const panel = { contains: (node: HTMLElement) => members.has(node) } as HTMLElement;
  const owner = {
    fullscreenElement: null,
    exitFullscreen: vi.fn().mockResolvedValue(undefined),
    addEventListener: vi.fn((_name: string, handler: (e: KeyboardEvent) => void) =>
      listeners.add(handler),
    ),
    removeEventListener: vi.fn((_name: string, handler: (e: KeyboardEvent) => void) =>
      listeners.delete(handler),
    ),
  } as unknown as Document;
  const step = vi.fn();
  let ready = true;
  const uninstall = installPreviewShortcuts(owner, panel, viewport, step, () => ready);
  const emit = (patch: Partial<KeyboardEvent> = {}) => {
    const event = {
      key: ' ',
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
    for (const listener of listeners) listener(event);
    return event;
  };
  return {
    owner,
    viewport,
    inside,
    outside,
    members,
    step,
    emit,
    uninstall,
    setReady: (value: boolean) => {
      ready = value;
    },
  };
}

describe('preview presentation controls', () => {
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

  it('reports unsupported fullscreen or permission rejection without faking a fullscreen state', async () => {
    const unavailable = { ownerDocument: { fullscreenEnabled: false } } as unknown as HTMLElement;
    await expect(enterPreviewFullscreen(unavailable)).rejects.toThrow(/regular browser/);
    const focus = vi.fn();
    const denied = {
      ownerDocument: { fullscreenEnabled: true },
      requestFullscreen: vi.fn().mockRejectedValue(new Error('Denied')),
      focus,
    } as unknown as HTMLElement;
    await expect(enterPreviewFullscreen(denied)).rejects.toThrow('Denied');
    expect(focus).not.toHaveBeenCalled();
  });
});
