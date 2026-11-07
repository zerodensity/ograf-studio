import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createImageElement,
  createImageSequenceElement,
  createShaderElement,
  createTextElement,
  createTickerElement,
  type Element,
} from '@ograf-editor/scene-model';
import { renderElementContent, type ElementContentRenderOptions } from './renderElement';
import {
  disposeTicker,
  mirrorTickerTransport,
  mountTicker,
  pauseTickerAnimations,
  renderTickerAtTime,
  updateTicker,
  waitForTickersReady,
} from './tickerRendering';

class MockAnimation extends EventTarget {
  currentTime: number | null = 0;
  playState: AnimationPlayState = 'running';
  playbackRate = 1;
  effect = {
    getTiming: () => this.timing,
    getComputedTiming: () => this.timing,
    getKeyframes: () => this.keyframes,
  };
  finished = new Promise<Animation>(() => undefined);
  ready = Promise.resolve(this as unknown as Animation);
  constructor(
    public keyframes: Keyframe[],
    public timing: KeyframeAnimationOptions,
  ) {
    super();
  }
  pause() {
    this.playState = 'paused';
  }
  play() {
    this.playState = 'running';
  }
  cancel() {
    this.playState = 'idle';
  }
  commitStyles() {}
}

class MockNode extends EventTarget {
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  children: MockNode[] = [];
  parentElement: MockNode | null = null;
  clientWidth = 1000;
  clientHeight = 96;
  animations: MockAnimation[] = [];
  attributes: Record<string, string> = {};
  textContent = '';
  ownerDocument: {
    createElement: (name: string) => MockNode;
    fonts: { ready: Promise<void> };
    defaultView: { getComputedStyle: (node: MockNode) => Record<string, string> };
  };
  constructor(
    public tagName = 'DIV',
    document?: MockNode['ownerDocument'],
  ) {
    super();
    this.ownerDocument = document ?? {
      createElement: (name) => new MockNode(name.toUpperCase(), this.ownerDocument),
      fonts: { ready: Promise.resolve() },
      defaultView: { getComputedStyle: (node) => node.style },
    };
  }
  get firstElementChild(): MockNode | null {
    return this.children[0] ?? null;
  }
  get isConnected() {
    return true;
  }
  get childElementCount() {
    return this.children.length;
  }
  append(...nodes: MockNode[]) {
    for (const node of nodes) this.appendChild(node);
  }
  appendChild(node: MockNode) {
    node.remove();
    node.parentElement = this;
    this.children.push(node);
    return node;
  }
  replaceChildren(...nodes: MockNode[]) {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    this.append(...nodes);
  }
  remove() {
    if (this.parentElement)
      this.parentElement.children = this.parentElement.children.filter((node) => node !== this);
    this.parentElement = null;
  }
  setAttribute(key: string, value: string) {
    this.attributes[key] = value;
    if (key.startsWith('data-'))
      this.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())] =
        value;
  }
  getAttribute(key: string) {
    return this.attributes[key] ?? null;
  }
  contains(node: MockNode): boolean {
    return node === this || this.children.some((child) => child.contains(node));
  }
  getBoundingClientRect() {
    return {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: this.clientWidth,
      bottom: this.clientHeight,
      width: this.clientWidth,
      height: this.clientHeight,
    };
  }
  querySelectorAll(selector: string): MockNode[] {
    if (selector.includes(','))
      return [
        ...new Set(selector.split(',').flatMap((part) => this.querySelectorAll(part.trim()))),
      ];
    const match = /^\[data-([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
    const matches = (node: MockNode) => {
      if (selector === '*') return true;
      if (!match) return node.tagName.toLowerCase() === selector.toLowerCase();
      const key = match[1]!.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
      return key in node.dataset && (match[2] === undefined || node.dataset[key] === match[2]);
    };
    return this.children.flatMap((child) => [
      ...(matches(child) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  animate(keyframes: Keyframe[], timing: KeyframeAnimationOptions) {
    const animation = new MockAnimation(keyframes, timing);
    this.animations.push(animation);
    return animation as unknown as Animation;
  }
  getAnimations() {
    return this.animations.filter(
      (animation) => animation.playState !== 'idle',
    ) as unknown as Animation[];
  }
}

const html = (node: MockNode) => node as unknown as HTMLElement;
function setup() {
  const host = new MockNode();
  const native = {
    render: vi.fn(
      (target: HTMLElement, element: Element, _options: ElementContentRenderOptions) => {
        target.style.maskImage = 'url("item-alpha-mask.svg")';
        target.dataset.ografRenderedElement = JSON.stringify(element);
      },
    ),
    renderAtTime: vi.fn(
      (
        _target: HTMLElement,
        _element: Element,
        _elapsedMs: number,
        _options: { playing?: boolean },
      ) => {},
    ),
    ready: vi.fn(async (_target: HTMLElement) => {}),
    dispose: vi.fn(),
  };
  const element = createTickerElement({
    updatePolicy: 'immediate',
    direction: 'left',
    speedPixelsPerSecond: 137.5,
    gap: 47.25,
    entryFade: 73,
    exitFade: 51,
    items: [
      {
        id: 'text',
        width: 610.125,
        element: createTextElement({ content: 'آخر الأخبار • NEWS 24', direction: 'rtl' }),
      },
      {
        id: 'image',
        width: 80,
        element: createImageElement({ src: 'data:image/png;base64,AA==' }),
      },
      {
        id: 'sequence',
        width: 80,
        element: createImageSequenceElement({ frames: ['frame-a.png', 'frame-b.png'], fps: 12 }),
      },
    ],
  });
  return { host, native, element, options: { frameRate: 50 } };
}
const trackOf = (host: MockNode) => host.querySelector('[data-ograf-ticker-track="true"]')!;
const datasetOf = (host: MockNode) =>
  host.dataset.ografTickerOffset !== undefined
    ? host.dataset
    : host.querySelector('[data-ograf-ticker="true"]')!.dataset;
const offsetOf = (host: MockNode) => Number(datasetOf(host).ografTickerOffset);
afterEach(() => vi.unstubAllGlobals());

describe('native ticker mounted rendering', () => {
  it('renders colored quote runs as one atomic single-line ticker item', async () => {
    const { host, native, options } = setup();
    vi.stubGlobal('document', host.ownerDocument);
    native.render.mockImplementation((target, element, itemOptions) => {
      renderElementContent(target, element, 0, itemOptions);
    });
    const element = createTickerElement({
      updatePolicy: 'immediate',
      items: [
        {
          id: 'btc',
          width: 490,
          height: 52,
          element: createTextElement({
            content: 'BTC  80,000  +2.00%',
            fontSize: 30,
            autoFit: 'fixed',
            verticalAlign: 'middle',
            runs: [
              { text: 'BTC  ', color: '#081521' },
              { text: '80,000  ', color: '#081521' },
              { text: '+2.00%', color: '#08734d' },
            ],
          }),
        },
      ],
    });
    mountTicker(html(host), element, options, native);
    await waitForTickersReady(html(host));
    const flows = host.querySelectorAll('[data-ograf-rich-text-flow="true"]');
    expect(flows.length).toBeGreaterThan(0);
    for (const flow of flows) {
      expect(flow.parentElement!.children).toHaveLength(1);
      expect(flow.children.map((run) => run.textContent).join('')).toBe('BTC  80,000  +2.00%');
      expect(flow.children.map((run) => run.style.color)).toEqual([
        '#081521',
        '#081521',
        '#08734d',
      ]);
      expect(flow.parentElement!.style.justifyContent).toBe('center');
    }
    disposeTicker(html(host));
  });
  it.each([24000 / 1001, 24, 25, 30000 / 1001, 30, 50, 60000 / 1001, 60])(
    'samples fractional movement and reverse seeks exactly at %s FPS',
    (frameRate) => {
      const { host, native, element, options } = setup();
      options.frameRate = frameRate;
      mountTicker(html(host), element, options, native);
      renderTickerAtTime(html(host), element, (23 / frameRate) * 1000);
      const first = offsetOf(host);
      renderTickerAtTime(html(host), element, (24 / frameRate) * 1000);
      expect(offsetOf(host) - first).toBeCloseTo(-137.5 / frameRate, 9);
      renderTickerAtTime(html(host), element, 1250);
      const snapshot = trackOf(host).style.transform;
      expect(offsetOf(host)).toBeCloseTo(-171.875, 9);
      renderTickerAtTime(html(host), element, 120000);
      renderTickerAtTime(html(host), element, 1250);
      expect(trackOf(host).style.transform).toBe(snapshot);
      disposeTicker(html(host));
    },
  );

  it('keeps the stationary edge mask separate from nested content alpha and its transparent background', async () => {
    const { host, native, element, options } = setup();
    mountTicker(html(host), element, options, native);
    await waitForTickersReady(host as unknown as ParentNode);
    const mask = [host, ...host.querySelectorAll('*')].find(
      (node) =>
        node.style.maskImage?.includes('linear-gradient') ||
        node.style.webkitMaskImage?.includes('linear-gradient'),
    )!;
    expect(mask).toBeDefined();
    expect(mask).not.toBe(trackOf(host));
    for (const [content] of native.render.mock.calls)
      expect(content.style.maskImage).toBe('url("item-alpha-mask.svg")');
    expect(native.ready).toHaveBeenCalled();
    const maskTransform = mask.style.transform;
    renderTickerAtTime(html(host), element, 2000);
    expect(mask.style.transform).toBe(maskTransform);
    expect(trackOf(host).style.transform).not.toBe(maskTransform);
    disposeTicker(html(host));
  });

  it('changes scrolling direction independently of RTL text and preserves a bounded prepared pool', () => {
    const { host, native, element, options } = setup();
    element.direction = 'right';
    mountTicker(html(host), element, options, native);
    const mounted = native.render.mock.calls.length;
    expect(mounted).toBeGreaterThan(0);
    expect(mounted).toBeLessThan(50);
    renderTickerAtTime(html(host), element, 1000);
    const before = offsetOf(host);
    renderTickerAtTime(html(host), element, 1100);
    expect(offsetOf(host) - before).toBeCloseTo(13.75, 9);
    for (const elapsed of [2000, 4000, 6000, 8000, 10000])
      renderTickerAtTime(html(host), element, elapsed);
    expect(native.render.mock.calls.length).toBe(mounted);
    expect(native.renderAtTime).toHaveBeenCalled();
    disposeTicker(html(host));
  });

  it('uses one compositor transport during playback and cancels it for exact manual sampling', () => {
    const { host, native, element, options } = setup();
    mountTicker(html(host), element, options, native);
    renderTickerAtTime(html(host), element, 1000, { playing: true });
    const track = trackOf(host);
    expect(track.getAnimations()).toHaveLength(1);
    const animation = track.getAnimations()[0]!;
    renderTickerAtTime(html(host), element, 1040, { playing: true });
    expect(track.getAnimations()).toEqual([animation]);
    renderTickerAtTime(html(host), element, 1250, { playing: false });
    expect(track.getAnimations()).toHaveLength(0);
    expect(offsetOf(host)).toBeCloseTo(-171.875, 9);
    disposeTicker(html(host));
  });

  it('re-anchors live speed updates without restarting the visible track', () => {
    const { host, native, element, options } = setup();
    mountTicker(html(host), element, options, native);
    renderTickerAtTime(html(host), element, 1000, { playing: true });
    const before = offsetOf(host);
    const next = { ...element, speedPixelsPerSecond: 275 };
    expect(updateTicker(html(host), next, options)).toBe(true);
    renderTickerAtTime(html(host), next, 1000, { playing: true });
    expect(offsetOf(host)).toBeCloseTo(before, 9);
    renderTickerAtTime(html(host), next, 1100, { playing: true });
    expect(offsetOf(host) - before).toBeCloseTo(-27.5, 9);
    disposeTicker(html(host));
  });

  it('pauses and disposes transport plus every nested renderer', () => {
    const { host, native, element, options } = setup();
    mountTicker(html(host), element, options, native);
    renderTickerAtTime(html(host), element, 1000, { playing: true });
    pauseTickerAnimations(host as unknown as ParentNode);
    expect(
      trackOf(host)
        .getAnimations()
        .every((animation) => animation.playState !== 'running'),
    ).toBe(true);
    const mounted = native.render.mock.calls.length;
    disposeTicker(html(host));
    expect(native.dispose).toHaveBeenCalledTimes(mounted);
    expect(trackOf(host)?.getAnimations() ?? []).toHaveLength(0);
    expect(() => disposeTicker(html(host))).not.toThrow();
  });

  it('mirrors compositor motion without coupling the original output lifetime', () => {
    const { host, native, element, options } = setup();
    mountTicker(html(host), element, options, native);
    renderTickerAtTime(html(host), element, 1000, { playing: true });
    const source = trackOf(host);
    source.getAnimations()[0]!.currentTime = 1250;
    const target = new MockNode();
    const cleanup = mirrorTickerTransport(html(source), html(target));
    expect(target.getAnimations()).toHaveLength(1);
    expect(target.getAnimations()[0]!.currentTime).toBe(1250);
    cleanup();
    expect(target.getAnimations()).toHaveLength(0);
    expect(source.getAnimations()).toHaveLength(1);
    disposeTicker(html(host));
  });

  it('reports failed upcoming content preparation instead of silently running an empty segment', async () => {
    const { host, native, element, options } = setup();
    native.ready.mockRejectedValueOnce(new Error('Ticker image failed to decode.'));
    mountTicker(html(host), element, options, native);
    await expect(waitForTickersReady(host as unknown as ParentNode)).rejects.toThrow(
      'Ticker image failed to decode.',
    );
    disposeTicker(html(host));
  });

  it('preserves the current pose when a visible text update does not change item geometry', () => {
    const { host, native, element, options } = setup();
    mountTicker(html(host), element, options, native);
    renderTickerAtTime(html(host), element, 1000, { playing: true });
    const before = offsetOf(host);
    const track = trackOf(host);
    const next = structuredClone(element);
    const text = next.items[0]!.element;
    if (text.type !== 'text') throw new Error('Expected text.');
    text.content = 'Updated headline • خبر عاجل';
    expect(updateTicker(html(host), next, options)).toBe(true);
    renderTickerAtTime(html(host), next, 1000, { playing: true });
    expect(offsetOf(host)).toBeCloseTo(before, 9);
    expect(trackOf(host)).toBe(track);
    disposeTicker(html(host));
  });

  it('retains the live speed anchor across pause and resume', () => {
    const { host, native, element, options } = setup();
    mountTicker(html(host), element, options, native);
    renderTickerAtTime(html(host), element, 1000, { playing: true });
    const next = { ...element, speedPixelsPerSecond: 275 };
    updateTicker(html(host), next, options);
    renderTickerAtTime(html(host), next, 1100, { playing: true });
    const before = offsetOf(host);
    pauseTickerAnimations(host as unknown as ParentNode);
    renderTickerAtTime(html(host), next, 1100, { playing: true });
    expect(offsetOf(host)).toBeCloseTo(before, 9);
    renderTickerAtTime(html(host), next, 1200, { playing: true });
    expect(offsetOf(host) - before).toBeCloseTo(-27.5, 9);
    disposeTicker(html(host));
  });

  it('anchors the visible item when another item is inserted before it', () => {
    const { host, native, element, options } = setup();
    mountTicker(html(host), element, options, native);
    renderTickerAtTime(html(host), element, 1000, { playing: true });
    const visualPosition = () => {
      const node = host
        .querySelectorAll('[data-ograf-ticker-item="text"]')
        .find((candidate) => candidate.dataset.ografTickerCycle === '0')!;
      return Number.parseFloat(node.style.left!) + offsetOf(host);
    };
    const before = visualPosition();
    const next = {
      ...element,
      items: [
        { id: 'new-item', width: 200, element: createTextElement({ content: 'Inserted' }) },
        ...element.items,
      ],
    };
    updateTicker(html(host), next, options);
    renderTickerAtTime(html(host), next, 1000, { playing: true });
    expect(visualPosition()).toBeCloseTo(before, 9);
    disposeTicker(html(host));
  });

  it.each(['left', 'right'] as const)(
    'anchors the visible item when its preceding gap changes while scrolling %s',
    (direction) => {
      const { host, native, element, options } = setup();
      element.direction = direction;
      mountTicker(html(host), element, options, native);
      const period = element.items.reduce((total, item) => total + item.width + element.gap, 0);
      const time =
        ((direction === 'left' ? 200 : period - 200) / element.speedPixelsPerSecond) * 1000;
      renderTickerAtTime(html(host), element, time, { playing: true });
      const visualPosition = () => {
        const node = host
          .querySelectorAll('[data-ograf-ticker-item="image"]')
          .find((candidate) => candidate.dataset.ografTickerCycle === '0')!;
        return Number.parseFloat(node.style.left!) + offsetOf(host);
      };
      const before = visualPosition();
      const next = { ...element, gap: element.gap + 50 };
      updateTicker(html(host), next, options);
      renderTickerAtTime(html(host), next, time, { playing: true });
      expect(visualPosition()).toBeCloseTo(before, 9);
      disposeTicker(html(host));
    },
  );

  it('ignores a superseded rejected readiness promise after replacement content becomes ready', async () => {
    const { host, native, element, options } = setup();
    let rejectOld!: (error: Error) => void;
    native.ready.mockReturnValueOnce(
      new Promise<void>((_, reject) => {
        rejectOld = reject;
      }),
    );
    mountTicker(html(host), element, options, native);
    const next = structuredClone(element);
    const text = next.items[0]!.element;
    if (text.type !== 'text') throw new Error('Expected text.');
    text.content = 'Replacement content';
    updateTicker(html(host), next, options);
    await waitForTickersReady(host as unknown as ParentNode);
    rejectOld(new Error('Stale generation failed.'));
    await Promise.resolve();
    await Promise.resolve();
    await expect(waitForTickersReady(host as unknown as ParentNode)).resolves.toBeUndefined();
    for (const node of host.querySelectorAll('[data-ograf-ticker-item]'))
      expect(node.style.visibility).toBe('');
    disposeTicker(html(host));
  });

  it('follows the replacement generation when content changes during an active readiness wait', async () => {
    const { host, native, element, options } = setup();
    let rejectOld!: (error: Error) => void;
    native.ready.mockReturnValueOnce(
      new Promise<void>((_, reject) => {
        rejectOld = reject;
      }),
    );
    mountTicker(html(host), element, options, native);
    let outcome: unknown = 'pending';
    const waiting = waitForTickersReady(host as unknown as ParentNode).then(
      () => {
        outcome = 'ready';
      },
      (error: unknown) => {
        outcome = error;
      },
    );
    await Promise.resolve();
    let releaseNew!: () => void;
    native.ready.mockReturnValue(
      new Promise<void>((resolve) => {
        releaseNew = resolve;
      }),
    );
    const next = structuredClone(element);
    const text = next.items[0]!.element;
    if (text.type !== 'text') throw new Error('Expected text.');
    text.content = 'New generation';
    updateTicker(html(host), next, options);
    rejectOld(new Error('Shader playback has been disposed.'));
    for (let index = 0; index < 12; index++) await Promise.resolve();
    expect(outcome).toBe('pending');
    releaseNew();
    await waiting;
    expect(outcome).toBe('ready');
    await expect(waitForTickersReady(host as unknown as ParentNode)).resolves.toBeUndefined();
    disposeTicker(html(host));
  });

  it('ignores a retired cell rejection when that cell is evicted during an active readiness wait', async () => {
    const { host, native, element, options } = setup();
    let rejectOld!: (error: Error) => void;
    native.ready.mockReturnValueOnce(
      new Promise<void>((_, reject) => {
        rejectOld = reject;
      }),
    );
    mountTicker(html(host), element, options, native);
    const waiting = waitForTickersReady(host as unknown as ParentNode);
    const result = waiting.then(
      () => 'ready',
      (error: unknown) => error,
    );
    await Promise.resolve();
    updateTicker(html(host), { ...element, items: [] }, options);
    rejectOld(new Error('Evicted renderer was disposed.'));
    expect(await result).toBe('ready');
    expect(host.querySelectorAll('[data-ograf-ticker-item]')).toHaveLength(0);
    disposeTicker(html(host));
  });

  it('recovers from a failed image when the item is replaced with a valid source', async () => {
    const { host, native, element, options } = setup();
    element.items = [
      { id: 'image', width: 200, element: createImageElement({ src: 'failed.png' }) },
    ];
    native.render.mockImplementation((target, content) => {
      if (content.type === 'image') target.dataset.source = content.src ?? '';
    });
    native.ready.mockImplementation(async (target) => {
      if (target.dataset.source === 'failed.png') throw new Error('Image decode failed.');
    });
    mountTicker(html(host), element, options, native);
    await expect(waitForTickersReady(host as unknown as ParentNode)).rejects.toThrow(
      'Image decode failed.',
    );
    const next = {
      ...element,
      items: [{ id: 'image', width: 200, element: createImageElement({ src: 'working.png' }) }],
    };
    updateTicker(html(host), next, options);
    await expect(waitForTickersReady(host as unknown as ParentNode)).resolves.toBeUndefined();
    for (const node of host.querySelectorAll('[data-ograf-ticker-item]'))
      expect(node.style.visibility).toBe('');
    disposeTicker(html(host));
  });

  it('predecodes all sequence frames once per unique URL across repeat copies', async () => {
    const { host, native, element, options } = setup();
    const decoded: string[] = [];
    const created: Array<MockNode & { src?: string; decode?: () => Promise<void> }> = [];
    const create = host.ownerDocument.createElement;
    host.ownerDocument.createElement = (name) => {
      const node = create(name) as MockNode & { src?: string; decode?: () => Promise<void> };
      if (name === 'img') {
        node.decode = async () => {
          decoded.push(node.src!);
        };
        created.push(node);
      }
      return node;
    };
    element.items = [
      {
        id: 'sequence',
        width: 80,
        element: createImageSequenceElement({
          frames: ['frame-a.png', 'frame-b.png', 'frame-a.png', 'frame-c.png'],
          fps: 12,
        }),
      },
    ];
    mountTicker(html(host), element, options, native);
    await waitForTickersReady(host as unknown as ParentNode);
    expect(native.render.mock.calls.length).toBeGreaterThan(1);
    expect(decoded.sort()).toEqual(['frame-a.png', 'frame-b.png', 'frame-c.png']);
    expect(created).toHaveLength(3);
    renderTickerAtTime(html(host), element, 10000, { playing: true });
    await waitForTickersReady(host as unknown as ParentNode);
    expect(created).toHaveLength(3);
    const reduced = {
      ...element,
      items: [
        {
          id: 'sequence',
          width: 80,
          element: createImageSequenceElement({ frames: ['frame-a.png'], fps: 12 }),
        },
      ],
    };
    updateTicker(html(host), reduced, options);
    await waitForTickersReady(host as unknown as ParentNode);
    expect(created).toHaveLength(3);
    updateTicker(html(host), element, options);
    await waitForTickersReady(host as unknown as ParentNode);
    expect(created).toHaveLength(5);
    disposeTicker(html(host));
  });

  it('refreshes backing sizes after viewport height changes while retaining explicit item heights', () => {
    const { host, native, element, options } = setup();
    let resized!: () => void;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resized = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    element.items[1]!.height = 48;
    mountTicker(html(host), element, options, native);
    expect(
      native.render.mock.calls.find(([, content]) => content.type === 'text')![2].shaderBackingSize,
    ).toEqual({ width: 610.125, height: 96 });
    native.render.mockClear();
    host.clientHeight = 192;
    resized();
    const textCalls = native.render.mock.calls.filter(([, content]) => content.type === 'text');
    expect(textCalls.length).toBeGreaterThan(0);
    for (const [, , renderOptions] of textCalls) {
      expect(renderOptions.shaderBackingSize).toEqual({ width: 610.125, height: 192 });
      expect(renderOptions.lottieBackingSize).toEqual({ width: 610.125, height: 192 });
    }
    expect(host.querySelector('[data-ograf-ticker-item="image"]')!.style.height).toBe('48px');
    disposeTicker(html(host));
  });

  it('does not force source-alpha sampling or CORS on an ordinary image item', () => {
    const { host, native, element, options } = setup();
    element.items = [
      {
        id: 'external-logo',
        width: 200,
        element: createImageElement({ src: 'https://example.test/logo.png' }),
      },
    ];
    mountTicker(html(host), element, options, native);
    for (const [, content, renderOptions] of native.render.mock.calls) {
      expect(content).toMatchObject({ type: 'image', src: 'https://example.test/logo.png' });
      expect(renderOptions.requiresImageAlpha).toBeUndefined();
    }
    disposeTicker(html(host));
  });

  it('retains old pixels and their clock until replacement content is ready, then disposes the old renderer once', async () => {
    const { host, native, element, options } = setup();
    element.items = [
      { id: 'headline', width: 600, element: createTextElement({ content: 'Current headline' }) },
    ];
    mountTicker(html(host), element, options, native);
    await waitForTickersReady(host as unknown as ParentNode);
    const oldContents = native.render.mock.calls.map(([content]) => content);
    let release!: () => void;
    const replacementReady = new Promise<void>((resolve) => {
      release = resolve;
    });
    native.ready.mockReturnValue(replacementReady);
    const next = {
      ...element,
      items: [
        { id: 'headline', width: 600, element: createTextElement({ content: 'Updated headline' }) },
      ],
    };
    updateTicker(html(host), next, options);
    for (const old of oldContents) {
      expect(old.parentElement).not.toBeNull();
      expect(old.style.visibility).toBe('');
      expect(old.style.opacity).toBe('1');
      expect(old.parentElement!.children).toHaveLength(2);
      const pending = [...old.parentElement!.children].find(
        (content) => content !== old,
      )! as HTMLElement;
      expect(pending.style.visibility).not.toBe('hidden');
      expect(pending.style.opacity).toBe('0');
    }
    expect(native.dispose).not.toHaveBeenCalled();
    renderTickerAtTime(html(host), next, 1000);
    for (const old of oldContents)
      expect(native.renderAtTime).toHaveBeenCalledWith(
        old,
        expect.objectContaining({ type: 'text', content: 'Current headline' }),
        1000,
        { playing: false },
      );
    release();
    await waitForTickersReady(host as unknown as ParentNode);
    for (const old of oldContents) {
      expect(old.parentElement).toBeNull();
      expect(native.dispose.mock.calls.filter(([content]) => content === old)).toHaveLength(1);
    }
    for (const wrapper of host.querySelectorAll('[data-ograf-ticker-item]')) {
      expect(wrapper.children).toHaveLength(1);
      expect(wrapper.children[0]!.style.visibility).toBe('');
      expect(wrapper.children[0]!.style.opacity).toBe('1');
    }
    disposeTicker(html(host));
    for (const old of oldContents)
      expect(native.dispose.mock.calls.filter(([content]) => content === old)).toHaveLength(1);
  });

  it('keeps the previous image visible after a replacement fails and recovers atomically when corrected', async () => {
    const { host, native, element, options } = setup();
    element.items = [
      { id: 'image', width: 300, element: createImageElement({ src: 'current.png' }) },
    ];
    mountTicker(html(host), element, options, native);
    await waitForTickersReady(host as unknown as ParentNode);
    const oldContents = native.render.mock.calls.map(([content]) => content);
    native.ready.mockImplementation(async (target) => {
      const content = JSON.parse(target.dataset.ografRenderedElement!) as Element;
      if (content.type === 'image' && content.src === 'failed.png')
        throw new Error('Replacement decode failed.');
    });
    const failed = {
      ...element,
      items: [{ id: 'image', width: 300, element: createImageElement({ src: 'failed.png' }) }],
    };
    updateTicker(html(host), failed, options);
    await expect(waitForTickersReady(host as unknown as ParentNode)).rejects.toThrow(
      'Replacement decode failed.',
    );
    for (const old of oldContents) {
      expect(old.parentElement).not.toBeNull();
      expect(old.style.visibility).toBe('');
      expect(native.dispose.mock.calls.filter(([content]) => content === old)).toHaveLength(0);
    }
    let release!: () => void;
    native.ready.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const corrected = {
      ...element,
      items: [{ id: 'image', width: 300, element: createImageElement({ src: 'corrected.png' }) }],
    };
    updateTicker(html(host), corrected, options);
    for (const old of oldContents) expect(old.style.visibility).toBe('');
    release();
    await waitForTickersReady(host as unknown as ParentNode);
    for (const wrapper of host.querySelectorAll('[data-ograf-ticker-item]')) {
      expect(wrapper.children).toHaveLength(1);
      expect(wrapper.children[0]!.style.visibility).toBe('');
      expect(JSON.parse(wrapper.children[0]!.dataset.ografRenderedElement!).src).toBe(
        'corrected.png',
      );
    }
    for (const old of oldContents)
      expect(native.dispose.mock.calls.filter(([content]) => content === old)).toHaveLength(1);
    disposeTicker(html(host));
  });

  it('bounds rapid pending updates to the visible renderer and one replacement per repeated item', async () => {
    const { host, native, element, options } = setup();
    element.items = [
      { id: 'headline', width: 600, element: createTextElement({ content: 'Visible headline' }) },
    ];
    mountTicker(html(host), element, options, native);
    await waitForTickersReady(host as unknown as ParentNode);
    const oldContents = native.render.mock.calls.map(([content]) => content);
    let release!: () => void;
    native.ready.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    for (let index = 0; index < 12; index++) {
      const next = {
        ...element,
        items: [
          {
            id: 'headline',
            width: 600,
            element: createTextElement({ content: `Pending headline ${index}` }),
          },
        ],
      };
      updateTicker(html(host), next, options);
      for (const wrapper of host.querySelectorAll('[data-ograf-ticker-item]')) {
        expect(wrapper.children).toHaveLength(2);
        expect(wrapper.children.filter((content) => content.style.opacity !== '0')).toHaveLength(1);
      }
      for (const old of oldContents)
        expect(native.dispose.mock.calls.filter(([content]) => content === old)).toHaveLength(0);
    }
    release();
    await waitForTickersReady(host as unknown as ParentNode);
    for (const wrapper of host.querySelectorAll('[data-ograf-ticker-item]')) {
      expect(wrapper.children).toHaveLength(1);
      expect(wrapper.children[0]!.style.visibility).toBe('');
    }
    disposeTicker(html(host));
    for (const [created] of native.render.mock.calls)
      expect(native.dispose.mock.calls.filter(([content]) => content === created)).toHaveLength(1);
  });

  it('prepares shader text with non-inherited opacity instead of baking hidden glyph alpha', async () => {
    const { host, native, element, options } = setup();
    element.items = [
      {
        id: 'shader-text',
        width: 600,
        element: createTextElement({ content: 'VISIBLE SHADER TEXT', fill: createShaderElement() }),
      },
    ];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    native.ready.mockImplementation(async (target) => {
      expect(target.style.opacity).toBe('0');
      for (let node: HTMLElement | null = target; node; node = node.parentElement) {
        expect(node.style.visibility).not.toBe('hidden');
        expect(node.style.display).not.toBe('none');
      }
      await gate;
    });
    mountTicker(html(host), element, options, native);
    for (const [content] of native.render.mock.calls) {
      expect(content.style.visibility).not.toBe('hidden');
      expect(content.style.opacity).toBe('0');
    }
    release();
    await waitForTickersReady(host as unknown as ParentNode);
    for (const [content] of native.render.mock.calls) {
      expect(content.style.visibility).not.toBe('hidden');
      expect(content.style.opacity).toBe('1');
    }
    disposeTicker(html(host));
  });
});
