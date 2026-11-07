import { describe, expect, it } from 'vitest';
import {
  createDefaultTransform,
  createDefaultGradient,
  createPathElement,
  createTextElement,
} from '@ograf-editor/scene-model';
import {
  assertTextPathFxSupported,
  cachedTextPathGeometry,
  layoutDirectionalPathUnits,
  resolveTextPathPaint,
  textPathAdvance,
} from './textPathRendering';
import { setTextGradientSource } from './textGradientTint';
import { resolveBoundElement } from './renderElement';
import type { CompiledLayer } from '@ograf-editor/ograf-types';

describe('guarded path text runtime', () => {
  it('reuses sampled geometry for unchanged frames and invalidates when the path moves', () => {
    const content = {} as HTMLElement;
    const path = createPathElement({ d: 'M0 0 L100 0', viewBoxWidth: 100, viewBoxHeight: 100 });
    const transform = createDefaultTransform({ x: 0, y: 0, width: 100, height: 100 });
    const first = cachedTextPathGeometry(content, path, transform, transform);
    expect(cachedTextPathGeometry(content, path, { ...transform }, { ...transform })).toBe(first);
    expect(
      cachedTextPathGeometry(
        content,
        path,
        { ...transform, x: 500, y: 300 },
        { ...transform, x: 500, y: 300 },
      ),
    ).toBe(first);
    expect(cachedTextPathGeometry(content, path, { ...transform, x: 1 }, transform)).not.toBe(
      first,
    );
  });
  it('hides glyphs for a collapsed animated path and recovers when it expands', () => {
    const content = {} as HTMLElement;
    const path = createPathElement({ d: 'M0 0 L100 0', viewBoxWidth: 100, viewBoxHeight: 100 });
    const target = createDefaultTransform({ x: 0, y: 0, width: 100, height: 100 });
    const collapsed = cachedTextPathGeometry(content, path, { ...target, width: 0 }, target);
    expect(collapsed.length).toBe(0);
    expect(collapsed.sample(0)).toBeNull();
    expect(cachedTextPathGeometry(content, path, target, target).length).toBeGreaterThan(0);
  });
  it('includes letter spacing in each glyph advance', () => {
    expect(textPathAdvance(30, 50, 8)).toBe(28);
    expect(() => textPathAdvance(30, 35, -8)).toThrow(/invalid/);
  });
  it('places RTL words in visual reverse order while preserving their widths', () => {
    const path = createPathElement({ d: 'M0 0 L100 0', viewBoxWidth: 100, viewBoxHeight: 100 });
    const transform = createDefaultTransform({ x: 0, y: 0, width: 100, height: 100 });
    const geometry = cachedTextPathGeometry({} as HTMLElement, path, transform, transform);
    const words = layoutDirectionalPathUnits(geometry, [20, 5, 30], 0, 'start', true);
    expect(words[0]!.x).toBeGreaterThan(words[2]!.x);
    expect(words.map((word) => word?.width)).toEqual([20, 5, 30]);
  });
  it('uses the currently sampled gradient rather than the authored stop positions', () => {
    const content = {} as HTMLElement;
    const authored = createDefaultGradient();
    const sampled = {
      ...authored,
      stops: authored.stops.map((stop, index) => (index ? stop : { ...stop, offset: 0.25 })),
    };
    setTextGradientSource(content, sampled);
    expect(resolveTextPathPaint(content, authored)).toBe(sampled);
    expect(resolveTextPathPaint(content, '#ffffff')).toBe('#ffffff');
  });
  it('explicitly rejects unverified count/roll, crawl and transform FX combinations', () => {
    const text = createTextElement();
    expect(() => assertTextPathFxSupported(text)).not.toThrow();
    expect(() =>
      assertTextPathFxSupported({
        ...text,
        textAnimation: { ...text.textAnimation, type: 'roll-up' },
      }),
    ).not.toThrow();
    expect(() =>
      assertTextPathFxSupported({
        ...text,
        textAnimation: { ...text.textAnimation, type: 'count-up' },
      }),
    ).not.toThrow();
    expect(() =>
      assertTextPathFxSupported({
        ...text,
        textAnimation: { ...text.textAnimation, type: 'rise', split: 'word' },
      }),
    ).toThrow(/grapheme splitting/);
  });
  it('rejects overlong or unsupported bound updates before rendering them', () => {
    const compiled = {
      id: 'title',
      name: 'Title',
      element: createTextElement(),
      bindings: [{ dataKey: 'headline', targetProperty: 'content' }],
      textPath: { sourceLayerId: 'path', startOffset: 0, alignment: 'start' },
    } as unknown as CompiledLayer;
    expect(resolveBoundElement(compiled, { headline: 'NEWS' })).toMatchObject({ content: 'NEWS' });
    expect(() => resolveBoundElement(compiled, { headline: 'A'.repeat(513) })).toThrow(
      /512 graphemes/,
    );
    expect(() => resolveBoundElement(compiled, { headline: 'مرحبا' })).toThrow(
      /contextual-shaping/,
    );
    expect(resolveBoundElement(compiled, { headline: 'NEWS' })).toMatchObject({ content: 'NEWS' });
  });
});
