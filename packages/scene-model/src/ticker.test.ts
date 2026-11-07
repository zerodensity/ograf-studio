import { describe, expect, it } from 'vitest';
import {
  applyElementDataValue,
  createImageElement,
  createImageSequenceElement,
  createProject,
  createTextElement,
  createTickerElement,
  createTickerLayer,
  createTextLayer,
  addEffect,
  findAssetConsumers,
  findMissingAssetReferences,
  getTickerLayout,
  migrateProject,
  normalizeTicker,
  readElementDataValue,
  resolveElementAssetReferences,
  sampleTicker,
  sampleTickerItemAnimation,
  tickerErrors,
} from './index';

describe('native ticker', () => {
  it('samples identical subpixel travel across integer and fractional frame rates', () => {
    const ticker = createTickerElement({
      direction: 'left',
      speedPixelsPerSecond: 137.25,
      gap: 45.5,
      items: [{ id: 'headline', width: 1000.25, element: createTextElement() }],
    });
    for (const fps of [24000 / 1001, 24, 25, 30000 / 1001, 30, 50, 60000 / 1001, 60]) {
      let previous = sampleTicker(ticker, 1920, 0).offset;
      for (let frame = 1; frame < fps * 3; frame++) {
        const current = sampleTicker(ticker, 1920, (frame * 1000) / fps).offset;
        expect(current - previous).toBeCloseTo(-137.25 / fps, 9);
        previous = current;
      }
      expect(sampleTicker(ticker, 1920, 1250).offset).toBeCloseTo(-171.5625, 10);
    }
  });

  it('keeps scroll direction independent from RTL text shaping and wraps seamlessly', () => {
    const ticker = createTickerElement({
      direction: 'left',
      gap: 20,
      speedPixelsPerSecond: 100,
      textDirection: 'rtl',
      items: [
        {
          id: 'rtl',
          width: 180,
          element: createTextElement({ content: 'أخبار عاجلة ABC 123', direction: 'rtl' }),
        },
      ],
    });
    expect(sampleTicker(ticker, 600, 2000)).toEqual({ period: 200, offset: -0, copies: 5 });
    expect(sampleTicker(ticker, 600, 2100).offset).toBe(-10);
    expect(sampleTicker({ ...ticker, direction: 'right' }, 600, 2100).offset).toBe(-190);
    expect(ticker.items[0]!.element).toMatchObject({
      content: 'أخبار عاجلة ABC 123',
      direction: 'rtl',
    });
  });

  it('uses explicit prepared item widths and deterministic item animation time', () => {
    const ticker = createTickerElement({
      gap: 32,
      items: [
        { id: 'text', width: 240, element: createTextElement() },
        { id: 'image', width: 80, height: 50, element: createImageElement() },
      ],
    });
    expect(getTickerLayout(ticker, 72)).toEqual([
      { id: 'text', x: 0, width: 240, height: 72 },
      { id: 'image', x: 272, width: 80, height: 50 },
    ]);
    const item = {
      ...ticker.items[0]!,
      animation: { type: 'fade' as const, durationMs: 1000, delayMs: 100 },
    };
    expect(sampleTickerItemAnimation(item, 100).opacity).toBe(0);
    expect(sampleTickerItemAnimation(item, 600).opacity).toBe(0.875);
    expect(sampleTickerItemAnimation(item, 1100).opacity).toBe(1);
    expect(sampleTickerItemAnimation(item, 600).opacity).toBe(0.875);
  });

  it('validates bounded payloads without modifying source', () => {
    expect(tickerErrors(createTickerElement())).toEqual([]);
    expect(tickerErrors({ ...createTickerElement(), gap: NaN })).toContain(
      'Ticker gap must be from 0 to 16384 pixels.',
    );
    expect(() => normalizeTicker({ fadeSoftness: 2 })).toThrow('fade softness');
    expect(normalizeTicker().updatePolicy).toBe('next-appearance');
    expect(normalizeTicker({ updatePolicy: 'immediate' }).updatePolicy).toBe('immediate');
    expect(() => normalizeTicker({ updatePolicy: 'cycle' as never })).toThrow('update policy');
    const item = createTickerElement().items[0]!;
    expect(tickerErrors({ ...createTickerElement(), items: [item, item] }).join()).toContain(
      'unique',
    );
    expect(
      tickerErrors({
        ...createTickerElement(),
        items: [{ ...item, element: { type: 'ticker', items: [] } }],
      }).join(),
    ).toContain('unsupported');
    expect(sampleTicker(createTickerElement({ items: [] }), 1920, 123)).toEqual({
      period: 0,
      offset: 0,
      copies: 0,
    });
  });

  it('binds item text and speed without changing the prepared width or authored element', () => {
    const ticker = createTickerElement({
      items: [{ id: 'headline', width: 600, element: createTextElement({ content: 'Before' }) }],
    });
    const updated = applyElementDataValue(ticker, 'items.headline.content', 'After');
    expect(readElementDataValue(updated, 'items.headline.content')).toBe('After');
    expect(readElementDataValue(ticker, 'items.headline.content')).toBe('Before');
    expect(updated.type === 'ticker' && updated.items[0]!.width).toBe(600);
    expect(
      readElementDataValue(
        applyElementDataValue(updated, 'speedPixelsPerSecond', 90.5),
        'speedPixelsPerSecond',
      ),
    ).toBe(90.5);
    expect(() => applyElementDataValue(updated, 'speedPixelsPerSecond', -1)).toThrow('speed');
  });

  it('binds nested effect controls while retaining all other item state', () => {
    const text = createTextLayer();
    const blur = addEffect(text, 'blur', { params: { radius: 4 } });
    if (text.element.type !== 'text') throw Error('Expected text');
    const ticker = createTickerElement({
      items: [{ id: 'headline', width: 400, element: text.element, effects: text.effects }],
    });
    const property = `items.headline.effects.${blur.id}.radius`;
    const updated = applyElementDataValue(ticker, property, 18);
    expect(readElementDataValue(updated, property)).toBe(18);
    expect(readElementDataValue(ticker, property)).toBe(4);
    expect(
      readElementDataValue(
        applyElementDataValue(updated, 'items.headline.dropShadowColor', '#0088ff'),
        'items.headline.dropShadowColor',
      ),
    ).toBe('#0088ff');
  });

  it('binds full item arrays or JSON feeds and validates geometry updates atomically', () => {
    const ticker = createTickerElement();
    const items = [{ id: 'new', width: 220, element: createTextElement({ content: 'new feed' }) }];
    const arrayBound = applyElementDataValue(ticker, 'items', items);
    expect(readElementDataValue(arrayBound, 'items')).toEqual(items);
    expect(applyElementDataValue(ticker, 'items', JSON.stringify(items))).toEqual(arrayBound);
    const resized = applyElementDataValue(arrayBound, 'items.new.width', 310);
    expect(readElementDataValue(resized, 'items.new.width')).toBe(310);
    expect(
      readElementDataValue(
        applyElementDataValue(resized, 'items.new.height', 52),
        'items.new.height',
      ),
    ).toBe(52);
    expect(() => applyElementDataValue(arrayBound, 'items.new.width', 0)).toThrow('width');
    expect(() => applyElementDataValue(ticker, 'items', 'not json')).toThrow('JSON array');
    expect(() => applyElementDataValue(ticker, 'items', {})).toThrow('must be an array');
    expect(() => applyElementDataValue(ticker, 'items', [items[0], items[0]])).toThrow('unique');
    expect(readElementDataValue(ticker, 'items')).not.toEqual(items);
  });

  it('discovers and resolves nested media assets and preserves save/load payload', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const layer = createTickerLayer();
    layer.element = createTickerElement({
      items: [
        { id: 'logo', width: 100, element: createImageElement({ src: 'asset:logo' }) },
        {
          id: 'sequence',
          width: 100,
          element: createImageSequenceElement({ frames: ['asset:logo', 'asset:missing'] }),
        },
      ],
    });
    composition.layers.push(layer);
    const asset = {
      id: 'logo',
      kind: 'image' as const,
      name: 'Logo',
      mimeType: 'image/png',
      dataUri: 'data:image/png;base64,aGVsbG8=',
      path: 'logo.png',
    };
    composition.assets.push(asset);
    expect(findMissingAssetReferences(composition)).toEqual(['asset:missing']);
    expect(findAssetConsumers(composition, asset).layerIds).toContain(layer.id);
    expect(() => resolveElementAssetReferences(layer.element, composition.assets)).toThrow(
      'unknown asset',
    );
    const resolved = resolveElementAssetReferences(
      createTickerElement({
        items: [{ id: 'logo', width: 100, element: createImageElement({ src: 'asset:logo' }) }],
      }),
      composition.assets,
    );
    expect(resolved.type === 'ticker' && resolved.items[0]!.element).toMatchObject({
      src: asset.dataUri,
    });
    expect(
      migrateProject(JSON.parse(JSON.stringify(project))).compositions[0]!.layers[0]!.element,
    ).toEqual(layer.element);
  });
});
