import { describe, expect, it } from 'vitest';
import {
  createDefaultTransform,
  createFieldDefinition,
  createImageSequenceElement,
  createLayerKeyframe,
  createLayerOfKind,
  createTextElement,
  type FieldValue,
  type Asset,
} from '@ograf-editor/scene-model';
import { bindableProperties, resolveDesignerElement, resolveEffectiveElement } from './dataBinding';
import { createNextBinding, createPlayoutBinding } from './bindingFieldCreation';

describe('native ticker designer bindings', () => {
  it('exposes ticker settings and nested text/image controls in the ordinary target selector', () => {
    const ticker = createLayerOfKind('ticker');
    if (ticker.element.type !== 'ticker') throw new Error('Expected ticker.');
    ticker.element.items = [
      {
        id: 'headline',
        name: 'Headline',
        width: 640,
        element: createTextElement({ content: 'أخبار NEWS' }),
      },
      { id: 'logo', width: 100, element: { type: 'image', src: 'asset:station-logo' } },
    ];
    const targets = bindableProperties(ticker.element).map((target) => target.value);
    expect(targets).toContain('speedPixelsPerSecond');
    expect(targets).toContain('items');
    expect(targets).toContain('items.headline.width');
    expect(targets).toContain('items.headline.height');
    expect(targets).toContain('items.headline.content');
    expect(targets).toContain('items.logo.src');
    const next = createNextBinding(ticker, []);
    expect(next?.field).toMatchObject({
      type: 'number',
      defaultValue: ticker.element.speedPixelsPerSecond,
    });
    const playout = createPlayoutBinding(ticker, []);
    expect(playout?.field).toMatchObject({ type: 'text', defaultValue: 'أخبار NEWS' });
    expect(playout?.binding.targetProperty).toBe('items.headline.content');
  });

  it('updates nested text without changing item identity, width or scroll settings', () => {
    const ticker = createLayerOfKind('ticker');
    if (ticker.element.type !== 'ticker') throw new Error('Expected ticker.');
    ticker.element.items = [
      { id: 'headline', width: 640, element: createTextElement({ content: 'Old headline' }) },
    ];
    ticker.bindings = [{ fieldId: 'headline-text', targetProperty: 'items.headline.content' }];
    const resolved = resolveDesignerElement(ticker, { 'headline-text': 'Updated headline' });
    expect(resolved).toMatchObject({
      type: 'ticker',
      speedPixelsPerSecond: ticker.element.speedPixelsPerSecond,
      items: [{ id: 'headline', width: 640, element: { content: 'Updated headline' } }],
    });
    expect(ticker.element.items[0]!.element).toMatchObject({ content: 'Old headline' });
  });

  it('seeds an editable whole feed without consuming only the first array item', () => {
    const ticker = createLayerOfKind('ticker');
    if (ticker.element.type !== 'ticker') throw new Error('Expected ticker.');
    const properties = bindableProperties(ticker.element);
    const beforeItems = properties.slice(
      0,
      properties.findIndex((property) => property.value === 'items'),
    );
    ticker.bindings = beforeItems.map((property, index) => ({
      fieldId: `already-bound-${index}`,
      targetProperty: property.value,
    }));
    const next = createNextBinding(ticker, []);
    expect(next?.binding.targetProperty).toBe('items');
    expect(next?.field.type).toBe('array');
    expect(next?.field.items?.type).toBe('object');
    expect(next?.field.defaultValue).toEqual(ticker.element.items);
    expect(next?.field.defaultValue).not.toBe(ticker.element.items);
    const replacement = [
      { id: 'lead', width: 420, element: createTextElement({ content: 'New lead' }) },
      { id: 'second', width: 320, element: createTextElement({ content: 'New second' }) },
    ];
    ticker.bindings = [next!.binding];
    const resolved = resolveDesignerElement(
      ticker,
      { [next!.field.id]: JSON.parse(JSON.stringify(replacement)) as FieldValue },
      [next!.field],
    );
    expect(resolved).toMatchObject({ items: replacement });
    expect(ticker.element.items).not.toEqual(replacement);
  });

  it('seeds numeric dimensions for individual feed entries', () => {
    const ticker = createLayerOfKind('ticker');
    if (ticker.element.type !== 'ticker') throw new Error('Expected ticker.');
    const item = ticker.element.items[0]!;
    const target = `items.${item.id}.width`;
    const properties = bindableProperties(ticker.element);
    ticker.bindings = properties
      .slice(
        0,
        properties.findIndex((property) => property.value === target),
      )
      .map((property, index) => ({
        fieldId: `already-bound-${index}`,
        targetProperty: property.value,
      }));
    const next = createNextBinding(ticker, []);
    expect(next?.binding.targetProperty).toBe(target);
    expect(next?.field).toMatchObject({ type: 'number', defaultValue: item.width });
    ticker.bindings = [next!.binding];
    expect(resolveDesignerElement(ticker, { [next!.field.id]: 720 }, [next!.field])).toMatchObject({
      items: [{ id: item.id, width: 720 }],
    });
  });

  it('seeds inherited item height from the layer first pose and respects an explicit height', () => {
    const ticker = createLayerOfKind('ticker');
    if (ticker.element.type !== 'ticker') throw new Error('Expected ticker.');
    ticker.keyframes = [createLayerKeyframe(0, createDefaultTransform({ height: 88 }))];
    const item = ticker.element.items[0]!;
    delete item.height;
    const properties = bindableProperties(ticker.element);
    const target = `items.${item.id}.height`;
    ticker.bindings = properties
      .slice(
        0,
        properties.findIndex((property) => property.value === target),
      )
      .map((property, index) => ({
        fieldId: `already-bound-${index}`,
        targetProperty: property.value,
      }));
    expect(createNextBinding(ticker, [])?.field).toMatchObject({
      type: 'number',
      defaultValue: 88,
    });
    item.height = 120;
    expect(createNextBinding(ticker, [])?.field).toMatchObject({
      type: 'number',
      defaultValue: 120,
    });
  });

  it('exposes the update policy as a selector with valid defaults', () => {
    const ticker = createLayerOfKind('ticker');
    const properties = bindableProperties(ticker.element);
    ticker.bindings = properties
      .slice(
        0,
        properties.findIndex((property) => property.value === 'updatePolicy'),
      )
      .map((property, index) => ({
        fieldId: `already-bound-${index}`,
        targetProperty: property.value,
      }));
    const next = createNextBinding(ticker, []);
    expect(next?.binding.targetProperty).toBe('updatePolicy');
    expect(next?.field).toMatchObject({
      type: 'select',
      defaultValue: 'next-appearance',
      options: [
        { value: 'next-appearance', label: 'Next appearance' },
        { value: 'immediate', label: 'Immediately' },
      ],
    });
  });

  it('resolves image and sequence assets introduced by a whole-feed binding before Stage renders', () => {
    const ticker = createLayerOfKind('ticker');
    const assets: Asset[] = [
      {
        id: 'logo',
        kind: 'image',
        name: 'Logo',
        mimeType: 'image/png',
        dataUri: 'data:image/png;base64,bG9nbw==',
      },
      {
        id: 'frame',
        kind: 'image',
        name: 'Frame',
        mimeType: 'image/png',
        dataUri: 'data:image/png;base64,ZnJhbWU=',
      },
    ];
    const feed = [
      { id: 'logo-item', width: 96, element: { type: 'image', src: 'asset:logo' } },
      {
        id: 'sequence-item',
        width: 96,
        element: createImageSequenceElement({ frames: ['asset:logo', 'asset:frame'] }),
      },
    ];
    const field = createFieldDefinition('array', {
      key: 'feed',
      defaultValue: JSON.parse(JSON.stringify(feed)) as FieldValue,
    });
    ticker.bindings = [{ fieldId: field.id, targetProperty: 'items' }];
    const rendered = resolveEffectiveElement(ticker, {}, assets, [field]);
    expect(rendered).toMatchObject({
      items: [
        { id: 'logo-item', element: { src: assets[0]!.dataUri } },
        { id: 'sequence-item', element: { frames: assets.map((asset) => asset.dataUri) } },
      ],
    });
    const replacement = [
      { id: 'logo-item', width: 96, element: { type: 'image', src: 'asset:frame' } },
    ];
    expect(
      resolveEffectiveElement(
        ticker,
        {
          [field.id]: JSON.parse(JSON.stringify(replacement)) as FieldValue,
        },
        assets,
        [field],
      ),
    ).toMatchObject({ items: [{ id: 'logo-item', element: { src: assets[1]!.dataUri } }] });
    expect(field.defaultValue).toEqual(feed);
    expect(() =>
      resolveEffectiveElement(
        ticker,
        {
          [field.id]: [
            { id: 'missing', width: 96, element: { type: 'image', src: 'asset:missing' } },
          ],
        },
        assets,
        [field],
      ),
    ).toThrow('unknown asset');
  });

  it('treats replacement feeds atomically so new IDs do not inherit a removed entry artwork', () => {
    const ticker = createLayerOfKind('ticker');
    const oldFeed = [
      {
        id: 'removed',
        width: 400,
        height: 100,
        animation: { type: 'fade', durationMs: 500, delayMs: 0 },
        element: createTextElement({ content: 'Old headline' }),
      },
    ];
    const nextFeed = [
      { id: 'inserted', width: 180, element: createLayerOfKind('rectangle').element },
    ];
    const field = createFieldDefinition('array', {
      defaultValue: JSON.parse(JSON.stringify(oldFeed)) as FieldValue,
    });
    ticker.bindings = [{ fieldId: field.id, targetProperty: 'items' }];
    const result = resolveDesignerElement(
      ticker,
      {
        [field.id]: JSON.parse(JSON.stringify(nextFeed)) as FieldValue,
      },
      [field],
    );
    expect(result).toMatchObject({ items: nextFeed });
    if (result.type !== 'ticker') throw new Error('Expected ticker.');
    expect(result.items[0]!.height).toBeUndefined();
    expect(result.items[0]!.animation).toBeUndefined();
    expect(result.items[0]!.element).not.toHaveProperty('content');
  });
});
