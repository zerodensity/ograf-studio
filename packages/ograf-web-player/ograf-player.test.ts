import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dataFromSchemaDefaults, mountOGrafGraphic } from './ograf-player.js';

describe('OGraf player schema defaults', () => {
  it('merges nested defaults without overwriting explicit values', () => {
    const schema = {
      default: { a: {}, b: null, c: 0 },
      properties: {
        a: { properties: { x: { default: 42 } } },
        b: { properties: { x: { default: 8 } } },
        c: { default: 7 },
      },
    };
    expect(dataFromSchemaDefaults(schema)).toEqual({ a: { x: 42 }, b: null, c: 0 });
    expect(schema.default).toEqual({ a: {}, b: null, c: 0 });
  });

  it('collects explicit defaults including false, zero and empty strings', () => {
    expect(
      dataFromSchemaDefaults({
        properties: {
          visible: { default: false },
          score: { default: 0 },
          text: { default: '' },
          items: { default: [] },
          absent: { type: 'string' },
        },
      }),
    ).toEqual({ visible: false, score: 0, text: '', items: [] });
  });
});

describe('OGraf player admission', () => {
  let container;
  let fetch;
  beforeEach(() => {
    class TestElement {}
    const document = {
      baseURI: 'https://tutorial.example/lesson/',
      URL: 'https://tutorial.example/lesson/',
    };
    vi.stubGlobal('HTMLElement', TestElement);
    vi.stubGlobal('document', document);
    container = new TestElement();
    container.ownerDocument = document;
    fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('rejects cross-origin manifests before fetching unless explicitly enabled', async () => {
    await expect(
      mountOGrafGraphic({ container, manifestUrl: 'https://other.example/g.ograf.json' }),
    ).rejects.toThrow('Cross-origin');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['javascript:alert(1)', 'file:///graphic.ograf.json', 'https://u:p@tutorial.example/g'])(
    'rejects unsafe package URL %s',
    async (manifestUrl) => {
      await expect(mountOGrafGraphic({ container, manifestUrl })).rejects.toThrow('HTTP or HTTPS');
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('rejects a cross-origin module before importing it', async () => {
    fetch.mockResolvedValue({
      ok: true,
      url: 'https://tutorial.example/lesson/g.ograf.json',
      json: async () => ({ main: 'https://other.example/main.js', supportsRealTime: true }),
    });
    await expect(mountOGrafGraphic({ container, manifestUrl: 'g.ograf.json' })).rejects.toThrow(
      'Cross-origin',
    );
  });

  it('rejects a non-realtime-only graphic and reports the error', async () => {
    fetch.mockResolvedValue({
      ok: true,
      url: 'https://tutorial.example/lesson/g.ograf.json',
      json: async () => ({ main: 'main.js', supportsRealTime: false }),
    });
    const onEvent = vi.fn();
    await expect(
      mountOGrafGraphic({ container, manifestUrl: 'g.ograf.json', onEvent }),
    ).rejects.toThrow('does not support real-time');
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', action: 'load', error: expect.any(Error) }),
    );
  });

  it('rejects invalid renderer dimensions before importing the module', async () => {
    fetch.mockResolvedValue({
      ok: true,
      url: 'https://tutorial.example/lesson/g.ograf.json',
      json: async () => ({ main: 'main.js', supportsRealTime: true }),
    });
    await expect(
      mountOGrafGraphic({
        container,
        manifestUrl: 'g.ograf.json',
        renderCharacteristics: { resolution: { width: 0, height: 1080 }, frameRate: 25 },
      }),
    ).rejects.toThrow('positive finite');
  });
});

describe('OGraf player lifecycle', () => {
  const fixtureUrl = new URL('./test-fixtures/mock-graphic.mjs', import.meta.url).href;
  const registry = new Map();
  let document;
  let container;
  let lastGraphic;
  class TestElement {
    ownerDocument = document;
    style = {};
    children = [];
    parent = null;
    appendChild(child) {
      this.children.push(child);
      child.parent = this;
    }
    remove() {
      if (this.parent) this.parent.children = this.parent.children.filter((item) => item !== this);
    }
    getBoundingClientRect() {
      return { width: 960 };
    }
  }
  beforeEach(() => {
    const NativeURL = globalThis.URL;
    document = {
      baseURI: 'https://tutorial.example/',
      URL: 'https://tutorial.example/',
      createElement(tag) {
        const Constructor = registry.get(tag) ?? TestElement;
        const created = new Constructor();
        if (registry.has(tag)) lastGraphic = created;
        return created;
      },
    };
    class FixtureURL extends NativeURL {
      get href() {
        // The browser integration check loads over HTTP. In Node, route only
        // this fixture's module to its local file so the DOM-free test can run.
        return this.pathname === '/graphic/mock.js' ? fixtureUrl : super.href;
      }
    }
    vi.stubGlobal('URL', FixtureURL);
    vi.stubGlobal('HTMLElement', TestElement);
    vi.stubGlobal('document', document);
    vi.stubGlobal('customElements', {
      get: (tag) => registry.get(tag),
      define: (tag, Constructor) => registry.set(tag, Constructor),
    });
    vi.stubGlobal('ResizeObserver', undefined);
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        url: 'https://tutorial.example/graphic/graphic.ograf.json',
        json: async () => ({
          main: 'mock.js',
          supportsRealTime: true,
          schema: { properties: { name: { default: 'Default title' } } },
        }),
      }),
    );
    container = new TestElement();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('forwards Stop while Play is pending and safely waits for work before disposal', async () => {
    const player = await mountOGrafGraphic({
      container,
      manifestUrl: '/graphic/graphic.ograf.json',
    });
    expect(player.element.loadParams.data).toEqual({ name: 'Default title' });
    const play = player.play();
    await Promise.resolve();
    await player.stop();
    await expect(play).resolves.toMatchObject({ currentStep: 0 });

    const laterPlay = player.play();
    await Promise.resolve();
    const disposal = player.dispose();
    await expect(player.update({ name: 'too late' })).rejects.toThrow('disposed');
    expect(player.element.disposeCount).toBeUndefined();
    player.element.finishPlay();
    await laterPlay;
    await disposal;
    expect(player.element.disposeCount).toBe(1);
    expect(container.children).toHaveLength(0);
    await player.dispose();
    expect(player.element.disposeCount).toBe(1);
  });

  it('adopts the exported graphic into the detached preview document before loading', async () => {
    const owner = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const detachedDocument = { defaultView: owner };
    class DetachedElement extends TestElement {
      ownerDocument = detachedDocument;
      appendChild(child) {
        super.appendChild(child);
        const adopt = (element) => {
          element.ownerDocument = detachedDocument;
          element.children.forEach(adopt);
        };
        adopt(child);
      }
    }
    Object.assign(owner, { HTMLElement: DetachedElement });
    const detached = new DetachedElement();
    const player = await mountOGrafGraphic({
      container: detached,
      manifestUrl: '/graphic/graphic.ograf.json',
    });
    expect(player.element.ownerDocument).toBe(detachedDocument);
    expect(owner.addEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
    await player.dispose();
    expect(detached.children).toHaveLength(0);
    expect(owner.removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
  });

  it('disposes and removes the mounted component when load fails', async () => {
    const errorEvent = vi.fn();
    await expect(
      mountOGrafGraphic({
        container,
        manifestUrl: '/graphic/graphic.ograf.json',
        data: { failLoad: true },
        onEvent: errorEvent,
      }),
    ).rejects.toThrow('Fixture load failed');
    expect(container.children).toHaveLength(0);
    expect(lastGraphic.disposeCount).toBe(1);
    expect(errorEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', action: 'load' }),
    );
  });
});
