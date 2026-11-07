import { describe, expect, it } from 'vitest';
import { authoringOperationSchema } from './schemas';

const operation = (crawl: unknown) => ({
  type: 'update_element',
  layerId: 'layer-text',
  patch: { crawl },
});
describe('text crawl operation schema', () => {
  it('allows partial edits and disabling without accepting invalid motion settings', () => {
    for (const crawl of [null, {}, { speedPixelsPerSecond: 140 }, { gap: 0, direction: 'right' }])
      expect(authoringOperationSchema.safeParse(operation(crawl)).success).toBe(true);
    for (const crawl of [
      { gap: -1 },
      { speedPixelsPerSecond: 2001 },
      { speedPixelsPerSecond: NaN },
      { direction: 'up' },
      { cssAnimation: 'infinite' },
    ])
      expect(authoringOperationSchema.safeParse(operation(crawl)).success).toBe(false);
  });
});
