import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LayerTransform, TextElement } from '@ograf-editor/scene-model';
import { expressionSourceRect } from '@ograf-editor/scene-model';
import { measureExpressionText } from './expressionTextBounds';
import { renderElementContent } from './renderElement';

vi.mock('./renderElement', () => ({
  renderElementContent: vi.fn(),
  disposeElementContent: vi.fn(),
}));

const text = {
  type: 'text',
  content: 'Hello',
  fontSize: 40,
  fontFamily: 'sans-serif',
} as TextElement;
const transform = {
  x: 0,
  y: 0,
  width: 400,
  height: 100,
  rotation: 0,
  opacity: 1,
} as LayerTransform;
function fakeDocument() {
  const fonts = Object.assign(new Set<{ status: string }>(), {
    status: 'loaded',
    addEventListener: vi.fn(),
  });
  const measure = vi.fn(() => ({ left: 3, top: 4, width: 80, height: 40 }));
  const remove = vi.fn();
  const doc = {
    fonts,
    body: { appendChild: vi.fn() },
    createElement: vi.fn(() => ({
      style: {},
      firstElementChild: { dataset: {} as Record<string, string> },
      remove,
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
    })),
    createRange: () => ({ selectNodeContents: vi.fn(), getBoundingClientRect: measure }),
  };
  vi.stubGlobal('document', doc);
  return { doc, fonts, measure, remove };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('expression text measurement cache', () => {
  it('reuses geometry across moving/fading frames and returns detached bounds', () => {
    const { measure, remove } = fakeDocument();
    const first = measureExpressionText(text, transform);
    first.width = -1;
    for (let frame = 0; frame < 100; frame++) {
      expect(
        measureExpressionText(
          { ...text, color: `rgb(${frame},0,0)` },
          {
            ...transform,
            x: frame,
            y: frame,
            opacity: frame / 100,
            rotation: frame,
          },
        ).width,
      ).toBe(80);
    }
    expect(measure).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it.each([
    { content: 'Updated' },
    { fontFamily: 'serif' },
    { fontSize: 60 },
    { letterSpacing: 2 },
    { textAlign: 'center' },
    { autoFit: 'squeeze' },
  ])('remeasures changed text layout: %j', (patch) => {
    const { measure } = fakeDocument();
    measureExpressionText(text, transform);
    measureExpressionText({ ...text, ...patch } as TextElement, transform);
    expect(measure).toHaveBeenCalledTimes(2);
  });

  it('remeasures resized boxes', () => {
    const { measure } = fakeDocument();
    measureExpressionText(text, transform);
    measureExpressionText(text, { ...transform, width: 200 });
    measureExpressionText(text, { ...transform, height: 200 });
    expect(measure).toHaveBeenCalledTimes(3);
  });

  it.each([
    [2, 1.5],
    [0.5, 0.25],
  ])('retains squeeze stroke scaling (%s, %s) through cached measurements', (x, y) => {
    const { doc, measure } = fakeDocument();
    vi.mocked(renderElementContent).mockImplementationOnce(() => {
      Object.assign(doc.createElement.mock.results.at(-1)!.value.firstElementChild.dataset, {
        ografSqueezeScaleX: String(x),
        ografSqueezeScaleY: String(y),
      });
    });
    const squeezed = { ...text, autoFit: 'squeeze', strokeWidth: 20 } as TextElement;
    // The first query populates the cache without asking for stroke extents.
    expect(expressionSourceRect(squeezed, transform, false, measureExpressionText)).toEqual({
      left: 3,
      top: 4,
      width: 80,
      height: 40,
    });
    expect(expressionSourceRect(squeezed, transform, true, measureExpressionText)).toEqual({
      left: 3 - 10 * x,
      top: 4 - 10 * y,
      width: 80 + 20 * x,
      height: 40 + 20 * y,
    });
    expect(measure).toHaveBeenCalledTimes(1);
  });

  it('invalidates added, removed, replaced and loaded fonts', () => {
    const { measure, fonts } = fakeDocument();
    const font = { status: 'unloaded' };
    measureExpressionText(text, transform);
    fonts.add(font);
    measureExpressionText(text, transform);
    font.status = 'loaded';
    measureExpressionText(text, transform);
    fonts.delete(font);
    fonts.add({ status: 'loaded' });
    measureExpressionText(text, transform);
    fonts.clear();
    measureExpressionText(text, transform);
    expect(measure).toHaveBeenCalledTimes(5);
  });

  it('does not retain measurements while fonts load and clears on completion', () => {
    const { measure, fonts } = fakeDocument();
    measureExpressionText(text, transform);
    fonts.status = 'loading';
    measureExpressionText(text, transform);
    measureExpressionText(text, transform);
    fonts.status = 'loaded';
    const done = fonts.addEventListener.mock.calls.find(([event]) => event === 'loadingdone')!;
    done[1]();
    measureExpressionText(text, transform);
    expect(measure).toHaveBeenCalledTimes(4);
  });

  it('bounds cache memory and keeps recently used entries', () => {
    const { measure } = fakeDocument();
    for (let i = 0; i < 128; i++) measureExpressionText({ ...text, content: String(i) }, transform);
    measureExpressionText({ ...text, content: '0' }, transform);
    measureExpressionText({ ...text, content: '128' }, transform);
    measureExpressionText({ ...text, content: '0' }, transform);
    expect(measure).toHaveBeenCalledTimes(129);
    measureExpressionText({ ...text, content: '1' }, transform);
    expect(measure).toHaveBeenCalledTimes(130);
  });

  it('isolates documents and cleans failed probes without caching failures', () => {
    fakeDocument();
    measureExpressionText(text, transform);
    const { measure, remove } = fakeDocument();
    vi.mocked(renderElementContent).mockImplementationOnce(() => {
      throw new Error('render failed');
    });
    expect(() => measureExpressionText(text, transform)).toThrow('render failed');
    expect(remove).toHaveBeenCalledTimes(1);
    measureExpressionText(text, transform);
    expect(measure).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(2);
  });
});
