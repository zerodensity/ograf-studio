import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLayerOfKind, createTilingPattern } from '@ograf-editor/scene-model';
import {
  createShaderPaintMask,
  shaderMaskContainRect,
  shaderMaskEllipsis,
  shaderMaskUsesEllipsis,
} from './shaderPaintMask';

afterEach(() => vi.unstubAllGlobals());

function fixture(width = 200, height = 100) {
  const contexts: ReturnType<typeof makeContext>[] = [];
  function makeContext() {
    return {
      resetTransform: vi.fn(),
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      scale: vi.fn(),
      translate: vi.fn(),
      beginPath: vi.fn(),
      roundRect: vi.fn(),
      ellipse: vi.fn(),
      fill: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) })),
      fillStyle: '',
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      filter: 'none',
    };
  }
  const document = {
    createElement: vi.fn(() => {
      const context = makeContext();
      contexts.push(context);
      return { width: 0, height: 0, getContext: () => context };
    }),
  };
  const host = {
    ownerDocument: document,
    clientWidth: width,
    clientHeight: height,
    style: { width: `${width}px`, height: `${height}px`, opacity: '0' },
    querySelector: vi.fn(() => null as unknown),
    querySelectorAll: vi.fn(() => [] as unknown[]),
  };
  return {
    contexts,
    host: host as unknown as HTMLElement,
    query: host.querySelector,
    queryAll: host.querySelectorAll,
  };
}

function nativeTextFixture() {
  const base = fixture();
  const element = createLayerOfKind('text').element;
  if (element.type !== 'text') throw Error('Expected text');
  element.content = 'O B\nمرحبا';
  element.strokeWidth = 6;
  const contexts = base.contexts as Array<
    (typeof base.contexts)[number] & {
      font: string;
      direction: string;
      lineWidth: number;
      lineJoin: string;
      miterLimit: number;
      fillText: ReturnType<typeof vi.fn>;
      strokeText: ReturnType<typeof vi.fn>;
    }
  >;
  const style = {
    cssText: 'font-size:41.2px;-webkit-text-stroke-width:6px',
    setProperty: vi.fn(),
  };
  const computed = {
    fontStyle: 'normal',
    fontWeight: '700',
    fontSize: '41.2px',
    fontFamily: 'Arial',
    fontKerning: 'auto',
    letterSpacing: '1px',
    wordSpacing: '0px',
    direction: 'rtl',
    textTransform: 'none',
    transform: 'none',
    transformOrigin: '0px 0px',
    textOverflow: 'clip',
    display: 'flex',
    whiteSpace: 'pre-wrap',
    overflowX: 'visible',
    overflowY: 'visible',
    webkitTextStrokeWidth: '6px',
    strokeLinejoin: 'miter',
    strokeMiterlimit: '4',
    getPropertyValue: vi.fn(() => ''),
  };
  const document = base.host.ownerDocument;
  const bounds = { left: 0, top: 0, width: 200, height: 100 };
  const clone = () => ({
    ownerDocument: document,
    firstChild: { nodeType: 3, textContent: element.content },
    style: { ...style },
    getBoundingClientRect: () => bounds,
  });
  const original = {
    getAttribute: () => null,
    style,
    textContent: element.content,
    cloneNode: vi.fn(clone),
  };
  const createCanvas = document.createElement.bind(document);
  Object.assign(document, {
    defaultView: { getComputedStyle: () => computed },
    body: { appendChild: vi.fn() },
    createElement: vi.fn((tag: string) => {
      if (tag === 'div')
        return {
          style: {},
          appendChild: vi.fn(),
          getBoundingClientRect: () => bounds,
          remove: vi.fn(),
        };
      const canvas = createCanvas(tag);
      const context = contexts.at(-1)!;
      Object.assign(context, {
        font: '',
        direction: '',
        lineWidth: 1,
        lineJoin: '',
        miterLimit: 10,
        fillText: vi.fn(),
        strokeText: vi.fn(),
        measureText: (text: string) => ({ width: text.length * 20, fontBoundingBoxAscent: 30 }),
      });
      return canvas;
    }),
    createRange: () => {
      let offset = 0;
      return {
        setStart: (_node: unknown, value: number) => {
          offset = value;
        },
        setEnd: vi.fn(),
        detach: vi.fn(),
        getClientRects: () => {
          const previous = element.content.slice(0, offset);
          const row = previous.split('\n').length - 1;
          const column = previous.slice(previous.lastIndexOf('\n') + 1).length;
          return [{ left: 10 + column * 20, top: 5 + row * 50, height: 40 }];
        },
      };
    },
  });
  Object.assign(base.host, { children: [original] });
  return {
    ...base,
    element,
    contexts,
    computed,
    setStrokeWidth(width: number) {
      computed.webkitTextStrokeWidth = `${width}px`;
      style.cssText = `font-size:41.2px;-webkit-text-stroke-width:${width}px`;
    },
  };
}

describe('shader fill coverage', () => {
  it('uses the same native shaped lines for fill and centered glyph stroke without filling the stroke mask', async () => {
    const fixture = nativeTextFixture();
    const fill = createShaderPaintMask(fixture.host, fixture.element, { width: 200, height: 100 });
    const stroke = createShaderPaintMask(
      fixture.host,
      fixture.element,
      { width: 200, height: 100 },
      { slot: 'stroke' },
    );
    await fill.update();
    await stroke.update();
    const face = fixture.contexts[0]!,
      outline = fixture.contexts[1]!;
    expect(face.fillText.mock.calls).toEqual([
      ['O B', 10, 35],
      ['مرحبا', 10, 85],
    ]);
    expect(outline.strokeText.mock.calls).toEqual(face.fillText.mock.calls);
    expect(face.strokeText).not.toHaveBeenCalled();
    expect(outline.fillText).not.toHaveBeenCalled();
    expect(outline.fillRect).not.toHaveBeenCalled();
    expect(outline.font).toBe(face.font);
    expect(outline.font).toContain('41.2px');
    expect(outline.direction).toBe('rtl');
    expect(outline.lineWidth).toBe(6);
    expect(outline.lineJoin).toBe('miter');
    expect(outline.miterLimit).toBe(4);
    fill.dispose();
    stroke.dispose();
  });

  it('invalidates stroke coverage for animated width and clears it at an explicit zero width', async () => {
    const fixture = nativeTextFixture();
    const mask = createShaderPaintMask(
      fixture.host,
      fixture.element,
      { width: 200, height: 100 },
      { slot: 'stroke' },
    );
    await mask.update();
    const context = fixture.contexts[0]!;
    expect(await mask.update(100)).toBeNull();
    expect(context.strokeText).toHaveBeenCalledTimes(2);
    fixture.setStrokeWidth(12);
    expect(await mask.update(200)).not.toBeNull();
    expect(context.lineWidth).toBe(12);
    expect(context.strokeText).toHaveBeenCalledTimes(4);
    fixture.setStrokeWidth(0);
    expect(await mask.update(300)).not.toBeNull();
    expect(context.strokeText).toHaveBeenCalledTimes(4);
    expect(context.clearRect).toHaveBeenCalledTimes(3);
    fixture.setStrokeWidth(4);
    Object.assign(fixture.host, { clientWidth: 250 });
    expect(await mask.update(400)).not.toBeNull();
    expect(context.lineWidth).toBe(4);
    expect(context.scale).toHaveBeenLastCalledWith(0.8, 1);
    mask.dispose();
  });

  it('aligns padded fill and stroke coverage while retaining native overflow clipping', async () => {
    const visible = nativeTextFixture();
    const fill = createShaderPaintMask(
      visible.host,
      visible.element,
      { width: 216, height: 116 },
      { padding: 8 },
    );
    const stroke = createShaderPaintMask(
      visible.host,
      visible.element,
      { width: 216, height: 116 },
      { slot: 'stroke', padding: 8 },
    );
    await fill.update();
    await stroke.update();
    for (const context of visible.contexts) {
      expect(context.scale).toHaveBeenCalledWith(1, 1);
      expect(context.translate).toHaveBeenCalledWith(8, 8);
      expect(context.clip).not.toHaveBeenCalled();
    }
    expect(visible.contexts[0]!.fillText.mock.calls).toEqual(
      visible.contexts[1]!.strokeText.mock.calls,
    );
    fill.dispose();
    stroke.dispose();

    const clipped = nativeTextFixture();
    clipped.computed.overflowX = clipped.computed.overflowY = 'hidden';
    const clippedStroke = createShaderPaintMask(
      clipped.host,
      clipped.element,
      { width: 216, height: 116 },
      { slot: 'stroke', padding: 8 },
    );
    await clippedStroke.update();
    expect(clipped.contexts[0]!.rect).toHaveBeenCalledWith(0, 0, 200, 100);
    expect(clipped.contexts[0]!.clip).toHaveBeenCalledOnce();
    clippedStroke.dispose();
  });

  it('fits source alpha using the same contain rectangle as native image content', () => {
    expect(shaderMaskContainRect({ width: 100, height: 100 }, { width: 300, height: 100 })).toEqual(
      { x: 100, y: 0, width: 100, height: 100 },
    );
    expect(() =>
      shaderMaskContainRect({ width: 0, height: 100 }, { width: 300, height: 100 }),
    ).toThrow(/decoded dimensions/);
  });

  it('clips rectangle coverage to authored rounded corners and reuses unchanged geometry', async () => {
    const { host, contexts } = fixture();
    const element = createLayerOfKind('rectangle').element;
    if (element.type !== 'rectangle') throw Error('Expected rectangle');
    element.borderRadius = { topLeft: 20, topRight: 10, bottomRight: 5, bottomLeft: 0 };
    element.strokeWidth = 12;
    const mask = createShaderPaintMask(host, element, { width: 400, height: 200 });
    expect(await mask.update()).not.toBeNull();
    expect(contexts[0]!.scale).toHaveBeenCalledWith(2, 2);
    expect(contexts[0]!.roundRect).toHaveBeenCalledWith(0, 0, 200, 100, [20, 10, 5, 0]);
    expect(contexts[0]!.fillRect).not.toHaveBeenCalled();
    expect(await mask.update(500)).toBeNull();
    element.borderRadius.topLeft = 30;
    expect(await mask.update(600)).not.toBeNull();
    mask.dispose();
    await expect(mask.update()).rejects.toThrow(/disposed/);
  });

  it('uses an ellipse rather than opaque rectangular coverage', async () => {
    const { host, contexts } = fixture();
    const mask = createShaderPaintMask(host, createLayerOfKind('ellipse').element, {
      width: 400,
      height: 200,
    });
    await mask.update();
    expect(contexts[0]!.ellipse).toHaveBeenCalledWith(200, 100, 200, 100, 0, 0, Math.PI * 2);
    expect(contexts[0]!.fillRect).not.toHaveBeenCalled();
    mask.dispose();
  });

  it('preserves path holes and excludes the independently rendered stroke', async () => {
    class TestPath {
      constructor(readonly source: string) {}
    }
    vi.stubGlobal('Path2D', TestPath);
    const { host, contexts } = fixture();
    const element = createLayerOfKind('path').element;
    if (element.type !== 'path') throw Error('Expected path');
    element.d = 'M0 0H100V100H0Z M25 25H75V75H25Z';
    element.viewBoxWidth = element.viewBoxHeight = 100;
    element.fillRule = 'evenodd';
    element.strokeWidth = 9;
    const mask = createShaderPaintMask(host, element, { width: 200, height: 100 });
    await mask.update();
    expect(contexts[0]!.fill).toHaveBeenCalledWith(
      expect.objectContaining({ source: element.d }),
      'evenodd',
    );
    expect(contexts[0]!.scale).toHaveBeenCalledWith(2, 1);
    mask.dispose();
  });

  it('reads original image alpha even when the native base host is hidden', async () => {
    const { host, contexts, query } = fixture(300, 100);
    const image = {
      complete: true,
      naturalWidth: 100,
      naturalHeight: 100,
      currentSrc: 'data:image/png;base64,test',
    };
    query.mockReturnValue(image);
    const mask = createShaderPaintMask(host, createLayerOfKind('image').element, {
      width: 300,
      height: 100,
    });
    await mask.update();
    expect(contexts[0]!.drawImage).toHaveBeenCalledWith(image, 100, 0, 100, 100);
    expect(contexts[0]!.getImageData).toHaveBeenCalled();
    expect(await mask.update(1000)).toBeNull();
    mask.dispose();
  });

  it('fails clearly for unreadable source alpha instead of substituting a box', async () => {
    const { host, contexts, query } = fixture();
    query.mockReturnValue({
      complete: true,
      naturalWidth: 100,
      naturalHeight: 100,
      src: 'https://example.test/no-cors.png',
    });
    const mask = createShaderPaintMask(host, createLayerOfKind('image').element, {
      width: 200,
      height: 100,
    });
    contexts[0]!.getImageData.mockImplementation(() => {
      throw new DOMException('Tainted', 'SecurityError');
    });
    await expect(mask.update()).rejects.toThrow(/cross-origin.*CORS-enabled/);
    mask.dispose();
  });

  it('cancels pending media readiness when disposed', async () => {
    const { host, query } = fixture();
    const image = Object.assign(new EventTarget(), {
      complete: false,
      naturalWidth: 0,
      naturalHeight: 0,
    });
    query.mockReturnValue(image);
    const mask = createShaderPaintMask(host, createLayerOfKind('image').element, {
      width: 200,
      height: 100,
    });
    mask.dispose();
    await expect(mask.ready).rejects.toThrow(/disposed/);
  });

  it('keeps missing image content transparent', async () => {
    const { host, contexts } = fixture();
    const mask = createShaderPaintMask(host, createLayerOfKind('image').element, {
      width: 200,
      height: 100,
    });
    expect(await mask.update()).not.toBeNull();
    expect(contexts[0]!.clearRect).toHaveBeenCalled();
    expect(contexts[0]!.fillRect).not.toHaveBeenCalled();
    expect(contexts[0]!.drawImage).not.toHaveBeenCalled();
    mask.dispose();
  });

  it('refreshes native fitting after fonts load and caches the settled style until layout changes', async () => {
    const { host } = fixture();
    const element = createLayerOfKind('text').element;
    if (element.type !== 'text') throw Error('Expected text');
    element.content = '';
    const content = {
      getAttribute: () => null,
      style: { cssText: 'font-size:42px' },
      textContent: '',
    };
    Object.assign(host, { children: [content] });
    let releaseFont = () => {};
    const fonts = {
      load: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            releaseFont = resolve;
          }),
      ),
      ready: Promise.resolve(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    Object.assign(host.ownerDocument, { fonts });
    const refreshTextLayout = vi.fn(() => {
      content.style.cssText = 'font-size:31.2px';
    });
    const mask = createShaderPaintMask(
      host,
      element,
      { width: 200, height: 100 },
      { refreshTextLayout },
    );
    const first = mask.update();
    expect(refreshTextLayout).not.toHaveBeenCalled();
    releaseFont();
    expect(await first).not.toBeNull();
    expect(refreshTextLayout).toHaveBeenCalledTimes(1);
    expect(await mask.update(500)).toBeNull();
    expect(refreshTextLayout).toHaveBeenCalledTimes(1);
    Object.assign(host, { clientWidth: 250 });
    expect(await mask.update(600)).not.toBeNull();
    expect(refreshTextLayout).toHaveBeenCalledTimes(2);
    mask.dispose();
  });

  it('keeps native font fallback after a face-load failure while still waiting for font-set readiness', async () => {
    const fixture = nativeTextFixture();
    fixture.element.fontFamily = 'Missing Brand, Arial';
    fixture.computed.fontFamily = 'Missing Brand, Arial';
    let releaseReady = () => {};
    const fonts = {
      load: vi.fn(() => Promise.reject(new Error('Font file returned 404'))),
      ready: new Promise<void>((resolve) => {
        releaseReady = resolve;
      }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    Object.assign(fixture.host.ownerDocument, { fonts });
    const refreshTextLayout = vi.fn();
    const mask = createShaderPaintMask(
      fixture.host,
      fixture.element,
      { width: 200, height: 100 },
      { refreshTextLayout },
    );
    const update = mask.update();
    await Promise.resolve();
    await Promise.resolve();
    expect(refreshTextLayout).not.toHaveBeenCalled();
    expect(fixture.contexts[0]!.fillText).not.toHaveBeenCalled();
    releaseReady();
    await expect(mask.ready).resolves.toBeUndefined();
    expect(await update).not.toBeNull();
    expect(refreshTextLayout).toHaveBeenCalledTimes(1);
    expect(fixture.contexts[0]!.font).toContain('Missing Brand, Arial');
    expect(fixture.contexts[0]!.fillText).toHaveBeenCalled();
    mask.dispose();
  });

  it('does not swallow mask layout failures when using a failed font face fallback', async () => {
    const fixture = nativeTextFixture();
    Object.assign(fixture.host.ownerDocument, {
      fonts: {
        load: vi.fn(() => Promise.reject(new Error('Font file returned 404'))),
        ready: Promise.resolve(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    const mask = createShaderPaintMask(
      fixture.host,
      fixture.element,
      { width: 200, height: 100 },
      {
        refreshTextLayout: () => {
          throw new Error('Native text layout failed');
        },
      },
    );
    await expect(mask.ready).resolves.toBeUndefined();
    await expect(mask.update()).rejects.toThrow('Native text layout failed');
    mask.dispose();
  });

  it('copies each Lottie timestamp using the native canvas presentation offsets', async () => {
    const { host, contexts, query } = fixture();
    const canvas = {
      width: 200,
      height: 100,
      style: { left: '25px', top: '-10px', width: '150px', height: '120px', cssText: 'test' },
    };
    query.mockReturnValue(canvas);
    const mask = createShaderPaintMask(host, createLayerOfKind('lottie').element, {
      width: 400,
      height: 200,
    });
    await mask.update(1000);
    expect(contexts[0]!.scale).toHaveBeenCalledWith(2, 2);
    expect(contexts[0]!.drawImage).toHaveBeenCalledWith(canvas, 25, -10, 150, 120);
    expect(await mask.update(1000)).toBeNull();
    expect(await mask.update(2000)).not.toBeNull();
    expect(await mask.update(1000)).not.toBeNull();
    mask.dispose();
  });

  it('moves combined pattern geometry with the native row offset and preserves row opacity', async () => {
    vi.stubGlobal(
      'Path2D',
      class {
        constructor(readonly source: string) {}
      },
    );
    const { host, contexts, query, queryAll } = fixture();
    let offset = '4';
    const row = { getAttribute: () => offset };
    query.mockReturnValue(row);
    queryAll.mockReturnValue([row]);
    const element = createLayerOfKind('pattern').element;
    if (element.type !== 'pattern') throw Error('Expected pattern');
    element.definition = createTilingPattern({
      width: 200,
      height: 100,
      rows: 1,
      rowOverrides: [{ row: 0, opacity: 0.5 }],
    });
    const mask = createShaderPaintMask(host, element, { width: 200, height: 100 });
    await mask.update();
    expect(contexts[1]!.clip).toHaveBeenCalled();
    expect(contexts[1]!.fill).toHaveBeenCalled();
    expect(contexts[0]!.globalAlpha).toBe(0.5);
    expect(await mask.update()).toBeNull();
    offset = '12';
    expect(await mask.update()).not.toBeNull();
    mask.dispose();
  });

  it('keeps ellipsis clipping on Unicode character boundaries', () => {
    const measure = (text: string) => Array.from(text).length * 10;
    expect(shaderMaskEllipsis('ABC😀DEF', 50, measure)).toBe('ABC😀…');
    expect(shaderMaskEllipsis('A', 5, measure)).toBe('');
  });

  it('matches native clipping for fixed text instead of adding an ellipsis to direct flex text', () => {
    const nativeStyle = {
      display: 'flex',
      textOverflow: 'ellipsis',
      overflowX: 'hidden',
      whiteSpace: 'nowrap',
    };
    expect(shaderMaskUsesEllipsis(nativeStyle)).toBe(false);
    expect(shaderMaskUsesEllipsis({ ...nativeStyle, display: 'inline-flex' })).toBe(false);
    expect(shaderMaskUsesEllipsis({ ...nativeStyle, display: 'block' })).toBe(true);
    // Squeeze text is a block, but its visible overflow does not paint an ellipsis either.
    expect(
      shaderMaskUsesEllipsis({
        ...nativeStyle,
        display: 'block',
        overflowX: 'visible',
        whiteSpace: 'pre',
      }),
    ).toBe(false);
  });
});
