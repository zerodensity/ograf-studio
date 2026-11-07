import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const runtime = readFileSync(new URL('./offlinePreviewRuntime.js', import.meta.url), 'utf8');
const source = runtime.slice(0, runtime.indexOf('(async function ()'));

class ElementStub {
  hidden = false;
  value = '';
  checked = false;
  accept = '';
  src = '';
  srcObject: { getTracks: () => Array<{ stop: () => void }> } | null = null;
  files: unknown[] = [];
  textContent = '';
  muted = false;
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  attributes = new Set<string>();
  listeners: Record<string, Array<() => unknown>> = {};
  pause = vi.fn();
  load = vi.fn();
  play = vi.fn(() => Promise.resolve());
  addEventListener(type: string, callback: () => unknown) {
    (this.listeners[type] ??= []).push(callback);
  }
  removeEventListener(type: string, callback: () => unknown) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((item) => item !== callback);
  }
  async fire(type: string) {
    for (const callback of this.listeners[type] ?? []) await callback();
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
    if (name === 'src') this.src = '';
  }
  toggleAttribute(name: string, enabled: boolean) {
    if (enabled) this.attributes.add(name);
    else this.attributes.delete(name);
  }
  getBoundingClientRect() {
    return { width: 1280, height: 720 };
  }
}

function setup() {
  const elements = new Map<string, ElementStub>();
  const get = (id: string) => {
    if (!elements.has(id)) elements.set(id, new ElementStub());
    return elements.get(id)!;
  };
  const classes = new Set<string>();
  const body = {
    dataset: { dock: 'right' },
    classList: {
      toggle(name: string, on: boolean) {
        if (on) classes.add(name);
        else classes.delete(name);
      },
    },
  };
  let available = { width: 1280, height: 720 };
  get('output').getBoundingClientRect = () => available;
  get('background-kind').value = 'solid';
  get('background-color').value = '#090d13';
  get('dock-side').value = 'right';
  const listeners: Record<string, () => void> = {};
  const report = vi.fn();
  const createObjectURL = vi.fn(() => 'blob:local-media');
  const revokeObjectURL = vi.fn();
  const getUserMedia = vi.fn();
  const context = {
    document: { body, getElementById: get, addEventListener: vi.fn() },
    window: {
      addEventListener: (name: string, fn: () => void) => (listeners[name] = fn),
      removeEventListener: vi.fn(),
    },
    URL: { createObjectURL, revokeObjectURL },
    navigator: { mediaDevices: { getUserMedia } },
  };
  const create = runInNewContext(`${source}\ncreateOfflinePreviewView`, context) as (
    reporter: (text: string, error?: boolean) => void,
  ) => {
    setDimensions: (width: number, height: number) => void;
    toggleControls: () => void;
    dispose: () => void;
  };
  const view = create(report);
  return {
    view,
    get,
    body,
    classes,
    context,
    listeners,
    report,
    createObjectURL,
    revokeObjectURL,
    getUserMedia,
    resize(width: number, height: number) {
      available = { width, height };
      listeners.resize!();
    },
  };
}

describe('offline preview presentation controls', () => {
  it('fits the graphic to the space beside either dock, preserving its aspect and guide alignment', async () => {
    const { view, get, body, resize, classes } = setup();
    view.setDimensions(1920, 1080);
    expect(get('frame').style).toMatchObject({ width: '1280px', height: '720px', left: '0px' });
    expect(get('stage').style.transform).toBe('scale(0.6666666666666666)');
    get('dock-side').value = 'left';
    await get('dock-side').fire('change');
    expect(body.dataset.dock).toBe('left');
    resize(900, 900);
    expect(get('frame').style).toMatchObject({
      width: '900px',
      height: '506.25px',
      top: '196.875px',
    });
    get('action-safe').checked = true;
    await get('action-safe').fire('change');
    expect(get('action-guide').attributes.has('hidden')).toBe(false);
    get('action-safe').checked = false;
    await get('action-safe').fire('change');
    expect(get('action-guide').attributes.has('hidden')).toBe(true);
    await get('hide').fire('click');
    expect(classes.has('controls-hidden')).toBe(true);
    expect(get('show-controls').hidden).toBe(false);
    await get('show-controls').fire('click');
    expect(classes.has('controls-hidden')).toBe(false);
    expect(get('controls').hidden).toBe(false);
    view.toggleControls();
    expect(get('controls').hidden).toBe(true);
    view.toggleControls();
    expect(get('controls').hidden).toBe(false);
  });

  it('switches local backgrounds without reloading the graphic and releases replaced media', async () => {
    const { get, createObjectURL, revokeObjectURL } = setup();
    get('background-kind').value = 'image';
    await get('background-kind').fire('change');
    expect(get('background-color-row').hidden).toBe(true);
    expect(get('background-file-row').hidden).toBe(false);
    expect(get('background-file').accept).toBe('image/*');
    get('background-file').files = [{ name: 'image.png' }];
    await get('background-file').fire('change');
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(get('background-image').src).toBe('blob:local-media');
    expect(get('background-image').hidden).toBe(false);
    get('background-kind').value = 'checker';
    await get('background-kind').fire('change');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:local-media');
    expect(get('background-image').hidden).toBe(true);
    expect(get('background').dataset.kind).toBe('checker');
    get('background-kind').value = 'video';
    await get('background-kind').fire('change');
    expect(get('background-file').accept).toBe('video/*');
    get('background-file').files = [{ name: 'clip.mp4' }];
    await get('background-file').fire('change');
    expect(get('background-video').play).toHaveBeenCalledOnce();
    expect(get('background-video').muted).toBe(true);
  });

  it('registers and releases the preview reveal handler on disposal', async () => {
    const { view, get, context } = setup();
    expect(get('output').listeners.contextmenu).toHaveLength(1);
    expect(context.document.addEventListener).not.toHaveBeenCalledWith(
      'contextmenu',
      expect.any(Function),
    );
    view.dispose();
    expect(get('output').listeners.contextmenu).toHaveLength(0);
  });

  it('starts webcam only after a click and stops tracks on a mode change or page disposal', async () => {
    const { view, get, getUserMedia } = setup();
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] };
    getUserMedia.mockResolvedValue(stream);
    get('background-kind').value = 'webcam';
    await get('background-kind').fire('change');
    expect(getUserMedia).not.toHaveBeenCalled();
    await get('background-camera').fire('click');
    expect(getUserMedia).toHaveBeenCalledWith({ video: true, audio: false });
    expect(get('background-video').srcObject).toBe(stream);
    get('background-kind').value = 'solid';
    await get('background-kind').fire('change');
    expect(stop).toHaveBeenCalledOnce();
    expect(get('background-video').srcObject).toBeNull();
    get('background-kind').value = 'webcam';
    await get('background-kind').fire('change');
    await get('background-camera').fire('click');
    view.dispose();
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it('discards a late camera permission result after switching backgrounds', async () => {
    const { get, getUserMedia } = setup();
    let resolve!: (value: unknown) => void;
    getUserMedia.mockImplementation(() => new Promise((done) => (resolve = done)));
    get('background-kind').value = 'webcam';
    await get('background-kind').fire('change');
    const starting = get('background-camera').fire('click');
    get('background-kind').value = 'checker';
    await get('background-kind').fire('change');
    const stop = vi.fn();
    resolve({ getTracks: () => [{ stop }] });
    await starting;
    expect(stop).toHaveBeenCalledOnce();
    expect(get('background-video').srcObject).toBeNull();
  });
});
