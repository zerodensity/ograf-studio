import { describe, expect, it } from 'vitest';
import {
  mapTickerFeedResources,
  tickerFeedResourceRuntimeSource,
  tickerFeedResourceValues,
} from './tickerFeedResources';

const input = [
  {
    id: 'text',
    name: 'images/logo.svg',
    width: 400,
    element: { type: 'text', content: 'images/logo.svg', fill: '#ffffff' },
  },
  { id: 'image', width: 64, element: { type: 'image', src: 'images/logo.svg' } },
  {
    id: 'frames',
    width: 64,
    element: { type: 'image-sequence', frames: ['images/a.png', 'images/b.png'] },
  },
  {
    id: 'shader',
    width: 64,
    element: {
      type: 'shader',
      fragmentSource: 'images/logo.svg',
      inputImage: { source: 'images/texture.png' },
    },
  },
  {
    id: 'paint',
    width: 64,
    element: {
      type: 'text',
      content: 'TEXT',
      fill: { type: 'shader', inputImage: { source: 'images/fill.png' } },
      strokePaint: { type: 'media', source: { kind: 'clip', src: 'media/outline.webm' } },
    },
    effects: {
      stack: [{ shader: { type: 'shader', inputImage: { source: 'images/effect.png' } } }],
    },
  },
  {
    id: 'media',
    width: 64,
    element: {
      type: 'rectangle',
      fill: { type: 'media', source: { kind: 'live', fallback: 'images/fallback.png' } },
    },
  },
];

describe('portable ticker feed resources', () => {
  it.each([false, true])(
    'rebases precise native resource fields with JSON=%s and preserves editorial strings',
    (json) => {
      const before = structuredClone(input);
      const value = json ? JSON.stringify(input) : input;
      const resolved = mapTickerFeedResources(value, (url) => `https://graphics.test/${url}`);
      const result = (json ? JSON.parse(resolved as string) : resolved) as typeof input;
      expect(result[0]).toEqual(input[0]);
      expect(result[1]!.element.src).toBe('https://graphics.test/images/logo.svg');
      expect(result[2]!.element.frames).toEqual([
        'https://graphics.test/images/a.png',
        'https://graphics.test/images/b.png',
      ]);
      expect(result[3]!.element.fragmentSource).toBe('images/logo.svg');
      expect(tickerFeedResourceValues(resolved)).toEqual([
        'https://graphics.test/images/logo.svg',
        'https://graphics.test/images/a.png',
        'https://graphics.test/images/b.png',
        'https://graphics.test/images/texture.png',
        'https://graphics.test/images/fill.png',
        'https://graphics.test/images/fallback.png',
        'https://graphics.test/media/outline.webm',
        'https://graphics.test/images/effect.png',
      ]);
      expect(input).toEqual(before);
      expect(typeof resolved).toBe(json ? 'string' : 'object');
    },
  );

  it('emits the same traversal in both kinds of standalone entry module', () => {
    const production = mapTickerFeedResources(input, (url) => `https://graphics.test/${url}`);
    for (const resolver of ['exportedResourceUrl', 'exportedResourceValue']) {
      const generated = new Function(
        `${resolver}`,
        `${tickerFeedResourceRuntimeSource(resolver)};return exportedTickerFeedResources;`,
      )((url: string) => `https://graphics.test/${url}`) as (value: unknown) => unknown;
      expect(generated(input)).toEqual(production);
      expect(JSON.parse(generated(JSON.stringify(input)) as string)).toEqual(production);
    }
  });

  it.each([null, undefined, 'invalid JSON', '{}', { bad: true }])(
    'leaves invalid feed input %s available for ordinary validation',
    (value) => {
      expect(
        mapTickerFeedResources(value, () => {
          throw new Error('Must not resolve invalid feed');
        }),
      ).toBe(value);
    },
  );
});
