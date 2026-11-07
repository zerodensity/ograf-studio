import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMediaPaint,
  createRectangleElement,
  createTextElement,
  createChartElement,
  LIVE_MEDIA_ELEMENT_TAG,
  type Element,
} from '@ograf-editor/scene-model';
import {
  disposeMediaPaintContent,
  mountMediaPaintContent,
  renderMediaPaintAtTime,
  updateMediaPaintContent,
  waitForMediaPaintContentReady,
} from './mediaPaintRendering';

const maskFactory = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('./shaderPaintMask', () => ({ createShaderPaintMask: maskFactory.create }));

class Frame {
  constructor(
    readonly width = 2,
    readonly height = 2,
    readonly alpha: (x: number, y: number) => number = () => 1,
  ) {}
}

class FakeElement extends EventTarget {
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  children: FakeElement[] = [];
  clientWidth = 2;
  clientHeight = 2;

  constructor(readonly ownerDocument: FakeDocument) {
    super();
  }

  appendChild(child: FakeElement) {
    this.children.push(child);
    return child;
  }

  querySelectorAll(_selector: string): FakeElement[] {
    return this.children.flatMap((child) => [child, ...child.querySelectorAll('*')]);
  }

  removeAttribute(name: string) {
    if (name === 'src' && 'src' in this) this.src = '';
  }
}

class FakeVideo extends FakeElement {
  src = '';
  readyState = 2;
  videoWidth = 2;
  videoHeight = 2;
  duration = 60;
  currentTime = 0;
  pause = vi.fn();
  play = vi.fn(async () => undefined);
  load = vi.fn();
  alpha = () => 1;
}

class FakeImage extends FakeElement {
  src = '';
  complete = true;
  naturalWidth = 2;
  naturalHeight = 2;
}

class FakeLive extends FakeElement {
  getFrame = vi.fn(async () => new Frame());
  ready = Promise.resolve();
}

class FakeContext {
  globalCompositeOperation = 'source-over';
  resetTransform = vi.fn();
  drawCalls: Array<{
    source: Frame | FakeVideo;
    operation: string;
    width: number;
    height: number;
  }> = [];
  pixels: number[] = [];

  constructor(readonly canvas: FakeCanvas) {}

  clearRect = vi.fn(() => {
    this.pixels = Array(this.canvas.width * this.canvas.height).fill(0);
  });

  drawImage(source: Frame | FakeVideo, _x: number, _y: number, width: number, height: number) {
    this.drawCalls.push({ source, operation: this.globalCompositeOperation, width, height });
    const sourceWidth = source instanceof FakeVideo ? source.videoWidth : source.width;
    const sourceHeight = source instanceof FakeVideo ? source.videoHeight : source.height;
    for (let y = 0; y < this.canvas.height; y++) {
      for (let x = 0; x < this.canvas.width; x++) {
        const alpha = source.alpha(
          Math.floor((x / this.canvas.width) * sourceWidth),
          Math.floor((y / this.canvas.height) * sourceHeight),
        );
        const index = y * this.canvas.width + x;
        this.pixels[index] =
          this.globalCompositeOperation === 'destination-in'
            ? (this.pixels[index] ?? 0) * alpha
            : alpha;
      }
    }
  }
}

class FakeCanvas extends FakeElement {
  width = 2;
  height = 2;
  context = new FakeContext(this);

  getContext(kind: string) {
    return kind === '2d' ? this.context : null;
  }
}

class FakeDocument {
  created: FakeElement[] = [];

  createElement(tag: string) {
    const element =
      tag === 'canvas'
        ? new FakeCanvas(this)
        : tag === 'video'
          ? new FakeVideo(this)
          : tag === 'img'
            ? new FakeImage(this)
            : tag === LIVE_MEDIA_ELEMENT_TAG
              ? new FakeLive(this)
              : new FakeElement(this);
    this.created.push(element);
    return element;
  }
}

function fixture(
  source: 'live' | 'clip',
  maskFrames: Array<Frame | null>,
  size = { width: 2, height: 2 },
  authoredElement?: Element,
) {
  const document = new FakeDocument();
  const host = document.createElement('div');
  const mask = {
    ready: Promise.resolve(),
    update: vi.fn(async () => (maskFrames.length ? maskFrames.shift()! : null)),
    dispose: vi.fn(),
  };
  maskFactory.create.mockReturnValueOnce(mask);
  const native = {
    render: vi.fn(),
    renderAtTime: vi.fn(),
    ready: vi.fn(async () => undefined),
    refreshLayout: vi.fn(),
    dispose: vi.fn(),
  };
  const element: Element =
    authoredElement ??
    createRectangleElement({
      fill: createMediaPaint({
        source:
          source === 'live'
            ? { kind: 'live', tag: 'test.synthetic' }
            : { kind: 'clip', src: 'synthetic-clip.mp4' },
        fit: 'fill',
      }),
    });
  const domHost = host as unknown as HTMLElement;
  mountMediaPaintContent(domHost, element, { shaderBackingSize: size }, native);
  const canvas = document.created.find((item) => item instanceof FakeCanvas)! as FakeCanvas;
  return { host: domHost, document, element, mask, native, canvas, context: canvas.context };
}

function shapeMask() {
  return new Frame(2, 2, (x, y) => (x === 1 && y === 0 ? 1 : 0));
}

describe('Media paint masks on repeated frames', () => {
  beforeEach(() => {
    maskFactory.create.mockReset();
    vi.stubGlobal('HTMLVideoElement', FakeVideo);
    vi.stubGlobal('HTMLImageElement', FakeImage);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('retains the chart media decoder when values change, with separate mark coverage', async () => {
    const element = createChartElement({
      fill: createMediaPaint({ source: { kind: 'clip', src: 'synthetic-clip.mp4' }, fit: 'fill' }),
    });
    const mounted = fixture('clip', [shapeMask()], { width: 2, height: 2 }, element);
    await waitForMediaPaintContentReady(mounted.host);
    const decoder = mounted.document.created.find(
      (entry) => entry instanceof FakeVideo,
    ) as FakeVideo;
    decoder.currentTime = 10;
    const mask = {
      ready: Promise.resolve(),
      update: vi.fn(async () => shapeMask()),
      dispose: vi.fn(),
    };
    maskFactory.create.mockReturnValueOnce(mask);
    const updated = structuredClone(element);
    updated.data.datasets[0]!.data[0] = 80;
    expect(updateMediaPaintContent(mounted.host, updated, {})).toBe(true);
    await waitForMediaPaintContentReady(mounted.host);
    expect(mounted.document.created.filter((entry) => entry instanceof FakeVideo)).toEqual([
      decoder,
    ]);
    expect(decoder.load).toHaveBeenCalledTimes(1);
    expect(mounted.native.render).toHaveBeenCalledTimes(2);
    expect(mounted.context.pixels).toEqual([0, 1, 0, 0]);
    disposeMediaPaintContent(mounted.host);
  });

  it('hides styled text base colors without losing typography or changing authored runs', async () => {
    const element = createTextElement({
      content: 'Live capture',
      color: '#123456',
      fontFamily: 'Nunito',
      fontWeight: 600,
      fill: createMediaPaint({ source: { kind: 'live', tag: 'test.synthetic' }, fit: 'fill' }),
      runs: [
        {
          text: 'Live',
          color: '#ff0000',
          fontFamily: 'Arial',
          fontWeight: 800,
          fontStyle: 'italic',
        },
        { text: ' capture', color: '#00ff00', fontWeight: 400 },
      ],
    });
    const authored = structuredClone(element);
    const mounted = fixture('live', [shapeMask()], { width: 2, height: 2 }, element);
    await waitForMediaPaintContentReady(mounted.host);
    const base = mounted.native.render.mock.calls[0]?.[1] as typeof element;
    expect(base).toMatchObject({
      fill: 'transparent',
      color: 'transparent',
      fontFamily: 'Nunito',
      fontWeight: 600,
      runs: [
        {
          text: 'Live',
          color: 'transparent',
          fontFamily: 'Arial',
          fontWeight: 800,
          fontStyle: 'italic',
        },
        { text: ' capture', color: 'transparent', fontWeight: 400 },
      ],
    });
    expect(base.runs).not.toBe(element.runs);
    expect(base.runs[0]).not.toBe(element.runs[0]);
    expect(base.runs[1]).not.toBe(element.runs[1]);
    expect(element).toEqual(authored);
    disposeMediaPaintContent(mounted.host);
  });

  it.each(['live', 'clip'] as const)(
    'clips every %s frame even when the shared mask reports unchanged coverage',
    async (source) => {
      const coverage = shapeMask();
      const mounted = fixture(source, [coverage, null, null, null]);
      await waitForMediaPaintContentReady(mounted.host);
      expect(mounted.context.pixels).toEqual([0, 1, 0, 0]);

      for (const time of [40, 80, 40]) {
        expect(renderMediaPaintAtTime(mounted.host, time)).toBe(true);
        await waitForMediaPaintContentReady(mounted.host);
        expect(mounted.context.pixels).toEqual([0, 1, 0, 0]);
        expect(mounted.context.drawCalls.at(-1)).toMatchObject({
          source: coverage,
          operation: 'destination-in',
        });
        expect(mounted.context.globalCompositeOperation).toBe('source-over');
      }
      expect(mounted.mask.update).toHaveBeenCalledTimes(4);
      expect(mounted.context.drawCalls.filter((draw) => draw.source === coverage)).toHaveLength(4);
      disposeMediaPaintContent(mounted.host);
    },
  );

  it('marks each new live frame so a held effect stack can refresh its capture', async () => {
    const mounted = fixture('live', [shapeMask(), null, null]);
    await waitForMediaPaintContentReady(mounted.host);
    const first = mounted.canvas.dataset.ografMediaFrame;
    expect(first).toBeDefined();
    expect(renderMediaPaintAtTime(mounted.host, 0)).toBe(true);
    await waitForMediaPaintContentReady(mounted.host);
    expect(mounted.canvas.dataset.ografMediaFrame).not.toBe(first);
    disposeMediaPaintContent(mounted.host);
  });

  it('keeps a live fallback frame marked as unchanged', async () => {
    const element = createRectangleElement({
      fill: createMediaPaint({
        source: { kind: 'live', tag: 'test.synthetic', fallback: 'still.png' },
        fit: 'fill',
      }),
    });
    const mounted = fixture('live', [shapeMask(), null], { width: 2, height: 2 }, element);
    const live = mounted.document.created.find((item) => item instanceof FakeLive) as FakeLive;
    const fallback = mounted.document.created.find(
      (item) => item instanceof FakeImage,
    ) as FakeImage & { alpha: () => number; width: number; height: number };
    Object.assign(fallback, { alpha: () => 1, width: 2, height: 2 });
    live.getFrame.mockResolvedValue(null as unknown as Frame);
    await waitForMediaPaintContentReady(mounted.host);
    const first = mounted.canvas.dataset.ografMediaFrame;
    expect(first).toBe('fallback');
    expect(renderMediaPaintAtTime(mounted.host, 0)).toBe(true);
    await waitForMediaPaintContentReady(mounted.host);
    expect(mounted.canvas.dataset.ografMediaFrame).toBe(first);
    disposeMediaPaintContent(mounted.host);
  });

  it('marks a clip frame by decoded position, unchanged while it is held', async () => {
    const mounted = fixture('clip', [shapeMask(), null, null, null]);
    await waitForMediaPaintContentReady(mounted.host);
    const video = mounted.document.created.find((item) => item instanceof FakeVideo) as FakeVideo;
    const first = mounted.canvas.dataset.ografMediaFrame;
    expect(first).toBe(String(video.currentTime));
    expect(renderMediaPaintAtTime(mounted.host, 0)).toBe(true);
    await waitForMediaPaintContentReady(mounted.host);
    expect(mounted.canvas.dataset.ografMediaFrame).toBe(first);
    expect(renderMediaPaintAtTime(mounted.host, 2000)).toBe(true);
    await waitForMediaPaintContentReady(mounted.host);
    expect(mounted.canvas.dataset.ografMediaFrame).toBe('2');
    disposeMediaPaintContent(mounted.host);
  });

  it('reuses cached alpha on the editor fast update path and accepts refreshed mask coverage', async () => {
    const first = shapeMask();
    const second = new Frame(2, 2, (x, y) => (x === 0 && y === 1 ? 1 : 0));
    const mounted = fixture('live', [first, null, second, null]);
    await waitForMediaPaintContentReady(mounted.host);
    expect(updateMediaPaintContent(mounted.host, mounted.element, {})).toBe(true);
    await waitForMediaPaintContentReady(mounted.host);
    expect(mounted.context.pixels).toEqual([0, 1, 0, 0]);
    renderMediaPaintAtTime(mounted.host, 80);
    await waitForMediaPaintContentReady(mounted.host);
    expect(mounted.context.pixels).toEqual([0, 0, 1, 0]);
    renderMediaPaintAtTime(mounted.host, 120);
    await waitForMediaPaintContentReady(mounted.host);
    expect(mounted.context.drawCalls.at(-1)?.source).toBe(second);
    expect(mounted.context.pixels).toEqual([0, 0, 1, 0]);
    disposeMediaPaintContent(mounted.host);
  });

  it.each(['live', 'clip'] as const)(
    'keeps %s output transparent until the first alpha coverage is available',
    async (source) => {
      const coverage = shapeMask();
      const mounted = fixture(source, [null, null, coverage]);
      await waitForMediaPaintContentReady(mounted.host);
      expect(mounted.context.pixels).toEqual([0, 0, 0, 0]);
      expect(mounted.context.drawCalls).toHaveLength(0);
      renderMediaPaintAtTime(mounted.host, 40);
      await waitForMediaPaintContentReady(mounted.host);
      expect(mounted.context.pixels).toEqual([0, 0, 0, 0]);
      expect(mounted.context.drawCalls).toHaveLength(0);
      renderMediaPaintAtTime(mounted.host, 80);
      await waitForMediaPaintContentReady(mounted.host);
      expect(mounted.context.pixels).toEqual([0, 1, 0, 0]);
      disposeMediaPaintContent(mounted.host);
    },
  );

  it.each(['live', 'clip'] as const)(
    'disposes %s coverage and recomputes it after remount at a new backing size',
    async (source) => {
      const mounted = fixture(source, [shapeMask()]);
      await waitForMediaPaintContentReady(mounted.host);
      const draws = mounted.context.drawCalls.length;
      disposeMediaPaintContent(mounted.host);
      expect(mounted.mask.dispose).toHaveBeenCalledOnce();
      expect(mounted.native.dispose).toHaveBeenCalledOnce();
      expect(mounted.canvas.width).toBe(1);
      expect(mounted.canvas.height).toBe(1);
      expect(renderMediaPaintAtTime(mounted.host, 40)).toBe(false);
      expect(mounted.context.drawCalls).toHaveLength(draws);
      if (source === 'clip') {
        const video = mounted.document.created.find(
          (item) => item instanceof FakeVideo,
        )! as FakeVideo;
        expect(video.pause).toHaveBeenCalled();
        expect(video.src).toBe('');
      }
      const resizedCoverage = new Frame(4, 4, (x, y) => (x >= 2 && y < 2 ? 1 : 0));
      const remounted = fixture(source, [null, resizedCoverage, null], { width: 4, height: 4 });
      await waitForMediaPaintContentReady(remounted.host);
      expect(remounted.context.pixels).toEqual(Array(16).fill(0));
      expect(remounted.context.drawCalls).toHaveLength(0);
      expect(maskFactory.create.mock.calls.at(-1)?.[2]).toEqual({ width: 4, height: 4 });
      for (const time of [40, 80]) {
        renderMediaPaintAtTime(remounted.host, time);
        await waitForMediaPaintContentReady(remounted.host);
        expect(remounted.context.drawCalls.at(-1)).toMatchObject({
          source: resizedCoverage,
          operation: 'destination-in',
          width: 4,
          height: 4,
        });
        expect(remounted.context.pixels).toEqual([0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
      }
      disposeMediaPaintContent(remounted.host);
    },
  );
});
