import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTextElement,
  createImageSequenceElement,
  createTickerElement,
  type Element,
} from '@ograf-editor/scene-model';
import type { ElementContentRenderOptions } from './renderElement';
import {
  disposeTicker,
  getTickerUpdateStatuses,
  inheritTickerPlayback,
  mountTicker,
  renderTickerAtTime,
  renderTickerHistory,
  setTickerDeterministicRendering,
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
const trackOf = (host: MockNode) => host.querySelector('[data-ograf-ticker-track="true"]')!;
const viewportOf = (host: MockNode) => host.querySelector('[data-ograf-ticker="true"]')!;
const offsetOf = (host: MockNode) => Number(viewportOf(host).dataset.ografTickerOffset);
function setupNext(direction: 'left' | 'right' = 'left', width = 400, short = false) {
  const host = new MockNode();
  host.style.width = String(width);
  host.clientWidth = width;
  const native = {
    render: vi.fn(
      (target: HTMLElement, element: Element, _options: ElementContentRenderOptions) => {
        target.dataset.ografRenderedElement = JSON.stringify(element);
        target.textContent = element.type === 'text' ? element.content : element.type;
      },
    ),
    renderAtTime: vi.fn(
      (
        _target: HTMLElement,
        _element: Element,
        _elapsed: number,
        _options: { playing?: boolean },
      ) => {},
    ),
    ready: vi.fn(async (_target: HTMLElement) => {}),
    dispose: vi.fn(),
  };
  const element = createTickerElement({
    direction,
    speedPixelsPerSecond: 100,
    gap: 20,
    items: short
      ? [{ id: 'a', width: 80, element: createTextElement({ content: 'Old A' }) }]
      : ['a', 'b', 'c'].map((id) => ({
          id,
          width: 120,
          element: createTextElement({ content: `Old ${id.toUpperCase()}` }),
        })),
  });
  return { host, native, element, options: { frameRate: 50 } };
}
const copies = (host: MockNode) => host.querySelectorAll('[data-ograf-ticker-item]');
function visibleCopies(host: MockNode, width = host.clientWidth) {
  return copies(host).filter((node) => {
    const x = Number.parseFloat(node.style.left!) + offsetOf(host);
    return x < width && x + Number.parseFloat(node.style.width!) > 0;
  });
}
const shownTexts = (node: MockNode) =>
  node.children.filter((child) => child.style.opacity !== '0').map((child) => child.textContent);
const settle = async () => {
  for (let step = 0; step < 8; step++) await Promise.resolve();
};
afterEach(() => vi.unstubAllGlobals());

describe('native next-appearance ticker rendering', () => {
  it('canonicalizes hidden retiring canvases when seeking offline after a live readiness fallback', async () => {
    const { host, native, element, options } = setupNext('left', 400, true);
    native.render.mockImplementation((target, content) => {
      target.dataset.ografRenderedElement = JSON.stringify(content);
      target.textContent = content.type === 'text' ? content.content : content.type;
      target.appendChild(target.ownerDocument.createElement('canvas'));
    });
    let releaseReplacement!: () => void;
    const replacementReady = new Promise<void>((resolve) => {
      releaseReplacement = resolve;
    });
    native.ready.mockImplementation(async (target) => {
      if (target.textContent?.startsWith('New')) await replacementReady;
    });
    mountTicker(html(host), element, options, native);
    await waitForTickersReady(host as unknown as ParentNode);
    renderTickerAtTime(html(host), element, 250, { playing: true });
    const changed = {
      ...element,
      items: [
        { ...element.items[0]!, width: 100, element: createTextElement({ content: 'New A' }) },
      ],
    };
    updateTicker(html(host), changed, options);
    await settle();
    for (let time = 300; time <= 1800; time += 100) {
      renderTickerAtTime(html(host), changed, time, { playing: true });
      await settle();
    }
    expect(copies(host).some((node) => node.querySelectorAll('canvas').length > 1)).toBe(true);
    releaseReplacement();
    await settle();
    setTickerDeterministicRendering(host as unknown as ParentNode, true);
    renderTickerHistory(html(host), element, [{ timestamp: 250, element: changed }], 1000);
    await waitForTickersReady(host as unknown as ParentNode);
    expect(copies(host).every((node) => node.querySelectorAll('canvas').length === 1)).toBe(true);
    disposeTicker(html(host));
  });
  it('refreshes a reused pass identity when an offline source revision changes its item ID', async () => {
    const { host, native, element, options } = setupNext('left', 400, true);
    mountTicker(html(host), element, options, native);
    await waitForTickersReady(host as unknown as ParentNode);
    setTickerDeterministicRendering(host as unknown as ParentNode, true);
    renderTickerHistory(html(host), element, [], 500);
    await waitForTickersReady(host as unknown as ParentNode);
    const previous = new Map(copies(host).map((node) => [node.dataset.ografTickerPass, node]));
    const revised = {
      ...element,
      items: [
        {
          id: 'different',
          width: 80,
          element: createTextElement({ content: 'Different identity' }),
        },
      ],
    };
    renderTickerHistory(html(host), revised, [], 100);
    await waitForTickersReady(host as unknown as ParentNode);
    const reused = copies(host).filter(
      (node) => previous.get(node.dataset.ografTickerPass) === node,
    );
    expect(reused.length).toBeGreaterThan(0);
    for (const node of copies(host)) {
      expect(node.dataset.ografTickerItem).toBe('different');
      expect(shownTexts(node)).toEqual(['Different identity']);
    }
    disposeTicker(html(host));
  });
  it('keeps deterministic DOM pass/canvas ordering stable after repeated backward seeks', async () => {
    const { host, native, element, options } = setupNext('left');
    native.render.mockImplementation((target, content) => {
      target.dataset.ografRenderedElement = JSON.stringify(content);
      target.textContent = content.type === 'text' ? content.content : content.type;
      const canvas = target.ownerDocument.createElement('canvas');
      canvas.dataset.content = target.textContent;
      target.appendChild(canvas);
    });
    native.renderAtTime.mockImplementation((target, _content, time) => {
      for (const canvas of target.querySelectorAll<HTMLElement>('canvas'))
        canvas.dataset.sampleTime = String(time);
    });
    mountTicker(html(host), element, options, native);
    await waitForTickersReady(host as unknown as ParentNode);
    setTickerDeterministicRendering(host as unknown as ParentNode, true);
    const changed = {
      ...element,
      items: [
        { id: 'inserted', width: 140, element: createTextElement({ content: 'Inserted' }) },
        ...element.items,
      ],
    };
    const history = [{ timestamp: 200, element: changed }];
    const capture = async (time: number) => {
      renderTickerHistory(html(host), element, history, time);
      await waitForTickersReady(host as unknown as ParentNode);
      renderTickerAtTime(html(host), changed, time, { playing: false });
      return trackOf(host).children.map((node) => ({
        pass: node.dataset.ografTickerPass,
        item: node.dataset.ografTickerItem,
        canvases: node.querySelectorAll('canvas').map((canvas) => ({ ...canvas.dataset })),
      }));
    };
    const expected = await capture(2300);
    expect(
      expected.every((row) => row.canvases.every((canvas) => canvas.sampleTime === '2300')),
    ).toBe(true);
    await capture(0);
    expect(await capture(2300)).toEqual(expected);
    await capture(900);
    expect(await capture(2300)).toEqual(expected);
    // History sampling itself also advances rebuilt native children before returning.
    native.renderAtTime.mockClear();
    renderTickerHistory(html(host), element, history, 1250);
    expect(native.renderAtTime).toHaveBeenCalled();
    expect(native.renderAtTime.mock.calls.every(([, , time]) => time === 1250)).toBe(true);
    disposeTicker(html(host));
  });
  it('releases decoded sequences after old passes and bounded spares retire', async () => {
    const { host, native, options } = setupNext();
    const decoded: string[] = [];
    const originalCreate = host.ownerDocument.createElement;
    host.ownerDocument.createElement = (name) => {
      const node = originalCreate(name);
      if (name === 'img')
        Object.assign(node, {
          decode: async () => {
            decoded.push((node as unknown as HTMLImageElement).src);
          },
        });
      return node;
    };
    const sequence = (version: number) =>
      createTickerElement({
        direction: 'left',
        gap: 20,
        speedPixelsPerSecond: 100,
        items: [
          {
            id: 'sequence',
            width: 300,
            element: createImageSequenceElement({
              frames: [`version-${version}-a.png`, `version-${version}-b.png`],
              fps: 12,
            }),
          },
        ],
      });
    let element = sequence(0);
    mountTicker(html(host), element, options, native);
    await waitForTickersReady(host as unknown as ParentNode);
    renderTickerAtTime(html(host), element, 100, { playing: true });
    for (let version = 1; version <= 12; version++) {
      element = sequence(version);
      updateTicker(html(host), element, options);
      await settle();
      renderTickerAtTime(html(host), element, version * 10_000, { playing: true });
      await settle();
    }
    expect(decoded.filter((source) => source === 'version-0-a.png')).toHaveLength(1);
    element = sequence(0);
    updateTicker(html(host), element, options);
    await settle();
    expect(decoded.filter((source) => source === 'version-0-a.png')).toHaveLength(2);
    disposeTicker(html(host));
  });
  it('keeps decoded old sequences while a pinned visible pass still uses them', async () => {
    const { host, native, options } = setupNext();
    const decoded: string[] = [];
    const originalCreate = host.ownerDocument.createElement;
    host.ownerDocument.createElement = (name) => {
      const node = originalCreate(name);
      if (name === 'img')
        Object.assign(node, {
          decode: async () => {
            decoded.push((node as unknown as HTMLImageElement).src);
          },
        });
      return node;
    };
    const oldItem = {
      id: 'sequence',
      width: 300,
      element: createImageSequenceElement({ frames: ['old-a.png', 'old-b.png'], fps: 12 }),
    };
    const element = createTickerElement({
      direction: 'left',
      speedPixelsPerSecond: 100,
      gap: 20,
      items: [oldItem],
    });
    mountTicker(html(host), element, options, native);
    await waitForTickersReady(host as unknown as ParentNode);
    renderTickerAtTime(html(host), element, 100, { playing: true });
    const changed = {
      ...element,
      items: [
        {
          ...oldItem,
          element: createImageSequenceElement({ frames: ['new-a.png', 'new-b.png'], fps: 12 }),
        },
      ],
    };
    updateTicker(html(host), changed, options);
    await settle();
    updateTicker(
      html(host),
      { ...changed, items: [...changed.items, { ...oldItem, id: 'inserted-old-source' }] },
      options,
    );
    await settle();
    expect(decoded.filter((source) => source === 'old-a.png')).toHaveLength(1);
    disposeTicker(html(host));
  });
  it('stops superseded sequence decoding before the next four-frame batch', async () => {
    const { host, native, options } = setupNext();
    let resolveBatch!: () => void;
    const batch = new Promise<void>((resolve) => {
      resolveBatch = resolve;
    });
    const decoded: string[] = [];
    const originalCreate = host.ownerDocument.createElement;
    host.ownerDocument.createElement = (name) => {
      const node = originalCreate(name);
      if (name === 'img')
        Object.assign(node, {
          decode: async () => {
            decoded.push((node as unknown as HTMLImageElement).src);
            await batch;
          },
        });
      return node;
    };
    const element = createTickerElement({
      items: [
        {
          id: 'sequence',
          width: 300,
          element: createImageSequenceElement({
            frames: Array.from({ length: 12 }, (_, index) => `frame-${index}.png`),
            fps: 12,
          }),
        },
      ],
    });
    mountTicker(html(host), element, options, native);
    expect(decoded).toHaveLength(4);
    disposeTicker(html(host));
    resolveBatch();
    await settle();
    expect(decoded).toHaveLength(4);
  });
  it('reports failed replacement preparation while keeping already-on-air content ready', async () => {
    const { host, native, element, options } = setupNext();
    mountTicker(html(host), element, options, native);
    await waitForTickersReady(host as unknown as ParentNode);
    renderTickerAtTime(html(host), element, 100, { playing: true });
    native.ready.mockImplementation(async (target) => {
      if (target.textContent?.startsWith('New')) throw Error('New replacement failed to decode');
    });
    const changed = {
      ...element,
      items: element.items.map((item) => ({
        ...item,
        element: createTextElement({ content: `New ${item.id}` }),
      })),
    };
    updateTicker(html(host), changed, options);
    await settle();
    await expect(waitForTickersReady(host as unknown as ParentNode)).resolves.toBeUndefined();
    const status = getTickerUpdateStatuses(host as unknown as ParentNode)[0]!;
    expect(status.pendingCount).toBeGreaterThan(0);
    expect(status.error).toContain('failed to decode');
    expect(
      visibleCopies(host).every((node) => shownTexts(node).some((text) => text.startsWith('Old'))),
    ).toBe(true);
    disposeTicker(html(host));
  });
  it('reports distinct pending queues for multiple tickers and clears disposed instances', async () => {
    const first = setupNext(),
      second = setupNext('right');
    first.host.dataset.layerId = 'first';
    second.host.dataset.layerId = 'second';
    const parent = new MockNode();
    parent.append(first.host, second.host);
    for (const entry of [first, second]) {
      mountTicker(html(entry.host), entry.element, entry.options, entry.native);
      await waitForTickersReady(entry.host as unknown as ParentNode);
    }
    const original = getTickerUpdateStatuses(parent as unknown as ParentNode);
    expect(original).toHaveLength(2);
    expect(new Set(original.map((row) => row.id)).size).toBe(2);
    renderTickerAtTime(html(first.host), first.element, 100, { playing: true });
    updateTicker(
      html(first.host),
      {
        ...first.element,
        items: first.element.items.map((item) => ({
          ...item,
          element: createTextElement({ content: 'Changed' }),
        })),
      },
      first.options,
    );
    await settle();
    const statuses = getTickerUpdateStatuses(parent as unknown as ParentNode);
    expect(statuses.find((row) => row.layerId === 'first')).toMatchObject({
      policy: 'next-appearance',
      pendingCount: 3,
      updatedCount: 3,
    });
    expect(statuses.find((row) => row.layerId === 'second')?.pendingCount).toBe(0);
    disposeTicker(html(first.host));
    expect(getTickerUpdateStatuses(parent as unknown as ParentNode)).toHaveLength(1);
    disposeTicker(html(second.host));
  });
  it('reconstructs data-update passes identically after non-realtime backward and repeated seeks', async () => {
    const { host, native, element, options } = setupNext();
    mountTicker(html(host), element, options, native);
    await waitForTickersReady(host as unknown as ParentNode);
    setTickerDeterministicRendering(host as unknown as ParentNode, true);
    const changed = {
      ...element,
      items: [
        { id: 'new', width: 140, element: createTextElement({ content: 'New entry' }) },
        ...element.items.map((item) => ({
          ...item,
          width: 180,
          element: createTextElement({ content: `New ${item.id}` }),
        })),
      ],
    };
    const history = [{ timestamp: 200, element: changed }];
    const capture = async (time: number) => {
      renderTickerHistory(html(host), element, history, time);
      await waitForTickersReady(host as unknown as ParentNode);
      renderTickerAtTime(html(host), changed, time, { playing: false });
      return visibleCopies(host)
        .map((node) => ({
          pass: node.dataset.ografTickerPass,
          x: Number.parseFloat(node.style.left!) + offsetOf(host),
          width: node.style.width,
          text: shownTexts(node),
        }))
        .sort((a, b) => a.x - b.x);
    };
    const expected = await capture(2300);
    await capture(100);
    expect(await capture(2300)).toEqual(expected);
    await capture(900);
    expect(await capture(2300)).toEqual(expected);
    disposeTicker(html(host));
  });
  it('inherits coordinated replacement snapshots after the prior mounted output is disposed', async () => {
    const first = setupNext();
    mountTicker(html(first.host), first.element, first.options, first.native);
    await waitForTickersReady(first.host as unknown as ParentNode);
    renderTickerAtTime(html(first.host), first.element, 1000, { playing: true });
    const expected = visibleCopies(first.host)
      .map((node) => ({
        x: Number.parseFloat(node.style.left!) + offsetOf(first.host),
        text: shownTexts(node),
      }))
      .sort((a, b) => a.x - b.x);
    const next = setupNext();
    next.element = {
      ...next.element,
      items: next.element.items.map((item) => ({
        ...item,
        width: 180,
        element: createTextElement({ content: 'New replacement' }),
      })),
    };
    mountTicker(html(next.host), next.element, next.options, next.native);
    await waitForTickersReady(next.host as unknown as ParentNode);
    expect(inheritTickerPlayback(html(first.host), html(next.host), 1000)).toBe(true);
    disposeTicker(html(first.host));
    await waitForTickersReady(next.host as unknown as ParentNode);
    renderTickerAtTime(html(next.host), next.element, 1000, { playing: true });
    const actual = visibleCopies(next.host)
      .map((node) => ({
        x: Number.parseFloat(node.style.left!) + offsetOf(next.host),
        text: shownTexts(node),
      }))
      .sort((a, b) => a.x - b.x);
    expect(actual).toEqual(expected);
    expect(Number(viewportOf(next.host).dataset.ografTickerPending)).toBeGreaterThan(0);
    disposeTicker(html(next.host));
  });
  it('has prepared admitted content immediately after a long realtime timestamp jump', async () => {
    const { host, native, element, options } = setupNext('left');
    mountTicker(html(host), element, options, native);
    await waitForTickersReady(host as unknown as ParentNode);
    renderTickerAtTime(html(host), element, 100, { playing: true });
    renderTickerAtTime(html(host), element, 60_000, { playing: true });
    expect(visibleCopies(host).length).toBeGreaterThan(0);
    expect(visibleCopies(host).every((node) => shownTexts(node).length > 0)).toBe(true);
    expect(visibleCopies(host).every((node) => node.dataset.ografTickerAdmitted === 'true')).toBe(
      true,
    );
    disposeTicker(html(host));
  });
  for (const direction of ['left', 'right'] as const) {
    it(`pins visible text/width and compositor identity during ${direction} edits`, async () => {
      const { host, native, element, options } = setupNext(direction);
      mountTicker(html(host), element, options, native);
      await waitForTickersReady(host as unknown as ParentNode);
      renderTickerAtTime(html(host), element, 200, { playing: true });
      const before = visibleCopies(host).map((node) => ({
        node,
        x: Number.parseFloat(node.style.left!) + offsetOf(host),
        width: node.style.width,
        text: shownTexts(node),
      }));
      const track = trackOf(host),
        animation = track.getAnimations()[0];
      const changed = {
        ...element,
        items: element.items.map((item) => ({
          ...item,
          width: 180,
          element: createTextElement({ content: `New ${item.id}` }),
        })),
      };
      updateTicker(html(host), changed, options);
      await settle();
      renderTickerAtTime(html(host), changed, 200, { playing: true });
      expect(trackOf(host)).toBe(track);
      expect(track.getAnimations()[0]).toBe(animation);
      for (const row of before) {
        expect(copies(host)).toContain(row.node);
        expect(Number.parseFloat(row.node.style.left!) + offsetOf(host)).toBeCloseTo(row.x, 9);
        expect(row.node.style.width).toBe(row.width);
        expect(shownTexts(row.node)).toEqual(row.text);
      }
      expect(Number(viewportOf(host).dataset.ografTickerPending)).toBeGreaterThan(0);
      for (let time = 300; time <= 8000; time += 100) {
        renderTickerAtTime(html(host), changed, time, { playing: true });
        await settle();
      }
      expect(
        visibleCopies(host).every((node) =>
          shownTexts(node).some((text) => text.startsWith('New')),
        ),
      ).toBe(true);
      expect(Number(viewportOf(host).dataset.ografTickerPending)).toBe(0);
      disposeTicker(html(host));
    });

    it(`keeps removed visible ${direction} copies until full exit and inserts only offscreen`, async () => {
      const { host, native, element, options } = setupNext(direction);
      mountTicker(html(host), element, options, native);
      await waitForTickersReady(host as unknown as ParentNode);
      renderTickerAtTime(html(host), element, 100, { playing: true });
      const before = visibleCopies(host);
      const target = before[0]!.dataset.ografTickerItem;
      const changed = {
        ...element,
        items: [
          { id: 'new', width: 150, element: createTextElement({ content: 'New entry' }) },
          ...element.items.filter((item) => item.id !== target),
        ],
      };
      updateTicker(html(host), changed, options);
      await settle();
      renderTickerAtTime(html(host), changed, 100, { playing: true });
      for (const node of before) expect(copies(host)).toContain(node);
      expect(visibleCopies(host).some((node) => node.dataset.ografTickerItem === 'new')).toBe(
        false,
      );
      for (let time = 200; time <= 8000; time += 100) {
        renderTickerAtTime(html(host), changed, time, { playing: true });
        await settle();
      }
      expect(copies(host).some((node) => node.dataset.ografTickerItem === target)).toBe(false);
      expect(visibleCopies(host).some((node) => node.dataset.ografTickerItem === 'new')).toBe(true);
      expect(viewportOf(host).dataset.ografTickerPending).toBe('0');
      disposeTicker(html(host));
    });

    it(`replaces ${direction} short-feed copies independently while older copies remain visible`, async () => {
      const { host, native, element, options } = setupNext(direction, 400, true);
      mountTicker(html(host), element, options, native);
      await waitForTickersReady(host as unknown as ParentNode);
      renderTickerAtTime(html(host), element, 250, { playing: true });
      const changed = {
        ...element,
        items: [
          { ...element.items[0]!, width: 100, element: createTextElement({ content: 'New A' }) },
        ],
      };
      updateTicker(html(host), changed, options);
      await settle();
      for (let time = 300; time <= 1800; time += 100) {
        renderTickerAtTime(html(host), changed, time, { playing: true });
        await settle();
      }
      const shown = visibleCopies(host).flatMap(shownTexts);
      expect(shown).toContain('Old A');
      expect(shown).toContain('New A');
      disposeTicker(html(host));
    });
  }

  it('coalesces rapid replacements and retains old visible pixels until replacement preparation finishes', async () => {
    const { host, native, element, options } = setupNext('left');
    let resolveReplacement!: () => void;
    const gate = new Promise<void>((resolve) => {
      resolveReplacement = resolve;
    });
    native.ready.mockImplementation(async (target) => {
      if (target.textContent?.startsWith('New')) await gate;
    });
    mountTicker(html(host), element, options, native);
    await waitForTickersReady(host as unknown as ParentNode);
    renderTickerAtTime(html(host), element, 100, { playing: true });
    const changed = {
      ...element,
      items: element.items.map((item) => ({
        ...item,
        element: createTextElement({ content: `New ${item.id}` }),
      })),
    };
    updateTicker(html(host), changed, options);
    await settle();
    for (let time = 200; time <= 1000; time += 100) {
      renderTickerAtTime(html(host), changed, time, { playing: true });
      await settle();
    }
    expect(
      visibleCopies(host).every((node) => shownTexts(node).some((text) => text.startsWith('Old'))),
    ).toBe(true);
    expect(Number(viewportOf(host).dataset.ografTickerPending)).toBeGreaterThan(0);
    resolveReplacement();
    await settle();
    for (let time = 1100; time <= 9000; time += 100) {
      renderTickerAtTime(html(host), changed, time, { playing: true });
      await settle();
    }
    expect(
      visibleCopies(host).every((node) => shownTexts(node).some((text) => text.startsWith('New'))),
    ).toBe(true);
    expect(viewportOf(host).dataset.ografTickerPending).toBe('0');
    disposeTicker(html(host));
  });
});
