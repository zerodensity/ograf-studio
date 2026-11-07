import { getTextGradientSource } from './textGradientTint';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultGradient,
  createEllipseElement,
  createRectangleElement,
  createTextElement,
  createImageElement,
  createImageSequenceElement,
  getPaintAtFrame,
  paintToCss,
  type LayerAnimationTracks,
} from '@ograf-editor/scene-model';
import { applyAnimatedPaint, disposeElementContent, renderElementContent } from './renderElement';
import { renderTextAnimationAtFrame, setTextAnimationPrevious } from './textAnimationRendering';

const effectHooks = vi.hoisted(() => ({
  onDispose: null as null | ((host: HTMLElement) => void),
}));
vi.mock('./effectCompositing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./effectCompositing')>();
  return {
    ...actual,
    disposeLayerEffects: (host: HTMLElement) => {
      effectHooks.onDispose?.(host);
      actual.disposeLayerEffects(host);
    },
  };
});

/** Model the CSS shorthand reset that plain style-object renderer mocks cannot reproduce. */
function cssStyle(): CSSStyleDeclaration {
  let background = '';
  let backgroundImage = '';
  const style = {
    backgroundClip: 'border-box',
    webkitBackgroundClip: 'border-box',
    get background() {
      return backgroundImage || background;
    },
    set background(value: string) {
      background = value;
      backgroundImage = value.includes('gradient(') ? value : '';
      style.backgroundClip = 'border-box';
      style.webkitBackgroundClip = 'border-box';
    },
    get backgroundImage() {
      return backgroundImage;
    },
    set backgroundImage(value: string) {
      backgroundImage = value;
    },
  };
  return style as unknown as CSSStyleDeclaration;
}

class FakeElement {
  style = cssStyle();
  dataset: Record<string, string> = {};
  children: FakeElement[] = [];
  attributes: Record<string, string> = {};
  className = '';
  textContent = '';
  parentElement: FakeElement | null = null;
  clientWidth = 200;
  clientHeight = 100;
  offsetLeft = 0;
  offsetTop = 0;
  classList = { contains: (name: string) => this.className.split(/\s+/).includes(name) };

  constructor(
    readonly tagName: string,
    readonly ownerDocument: { createElement: (tag: string) => FakeElement },
  ) {}

  get firstElementChild(): FakeElement | null {
    return this.children[0] ?? null;
  }

  get offsetParent(): FakeElement | null {
    return this.parentElement;
  }

  appendChild(child: FakeElement) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  append(...children: Array<FakeElement | string>) {
    for (const child of children) {
      if (typeof child === 'string') this.textContent += child;
      else this.appendChild(child);
    }
  }

  replaceChildren() {
    this.children = [];
    this.textContent = '';
  }

  remove() {
    if (this.parentElement)
      this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }

  cloneNode(deep = false): FakeElement {
    const clone = this.ownerDocument.createElement(this.tagName);
    Object.assign(clone.style, this.style);
    clone.dataset = { ...this.dataset };
    clone.attributes = { ...this.attributes };
    clone.textContent = this.textContent;
    clone.className = this.className;
    if (deep) for (const child of this.children) clone.appendChild(child.cloneNode(true));
    return clone;
  }

  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }

  getAttribute(name: string) {
    const key = name.startsWith('data-')
      ? name.slice(5).replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())
      : null;
    return (key ? this.dataset[key] : this.attributes[name]) ?? null;
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    if (selector.includes(',')) {
      return [
        ...new Set(selector.split(',').flatMap((part) => this.querySelectorAll(part.trim()))),
      ];
    }
    const attribute = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
    const matches = (child: FakeElement) =>
      attribute
        ? child.getAttribute(attribute[1]!) !== null &&
          (attribute[2] === undefined || child.getAttribute(attribute[1]!) === attribute[2])
        : child.tagName.toLowerCase() === selector.toLowerCase();
    return this.children.flatMap((child) => [
      ...(matches(child) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
}

const document = {
  createElement: (tag: string): FakeElement => new FakeElement(tag.toUpperCase(), document),
};
const dom = (element: FakeElement) => element as unknown as HTMLElement;

const stopTracks: LayerAnimationTracks = {
  'fill.stops[0].offset': [
    { id: 'start', frame: 0, value: 0, easing: 'linear' },
    { id: 'end', frame: 10, value: 0.5, easing: 'linear' },
  ],
};

describe('content opacity across a re-render', () => {
  beforeEach(() => vi.stubGlobal('document', document));
  afterEach(() => {
    effectHooks.onDispose = null;
    vi.unstubAllGlobals();
  });

  it('carries what was authored, not the 0 a shader effect holds the content at', () => {
    const host = document.createElement('div');
    renderElementContent(dom(host), createRectangleElement({ fill: '#ff0000' }));
    const content = host.firstElementChild!;
    content.style.opacity = '0';
    // What a shader effect stack does when it is disposed.
    effectHooks.onDispose = () => {
      content.style.opacity = '0.5';
    };
    renderElementContent(dom(host), createRectangleElement({ fill: '#00a0ff' }));
    expect(host.firstElementChild).not.toBe(content);
    expect(host.firstElementChild!.style.opacity).toBe('0.5');
  });

  it('shows new content when the stack had found nothing authored', () => {
    const host = document.createElement('div');
    renderElementContent(dom(host), createRectangleElement({ fill: '#ff0000' }));
    const content = host.firstElementChild!;
    content.style.opacity = '0';
    effectHooks.onDispose = () => {
      content.style.opacity = '';
    };
    renderElementContent(dom(host), createRectangleElement({ fill: '#00a0ff' }));
    expect(host.firstElementChild!.style.opacity ?? '').toBe('');
  });

  it('still carries the opacity of a fade with no effect involved', () => {
    const host = document.createElement('div');
    renderElementContent(dom(host), createRectangleElement({ fill: '#ff0000' }));
    host.firstElementChild!.style.opacity = '0.4';
    renderElementContent(dom(host), createRectangleElement({ fill: '#00a0ff' }));
    expect(host.firstElementChild!.style.opacity).toBe('0.4');
  });
});

describe('gradient glyph clipping across paint sampling', () => {
  beforeEach(() => vi.stubGlobal('document', document));
  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, 'body');
    Reflect.deleteProperty(document, 'createRange');
    Reflect.deleteProperty(document, 'fonts');
  });

  it('keeps transparent images and image sequences clear of host-page image backgrounds', () => {
    for (const element of [
      createImageElement({ src: 'data:image/png;base64,YQ==' }),
      createImageSequenceElement({ frames: ['data:image/png;base64,YQ=='] }),
    ]) {
      const host = document.createElement('div');
      renderElementContent(dom(host), element);
      expect(host.firstElementChild?.tagName).toBe('IMG');
      expect(host.firstElementChild?.style.background).toBe('transparent');
      disposeElementContent(dom(host));
    }
  });

  it('measures fitted text once across constant paint frames and refits changed boxes or stroke', () => {
    const measure = vi.fn();
    Object.assign(document, {
      body: document.createElement('div'),
      createRange: () => {
        let target: FakeElement;
        return {
          selectNodeContents(node: FakeElement) {
            target = node;
          },
          getBoundingClientRect() {
            measure();
            const size = Number.parseFloat(target.style.fontSize);
            return { width: size * 10, height: size };
          },
          detach() {},
        };
      },
    });
    const host = document.createElement('div');
    const text = createTextElement({ content: 'Headline', autoFit: 'fit-to-width', fontSize: 40 });
    renderElementContent(dom(host), text);
    const measured = measure.mock.calls.length;
    expect(measured).toBeGreaterThan(10);
    const fixedStroke: LayerAnimationTracks = {
      strokeWidth: [{ id: 'fixed', frame: 0, value: 0, easing: 'linear' }],
    };
    for (let frame = 0; frame < 120; frame++) applyAnimatedPaint(dom(host), fixedStroke, frame);
    expect(measure).toHaveBeenCalledTimes(measured);
    const firstFont = Number(host.firstElementChild!.dataset.ografAppliedFontSize);
    host.clientWidth = 100;
    applyAnimatedPaint(dom(host), fixedStroke, 120);
    expect(measure.mock.calls.length).toBeGreaterThan(measured);
    expect(Number(host.firstElementChild!.dataset.ografAppliedFontSize)).toBeLessThan(firstFont);
    const afterResize = measure.mock.calls.length;
    applyAnimatedPaint(dom(host), fixedStroke, 121);
    expect(measure).toHaveBeenCalledTimes(afterResize);
    const wideStroke: LayerAnimationTracks = {
      strokeWidth: [{ id: 'wide', frame: 0, value: 4, easing: 'linear' }],
    };
    applyAnimatedPaint(dom(host), wideStroke, 122);
    expect(measure.mock.calls.length).toBeGreaterThan(afterResize);
    const afterStroke = measure.mock.calls.length;
    applyAnimatedPaint(dom(host), wideStroke, 123);
    expect(measure).toHaveBeenCalledTimes(afterStroke);
    renderElementContent(dom(host), { ...text, content: 'Updated headline' });
    expect(measure.mock.calls.length).toBeGreaterThan(afterStroke);
    disposeElementContent(dom(host));
  });

  it('invalidates fitted text measurement when fonts finish loading with unchanged box geometry', async () => {
    const measure = vi.fn();
    const listeners = new Map<string, () => void>();
    Object.assign(document, {
      body: document.createElement('div'),
      fonts: {
        status: 'loaded',
        ready: Promise.resolve(),
        addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
        removeEventListener: (name: string) => listeners.delete(name),
      },
      createRange: () => {
        let target: FakeElement;
        return {
          selectNodeContents(node: FakeElement) {
            target = node;
          },
          getBoundingClientRect() {
            measure();
            const size = Number.parseFloat(target.style.fontSize);
            return { width: size * 10, height: size };
          },
          detach() {},
        };
      },
    });
    const host = document.createElement('div');
    renderElementContent(
      dom(host),
      createTextElement({ content: 'News', autoFit: 'fit-to-width' }),
    );
    await Promise.resolve();
    const measured = measure.mock.calls.length;
    const stroke: LayerAnimationTracks = {
      strokeWidth: [{ id: 'stroke', frame: 0, value: 0, easing: 'linear' }],
    };
    applyAnimatedPaint(dom(host), stroke, 1);
    expect(measure).toHaveBeenCalledTimes(measured);
    listeners.get('loadingdone')!();
    expect(measure.mock.calls.length).toBeGreaterThan(measured);
    const afterFont = measure.mock.calls.length;
    applyAnimatedPaint(dom(host), stroke, 2);
    expect(measure).toHaveBeenCalledTimes(afterFont);
    disposeElementContent(dom(host));
    expect(listeners.has('loadingdone')).toBe(false);
  });

  it('keeps styled run sizes inherited from the template instead of editor UI span styles', () => {
    const host = document.createElement('div');
    renderElementContent(
      dom(host),
      createTextElement({
        content: 'Styled',
        runs: [{ text: 'Styled', fontStyle: 'italic', fontWeight: 800 }],
        fontSize: 76,
        autoFit: 'fixed',
      }),
    );
    expect(host.firstElementChild!.style.fontSize).toBe('76px');
    expect(
      host.querySelector('[data-ograf-rich-text-flow="true"]')!.firstElementChild!.style,
    ).toMatchObject({
      fontSize: 'inherit',
      fontStyle: 'italic',
      fontWeight: '800',
    });
  });

  it('keeps independently colored static runs in one line flow inside vertical alignment', () => {
    const host = document.createElement('div');
    renderElementContent(
      dom(host),
      createTextElement({
        content: 'BTC   80,000   +2.00%',
        fontSize: 30,
        autoFit: 'fixed',
        verticalAlign: 'middle',
        runs: [
          { text: 'BTC   ', color: '#081521' },
          { text: '80,000   ', color: '#081521', fontWeight: 700 },
          { text: '+2.00%', color: '#08734d' },
        ],
      }),
    );
    const aligned = host.firstElementChild!;
    expect(aligned.style.justifyContent).toBe('center');
    expect(aligned.children).toHaveLength(1);
    const flow = aligned.firstElementChild!;
    expect(flow.style.display).toBe('block');
    expect(flow.style.flexShrink).toBe('0');
    expect(flow.children.map((run) => run.textContent).join('')).toBe('BTC   80,000   +2.00%');
    expect(flow.children.map((run) => run.style.color)).toEqual(['#081521', '#081521', '#08734d']);
    expect(flow.children[1]!.style.fontWeight).toBe('700');
    expect(flow.children.every((run) => !run.style.display)).toBe(true);
  });

  it.each(['linear', 'radial', 'conic'] as const)(
    'retains %s text glyph clipping even without animation tracks',
    (type) => {
      const host = document.createElement('div');
      const fill = createDefaultGradient(type);
      renderElementContent(dom(host), createTextElement({ fill, autoFit: 'fixed' }));
      const glyphs = host.firstElementChild!;
      expect(glyphs.style.backgroundClip).toBe('text');

      applyAnimatedPaint(dom(host), {}, 0);

      expect(glyphs.style.backgroundClip).toBe('text');
      expect(glyphs.style.webkitBackgroundClip).toBe('text');
      expect(glyphs.style.backgroundImage).toBe(paintToCss(fill));
      expect(glyphs.style.color).toBe('transparent');
    },
  );

  it('retains clipping through animated stops, reverse seeking and editor content-host wrapping', () => {
    const layer = document.createElement('div');
    const host = document.createElement('div');
    host.className = 'layer-content-host';
    layer.appendChild(host);
    const fill = createDefaultGradient();
    renderElementContent(dom(host), createTextElement({ fill, autoFit: 'fixed' }));
    const glyphs = host.firstElementChild!;

    for (const frame of [0, 5, 10, 2, 5]) {
      applyAnimatedPaint(dom(layer), stopTracks, frame);
      expect(glyphs.style.backgroundImage).toBe(
        paintToCss(getPaintAtFrame(fill, stopTracks, frame)),
      );
      expect(glyphs.style.backgroundClip).toBe('text');
      expect(glyphs.style.webkitBackgroundClip).toBe('text');
    }
  });

  it('retains the sampled gradient stops for per-glyph color animation', () => {
    const host = document.createElement('div');
    const element = createTextElement({
      content: 'AB',
      fill: createDefaultGradient(),
      autoFit: 'fixed',
    });
    element.textAnimation = { ...element.textAnimation, type: 'rise' };
    renderElementContent(dom(host), element);
    applyAnimatedPaint(dom(host), stopTracks, 5);
    const sampled = getTextGradientSource(dom(host.firstElementChild!));
    expect(sampled?.stops[0]?.offset).toBeCloseTo(0.25);
    expect((element.fill as ReturnType<typeof createDefaultGradient>).stops[0]!.offset).toBe(0);
  });

  it('keeps animated glyph paint on its reveal spans while the flow remains mounted', () => {
    const host = document.createElement('div');
    const element = createTextElement({
      fill: createDefaultGradient(),
      content: 'GOAL',
      autoFit: 'fixed',
    });
    element.textAnimation = { ...element.textAnimation, type: 'typewriter', cursor: 'none' };
    renderElementContent(dom(host), element);
    const flow = host.querySelector('[data-ograf-text-flow="true"]')!;
    expect(flow.querySelectorAll('[data-ograf-text-segment]')).toHaveLength(4);

    applyAnimatedPaint(dom(host), stopTracks, 5);

    expect(host.querySelector('[data-ograf-text-flow="true"]')).toBe(flow);
    expect(host.firstElementChild!.style.backgroundClip).toBe('text');
    expect(host.firstElementChild!.style.webkitBackgroundClip).toBe('text');
    expect(flow.style.backgroundClip).toBe('border-box');
    expect(host.firstElementChild!.style.backgroundImage).toBe('none');
    for (const segment of flow.querySelectorAll('[data-ograf-text-segment]')) {
      expect(segment.style.backgroundImage).toBe(
        paintToCss(getPaintAtFrame(element.fill!, stopTracks, 5)),
      );
      expect(segment.style.backgroundClip).toBe('text');
    }
  });

  it('does not remeasure unchanged connected gradient glyphs on every sampled frame', () => {
    const host = document.createElement('div');
    const element = createTextElement({
      content: 'AB',
      fill: createDefaultGradient(),
      autoFit: 'fixed',
    });
    element.textAnimation = { ...element.textAnimation, type: 'rise', durationFrames: 20 };
    renderElementContent(dom(host), element);
    const content = host.firstElementChild!;
    const flow = content.querySelector('[data-ograf-text-flow="true"]')!;
    const segments = flow.querySelectorAll('[data-ograf-text-segment]');
    Object.defineProperty(content, 'isConnected', { value: true, configurable: true });
    content.clientWidth = 401;
    let reads = 0;
    for (const segment of segments)
      Object.defineProperty(segment, 'offsetLeft', {
        configurable: true,
        get() {
          reads++;
          return 20;
        },
      });
    renderTextAnimationAtFrame(dom(host), element, 3);
    const first = reads;
    expect(first).toBeGreaterThan(0);
    for (const frame of [4, 5, 6, 5]) renderTextAnimationAtFrame(dom(host), element, frame);
    expect(reads).toBe(first);
    content.clientWidth = 402;
    renderTextAnimationAtFrame(dom(host), element, 7);
    expect(reads).toBeGreaterThan(first);
  });

  describe.each(['linear', 'radial', 'conic'] as const)(
    '%s animated glyph fill',
    (gradientType) => {
      it.each(['flip', 'blur', 'rotate', 'stretch'] as const)(
        'keeps %s paint aligned across glyphs at forward and backward frames',
        (type) => {
          const host = document.createElement('div');
          const fill = createDefaultGradient(gradientType);
          const element = createTextElement({ content: 'AB', fill, autoFit: 'fixed' });
          element.textAnimation = { ...element.textAnimation, type, durationFrames: 20 };
          renderElementContent(dom(host), element);
          const content = host.firstElementChild!;
          const flow = content.querySelector('[data-ograf-text-flow="true"]')!;
          const segments = flow.querySelectorAll('[data-ograf-text-segment]');
          content.clientWidth = 400;
          content.clientHeight = 120;
          flow.offsetTop = 18;
          segments[0]!.offsetLeft = 30;
          segments[1]!.offsetLeft = 62;
          for (const frame of [0, 10, 20, 4, 10]) {
            renderTextAnimationAtFrame(dom(host), element, frame);
            applyAnimatedPaint(dom(host), stopTracks, frame);
            expect(content.style.backgroundImage).toBe('none');
            expect(content.style.backgroundColor).toBe('transparent');
            expect(segments.map((segment) => segment.style.backgroundPosition)).toEqual([
              '-30px -18px',
              '-62px -18px',
            ]);
            for (const segment of segments) {
              expect(segment.style.backgroundImage).toBe(
                paintToCss(getPaintAtFrame(fill, stopTracks, frame)),
              );
              expect(segment.style.backgroundSize).toBe('400px 120px');
              expect(segment.style.backgroundClip).toBe('text');
              expect(segment.style.webkitBackgroundClip).toBe('text');
              expect(segment.style.backgroundRepeat).toBe('no-repeat');
            }
          }
          expect(flow.querySelectorAll('[data-ograf-text-segment]')).toEqual(segments);
        },
      );
    },
  );

  it('refreshes per-glyph paint dimensions after fitting, alignment and wrapping change', () => {
    const host = document.createElement('div');
    const element = createTextElement({
      content: 'AB',
      fill: createDefaultGradient(),
      autoFit: 'fixed',
    });
    element.textAnimation = { ...element.textAnimation, type: 'blur', durationFrames: 20 };
    renderElementContent(dom(host), element);
    const content = host.firstElementChild!;
    const flow = content.querySelector('[data-ograf-text-flow="true"]')!;
    const segments = flow.querySelectorAll('[data-ograf-text-segment]');
    renderTextAnimationAtFrame(dom(host), element, 5);
    expect(segments[0]!.style.backgroundSize).toBe('200px 100px');
    content.clientWidth = 320;
    content.clientHeight = 180;
    flow.offsetTop = 12;
    segments[0]!.offsetLeft = 80;
    segments[1]!.offsetLeft = 40;
    segments[1]!.offsetTop = 60;
    renderTextAnimationAtFrame(dom(host), element, 10);
    expect(segments.map((segment) => segment.style.backgroundSize)).toEqual([
      '320px 180px',
      '320px 180px',
    ]);
    expect(segments.map((segment) => segment.style.backgroundPosition)).toEqual([
      '-80px -12px',
      '-40px -72px',
    ]);
  });

  it('paints Word reveal on the moving inner glyph instead of the clipping rectangle', () => {
    const host = document.createElement('div');
    const element = createTextElement({
      content: 'News',
      fill: createDefaultGradient(),
      autoFit: 'fixed',
    });
    element.textAnimation = { ...element.textAnimation, type: 'word-reveal' };
    renderElementContent(dom(host), element);
    const content = host.firstElementChild!;
    const flow = content.querySelector('[data-ograf-text-flow="true"]')!;
    const segment = flow.querySelector('[data-ograf-text-segment]')!;
    const inner = segment.querySelector('[data-ograf-text-segment-inner]')!;
    flow.offsetTop = 10;
    segment.offsetLeft = 30;
    inner.offsetLeft = 4;
    renderTextAnimationAtFrame(dom(host), element, 3);
    expect(content.style.backgroundImage).toBe('none');
    expect(segment.style.backgroundImage).toBe('');
    expect(inner.style.backgroundImage).toBe(paintToCss(element.fill!));
    expect(inner.style.backgroundPosition).toBe('-34px -10px');
    expect(inner.style.backgroundClip).toBe('text');
    expect(inner.style.transform).not.toBe('');
  });

  it.each(['flip', 'blur', 'rotate', 'stretch', 'word-reveal'] as const)(
    'measures %s fitted text without entrance transforms while preserving the live pose',
    (type) => {
      const probes = document.createElement('div');
      const measured: FakeElement[] = [];
      Object.assign(document, {
        body: probes,
        createRange: () => {
          let target: FakeElement;
          return {
            selectNodeContents(node: FakeElement) {
              target = node;
            },
            getBoundingClientRect() {
              measured.push(target);
              const size = Number.parseFloat(target.style.fontSize);
              return { width: size * 1.2, height: size };
            },
            detach() {},
          };
        },
      });
      const host = document.createElement('div');
      const element = createTextElement({
        content: 'AB',
        fill: createDefaultGradient(),
        autoFit: 'fit-to-width',
      });
      element.textAnimation = { ...element.textAnimation, type, durationFrames: 20 };
      renderElementContent(dom(host), element, 5);
      expect(measured.length).toBeGreaterThan(0);
      const probe = probes.firstElementChild!;
      expect(measured.every((node) => node === probe)).toBe(true);
      for (const glyph of probe.querySelectorAll(
        '[data-ograf-text-segment], [data-ograf-text-segment-inner]',
      )) {
        expect(['', 'none']).toContain(glyph.style.transform);
        expect(['', 'none']).toContain(glyph.style.filter);
      }
      const liveSegments = host.querySelectorAll(
        '[data-ograf-text-segment], [data-ograf-text-segment-inner]',
      );
      if (type === 'blur')
        expect(liveSegments.some((glyph) => glyph.style.filter?.startsWith('blur('))).toBe(true);
      else
        expect(
          liveSegments.some((glyph) => glyph.style.transform && glyph.style.transform !== 'none'),
        ).toBe(true);
      expect(host.firstElementChild!.style.backgroundImage).toBe('none');
      const livePaint =
        host.querySelector('[data-ograf-text-segment-inner]') ??
        host.querySelector('[data-ograf-text-segment]')!;
      expect(livePaint.style.backgroundSize).toBe('200px 100px');
    },
  );

  it.each(['count-up', 'count-down'] as const)(
    'keeps one %s gradient host while digits and animated gradient stops change',
    (type) => {
      const host = document.createElement('div');
      const element = createTextElement({
        content: '1,250.00',
        fill: createDefaultGradient(),
        autoFit: 'fixed',
      });
      element.textAnimation = { ...element.textAnimation, type, durationFrames: 20 };
      renderElementContent(dom(host), element, 0);
      const value = host.querySelector('[data-ograf-text-count-value]')!;
      const spacer = host.querySelector('[data-ograf-text-count-spacer]')!;
      const originalDigits = [...value.children];
      expect(value.style.backgroundClip).toBe('text');
      expect(value.style.backgroundSize).toBe('200px 100px');
      expect(value.style.opacity).toBe('1');
      expect(spacer.style.visibility).toBe('hidden');
      renderTextAnimationAtFrame(dom(host), element, 10);
      applyAnimatedPaint(dom(host), stopTracks, 5);
      expect(host.querySelector('[data-ograf-text-count-value]')).toBe(value);
      expect(value.children).toEqual(originalDigits);
      expect(value.style.backgroundImage).toBe(
        paintToCss(getPaintAtFrame(element.fill!, stopTracks, 5)),
      );
      expect(value.style.backgroundClip).toBe('text');
      expect(host.firstElementChild!.style.backgroundImage).toBe('none');
    },
  );

  it('fits counting text against authored digits without sampling the visible counter', () => {
    const probes = document.createElement('div');
    let measurements = 0;
    Object.assign(document, {
      body: probes,
      createRange: () => {
        let target: FakeElement;
        return {
          selectNodeContents(node: FakeElement) {
            target = node;
          },
          getBoundingClientRect() {
            measurements += 1;
            expect(target.querySelector('[data-ograf-text-count-value]')!.style.display).toBe(
              'none',
            );
            expect(target.querySelector('[data-ograf-text-count-spacer]')!.textContent).toBe('12');
            const size = Number.parseFloat(target.style.fontSize);
            return { width: size * 1.2, height: size };
          },
          detach() {},
        };
      },
    });
    const host = document.createElement('div');
    const element = createTextElement({
      content: '12',
      fill: createDefaultGradient(),
      autoFit: 'fit-to-width',
    });
    element.textAnimation = {
      ...element.textAnimation,
      type: 'count-down',
      countFrom: 100000,
      durationFrames: 20,
    };
    renderElementContent(dom(host), element, 0);
    expect(measurements).toBeGreaterThan(0);
    const live = host.querySelector('[data-ograf-text-count-value]')!;
    expect(live.style.display).toBe('block');
    expect(live.children[1]!.textContent).toBe('100000');
    expect(live.style.backgroundClip).toBe('text');
  });

  it.each(['linear', 'radial', 'conic'] as const)(
    'paints both rolling rows with the same aligned %s gradient',
    (type) => {
      const host = document.createElement('div');
      const element = createTextElement({
        content: '12:59',
        fill: { ...createDefaultGradient(), type },
        autoFit: 'fixed',
      });
      element.textAnimation = { ...element.textAnimation, type: 'roll-up', durationFrames: 20 };
      renderElementContent(dom(host), element, 0);
      setTextAnimationPrevious(dom(host), createTextElement({ content: '12:58' }));
      const slots = host.querySelectorAll('[data-ograf-text-roll-slot]');
      slots.forEach((slot, index) => {
        slot.offsetLeft = index * 20;
        slot.offsetTop = 7;
      });
      renderTextAnimationAtFrame(dom(host), element, 10);
      const outgoing = host.querySelectorAll('[data-ograf-text-roll-old]');
      const incoming = host.querySelectorAll('[data-ograf-text-roll-new]');
      for (let index = 0; index < slots.length; index += 1) {
        for (const row of [outgoing[index]!, incoming[index]!]) {
          expect(row.style.backgroundImage).toBe(paintToCss(element.fill!));
          expect(row.style.backgroundClip).toBe('text');
          expect(row.style.backgroundSize).toBe('200px 100px');
          expect(row.style.backgroundPosition).toBe(`${-index * 20}px -7px`);
        }
      }
      expect(outgoing[4]!.style.transform).toBe('translateY(-87.5%)');
      expect(incoming[4]!.style.transform).toBe('translateY(12.5%)');
      expect(incoming[2]!.style.transform).toBe('');
      applyAnimatedPaint(dom(host), stopTracks, 5);
      const sampledPaint = paintToCss(getPaintAtFrame(element.fill!, stopTracks, 5));
      expect(outgoing.every((row) => row.style.backgroundImage === sampledPaint)).toBe(true);
      expect(incoming.every((row) => row.style.backgroundImage === sampledPaint)).toBe(true);
      setTextAnimationPrevious(dom(host), createTextElement({ content: '12:57' }));
      expect(host.querySelectorAll('[data-ograf-text-roll-new]')).toEqual(incoming);
      expect(incoming.every((row) => row.style.backgroundImage === sampledPaint)).toBe(true);
    },
  );

  it('paints newly needed count rolling cells across a carry and backward seek', () => {
    const host = document.createElement('div');
    const element = createTextElement({
      content: '$10',
      fill: createDefaultGradient(),
      autoFit: 'fixed',
    });
    element.textAnimation = {
      ...element.textAnimation,
      type: 'count-up',
      countRoll: 'up',
      countFrom: 9,
      durationFrames: 20,
    };
    renderElementContent(dom(host), element, 0);
    const paints = () => host.querySelectorAll('[data-ograf-text-roll-paint]');
    renderTextAnimationAtFrame(dom(host), element, 20);
    expect(paints().every((row) => row.style.backgroundImage === paintToCss(element.fill!))).toBe(
      true,
    );
    const originalPaints = [...paints()];
    renderTextAnimationAtFrame(dom(host), element, 0);
    expect(paints()).toEqual(originalPaints);
    expect(paints().every((row) => row.style.backgroundClip === 'text')).toBe(true);
    expect(host.firstElementChild!.style.backgroundImage).toBe('none');
  });

  it.each([
    ['rectangle', createRectangleElement],
    ['ellipse', createEllipseElement],
  ] as const)(
    'continues painting %s gradient and solid fills across their boxes',
    (_kind, create) => {
      const host = document.createElement('div');
      const fill = createDefaultGradient();
      renderElementContent(dom(host), create({ fill }));
      applyAnimatedPaint(dom(host), stopTracks, 5);
      expect(host.firstElementChild!.style.backgroundImage).toBe(
        paintToCss(getPaintAtFrame(fill, stopTracks, 5)),
      );
      expect(host.firstElementChild!.style.backgroundClip).toBe('border-box');
      expect(host.firstElementChild!.style.webkitBackgroundClip).toBe('border-box');

      renderElementContent(dom(host), create({ fill: '#ff3366' }));
      applyAnimatedPaint(dom(host), {}, 5);
      expect(host.firstElementChild!.style.background).toBe('#ff3366');
      expect(host.firstElementChild!.style.backgroundClip).toBe('border-box');
    },
  );

  it('updates only the dedicated path-fill surface without changing its box clipping', () => {
    const host = document.createElement('div');
    const path = document.createElement('div');
    const fillSurface = document.createElement('div');
    fillSurface.dataset.ografPathFill = 'true';
    path.appendChild(fillSurface);
    host.appendChild(path);
    const fill = createDefaultGradient();
    host.dataset.ografBasePaint = JSON.stringify(fill);

    applyAnimatedPaint(dom(host), stopTracks, 5);

    expect(fillSurface.style.backgroundImage).toBe(
      paintToCss(getPaintAtFrame(fill, stopTracks, 5)),
    );
    expect(fillSurface.style.backgroundClip).toBe('border-box');
    expect(path.style.background).toBe('');
  });
});
