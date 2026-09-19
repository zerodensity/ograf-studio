import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRectangleLayer,
  createTextLayer,
  createShaderElement,
  type Element,
} from '@ograf-editor/scene-model';
const mocks = vi.hoisted(() => ({
  mask: vi.fn(),
  draw: vi.fn(),
  coverage: vi.fn(),
  update: vi.fn(),
  mount: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock('./shaderPaintMask', () => ({ createShaderPaintMask: mocks.mask }));
vi.mock('./shaderRendering', () => ({
  mountShader: (host: HTMLElement, paint: unknown, size: unknown) => {
    mocks.mount(host, paint, size);
    const canvas = host.ownerDocument.createElement('canvas');
    canvas.dataset.ografShaderCanvas = 'true';
    canvas.width = 640;
    canvas.height = 360;
    host.appendChild(canvas);
  },
  renderShaderAtTime: mocks.draw,
  setShaderCoverage: mocks.coverage,
  updateShaderParameters: mocks.update,
  disposeShader: mocks.dispose,
}));
import {
  disposeShaderPaintContent,
  mountShaderPaintContent,
  renderShaderPaintAtTime,
  shaderPaintBaseElement,
  updateShaderPaintContent,
  updateShaderPaintUniforms,
  waitForShaderPaintContentReady,
  shaderStrokePaddingForLayer,
} from './shaderPaintRendering';

function host(): HTMLElement {
  const children: HTMLElement[] = [];
  return {
    dataset: {},
    style: {},
    children,
    clientWidth: 640,
    clientHeight: 360,
    ownerDocument: { createElement: () => host() },
    appendChild(child: HTMLElement) {
      children.push(child);
      return child;
    },
    querySelector(selector: string) {
      return selector.includes('shader-canvas')
        ? (children.find((child) => child.dataset.ografShaderCanvas === 'true') ?? null)
        : null;
    },
    querySelectorAll() {
      return children;
    },
    setAttribute: vi.fn(),
    remove: vi.fn(),
  } as unknown as HTMLElement;
}
function fixture() {
  const rectangle = createRectangleLayer().element;
  if (rectangle.type !== 'rectangle') throw new Error('Expected rectangle');
  const element: Element = {
    ...rectangle,
    fill: createShaderElement(),
    strokeColor: '#123456',
    strokeWidth: 4,
  };
  const native = {
    render: vi.fn(),
    renderAtTime: vi.fn(),
    ready: vi.fn(async () => {}),
    refreshLayout: vi.fn(),
    dispose: vi.fn(),
  };
  const container = host();
  return { container, element, native };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.update.mockReturnValue(true);
});

describe('shader fill content lifecycle', () => {
  it('updates independent slot uniforms without invalidating native layout or coverage', async () => {
    const mask = { ready: Promise.resolve(), update: vi.fn(async () => null), dispose: vi.fn() };
    mocks.mask.mockReturnValue(mask);
    const { container, native } = fixture();
    const text = createTextLayer().element;
    if (text.type !== 'text') throw new Error('Expected text');
    const paint = createShaderElement();
    const element = { ...text, fill: paint, strokePaint: paint };
    mountShaderPaintContent(container, element, {}, native);
    await waitForShaderPaintContentReady(container);
    const maskCalls = mask.update.mock.calls.length;
    const animated = {
      ...element,
      fill: { ...paint, parameters: { waveFrequency: 3 } },
      strokePaint: { ...paint, parameters: { waveFrequency: 7 } },
    };
    expect(updateShaderPaintUniforms(container, animated)).toBe(true);
    expect(
      mocks.update.mock.calls.map((call) => [
        call[0].dataset.ografShaderSlotHost,
        call[1].parameters,
      ]),
    ).toEqual([
      ['fill', { waveFrequency: 3 }],
      ['stroke', { waveFrequency: 7 }],
    ]);
    expect(native.render).toHaveBeenCalledTimes(1);
    expect(mocks.mount).toHaveBeenCalledTimes(2);
    expect(mocks.mask).toHaveBeenCalledTimes(2);
    expect(mask.update).toHaveBeenCalledTimes(maskCalls);
    renderShaderPaintAtTime(container, 5000);
    await waitForShaderPaintContentReady(container);
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(mocks.draw.mock.calls.at(-1)?.[1]).toBe(5000);
    disposeShaderPaintContent(container);
    expect(mocks.dispose).toHaveBeenCalledTimes(2);
  });
  it('awaits coverage and coalesces pending frame requests to the latest absolute time', async () => {
    let ready = () => {};
    const gate = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const coverage = {} as HTMLCanvasElement;
    const mask = { ready: gate, update: vi.fn(async () => coverage), dispose: vi.fn() };
    mocks.mask.mockReturnValue(mask);
    const { container, element, native } = fixture();
    mountShaderPaintContent(container, element, {}, native);
    renderShaderPaintAtTime(container, 5000);
    renderShaderPaintAtTime(container, 2000);
    let settled = false;
    const readiness = waitForShaderPaintContentReady(container).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    ready();
    await readiness;
    expect(mocks.draw.mock.calls.at(-1)?.[0].dataset.ografShaderSlotHost).toBe('fill');
    expect(mocks.draw.mock.calls.at(-1)?.[1]).toBe(2000);
    expect(mocks.coverage.mock.calls.at(-1)?.[1]).toBe(coverage);
    expect(native.renderAtTime.mock.calls.map((call) => call[2])).toEqual([0, 2000]);
    disposeShaderPaintContent(container);
  });

  it('retains native shape/stroke and coverage when only shader uniform values change', async () => {
    const mask = { ready: Promise.resolve(), update: vi.fn(async () => null), dispose: vi.fn() };
    mocks.mask.mockReturnValue(mask);
    const { container, element, native } = fixture();
    mountShaderPaintContent(container, element, {}, native);
    await waitForShaderPaintContentReady(container);
    if (
      element.type !== 'rectangle' ||
      typeof element.fill === 'string' ||
      element.fill.type !== 'shader'
    )
      throw new Error('Expected shader fill');
    const changed = {
      ...element,
      fill: { ...element.fill, parameters: { ...element.fill.parameters, waveFrequency: 5 } },
    };
    expect(updateShaderPaintContent(container, changed, {})).toBe(true);
    await waitForShaderPaintContentReady(container);
    expect(native.render).toHaveBeenCalledTimes(1);
    expect(mocks.mask).toHaveBeenCalledTimes(1);
    expect(shaderPaintBaseElement(element)).toMatchObject({
      fill: 'transparent',
      strokeColor: '#123456',
      strokeWidth: 4,
    });
    disposeShaderPaintContent(container);
  });

  it('settles pending readiness on disposal and never draws late asynchronous coverage', async () => {
    let ready = () => {};
    const gate = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const mask = {
      ready: gate,
      update: vi.fn(async () => ({}) as HTMLCanvasElement),
      dispose: vi.fn(),
    };
    mocks.mask.mockReturnValue(mask);
    const { container, element, native } = fixture();
    mountShaderPaintContent(container, element, {}, native);
    const pending = waitForShaderPaintContentReady(container);
    disposeShaderPaintContent(container);
    await expect(pending).rejects.toThrow('disposed');
    ready();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.draw).not.toHaveBeenCalled();
    expect(native.dispose).toHaveBeenCalledTimes(1);
    expect(mask.dispose).toHaveBeenCalledTimes(1);
  });
});

describe('independent native text shader fill and outline', () => {
  function textFixture(mode: 'stroke' | 'fill' | 'both') {
    const base = createTextLayer().element;
    if (base.type !== 'text') throw new Error('Expected text');
    const element: Element = {
      ...base,
      content: 'EDITABLE',
      fill: mode === 'stroke' ? '#33ccaa' : createShaderElement(),
      strokeColor: '#112233',
      strokeWidth: 12,
      ...(mode !== 'fill' ? { strokePaint: createShaderElement() } : {}),
    };
    return { ...fixture(), element };
  }

  it('preserves solid fill for shader-only outlines and solid outlines for shader-only fill', () => {
    expect(shaderPaintBaseElement(textFixture('stroke').element)).toMatchObject({
      type: 'text',
      fill: '#33ccaa',
      strokeColor: 'transparent',
      strokeWidth: 12,
      content: 'EDITABLE',
    });
    expect(shaderPaintBaseElement(textFixture('stroke').element)).not.toHaveProperty('strokePaint');
    expect(shaderPaintBaseElement(textFixture('fill').element)).toMatchObject({
      fill: 'transparent',
      strokeColor: '#112233',
      strokeWidth: 12,
    });
    expect(shaderPaintBaseElement(textFixture('both').element)).toMatchObject({
      fill: 'transparent',
      strokeColor: 'transparent',
      strokeWidth: 12,
    });
    const transparent = textFixture('stroke').element;
    if (transparent.type !== 'text') throw new Error('Expected text');
    transparent.fill = 'transparent';
    expect(shaderPaintBaseElement(transparent)).toMatchObject({
      fill: 'transparent',
      strokeWidth: 12,
    });
  });

  it('sizes stable padding from the maximum authored and animated stroke width', () => {
    const { element } = textFixture('both');
    expect(
      shaderStrokePaddingForLayer({
        element,
        animationTracks: { strokeWidth: [{ value: 40 }] },
        loop: { tracks: { strokeWidth: [{ value: 60 }] } },
      }),
    ).toBe(122);
    expect(shaderStrokePaddingForLayer({ element: fixture().element, animationTracks: {} })).toBe(
      0,
    );
  });

  it('keeps two independent shader contexts and one editable native layout through uniform/width edits', async () => {
    mocks.mask.mockImplementation(() => ({
      ready: Promise.resolve(),
      update: vi.fn(async () => null),
      dispose: vi.fn(),
    }));
    const { container, element, native } = textFixture('both');
    const options = { shaderStrokePadding: 82 };
    mountShaderPaintContent(container, element, options, native);
    await waitForShaderPaintContentReady(container);
    expect(mocks.mount).toHaveBeenCalledTimes(2);
    expect(mocks.mask.mock.calls.map((call) => call[3].slot)).toEqual(['fill', 'stroke']);
    expect(mocks.mask.mock.calls.every((call) => call[3].padding === 82)).toBe(true);
    const hosts = mocks.mount.mock.calls.map((call) => call[0]);
    expect(hosts[0].style.zIndex).toBe('2');
    expect(hosts[1].style.zIndex).toBe('0');
    expect(native.render).toHaveBeenCalledTimes(1);
    renderShaderPaintAtTime(container, 5000);
    await waitForShaderPaintContentReady(container);
    if (element.type !== 'text' || !element.strokePaint) throw new Error('Expected text stroke');
    const updated = {
      ...element,
      strokePaint: {
        ...element.strokePaint,
        parameters: { ...element.strokePaint.parameters, waveFrequency: 5 },
      },
    };
    expect(updateShaderPaintContent(container, updated, options)).toBe(true);
    await waitForShaderPaintContentReady(container);
    expect(mocks.mount).toHaveBeenCalledTimes(2);
    expect(mocks.mask).toHaveBeenCalledTimes(2);
    expect(native.render).toHaveBeenCalledTimes(1);
    expect(mocks.update.mock.calls.at(-1)?.[0]).toBe(hosts[1]);
    expect(mocks.update.mock.calls.at(-1)?.[1]).toMatchObject({ parameters: { waveFrequency: 5 } });
    updateShaderPaintContent(container, { ...updated, strokeWidth: 30 }, options);
    await waitForShaderPaintContentReady(container);
    expect(mocks.mount).toHaveBeenCalledTimes(2);
    expect(mocks.mask).toHaveBeenCalledTimes(4);
    expect(native.render).toHaveBeenCalledTimes(2);
    expect(mocks.draw.mock.calls.slice(-2).map((call) => call[1])).toEqual([5000, 5000]);
    disposeShaderPaintContent(container);
    expect(mocks.dispose).toHaveBeenCalledTimes(2);
    expect(native.dispose).toHaveBeenCalledTimes(1);
  });
});
