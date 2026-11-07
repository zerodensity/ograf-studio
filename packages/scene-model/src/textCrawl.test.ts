import { describe, expect, it } from 'vitest';
import { normalizeTextCrawl, sampleTextCrawl, textCrawlErrors } from './textCrawl';
import { createProject, createTextLayer } from './factory';
import { migrateProject } from './migrations';

describe('continuous text crawl', () => {
  it('normalizes an opt-in crawl without changing legacy text', () => {
    expect(normalizeTextCrawl({})).toEqual({
      speedPixelsPerSecond: 140,
      gap: 72,
      direction: 'left',
    });
    expect(createTextLayer().element).not.toHaveProperty('crawl');
  });
  it('uses measured glyph width rather than an oversized authored text box', () => {
    const crawl = normalizeTextCrawl({});
    expect(sampleTextCrawl(crawl, 1172, 1494, 1000)).toEqual({
      period: 1244,
      offset: -140,
      copies: 4,
    });
    expect(sampleTextCrawl(crawl, 1172, 1494, (1244 / 140) * 1000).offset).toBeCloseTo(0);
  });
  it('keeps a full viewport of copies for short and long operator data', () => {
    for (const width of [26, 1172, 6000]) {
      const result = sampleTextCrawl(normalizeTextCrawl({}), width, 1494, 3750);
      expect(result.copies * result.period + result.offset).toBeGreaterThan(1494);
      expect(result.period).toBe(width + 72);
    }
  });
  it('does not round a subpixel glyph period up and leave part of the viewport empty', () => {
    const sample = sampleTextCrawl(normalizeTextCrawl({ gap: 0 }), 0.625, 100, 1250);
    expect(sample.period).toBe(0.625);
    expect(sample.copies * sample.period + sample.offset).toBeGreaterThan(100);
    expect(sample.offset).toBeCloseTo(0);
  });
  it('is deterministic across repeated, backward and rightward seeks', () => {
    const crawl = normalizeTextCrawl({ direction: 'right', gap: 0 });
    const sample = sampleTextCrawl(crawl, 1000, 1494, 2500);
    expect(sample.offset).toBe(-650);
    sampleTextCrawl(crawl, 1000, 1494, 100000);
    expect(sampleTextCrawl(crawl, 1000, 1494, 2500)).toEqual(sample);
    expect(sampleTextCrawl(crawl, 1000, 1494, -10).offset).toBe(-0);
    expect(sampleTextCrawl(crawl, 0, 1494, 1000)).toEqual({ period: 0, offset: 0, copies: 1 });
  });
  it('retains the portable option through source migration', () => {
    const project = createProject();
    const text = createTextLayer();
    if (text.element.type !== 'text') throw Error('text expected');
    text.element.crawl = normalizeTextCrawl({ speedPixelsPerSecond: 90, gap: 36 });
    project.compositions[0]!.layers.push(text);
    const migrated = migrateProject(JSON.parse(JSON.stringify(project)));
    expect(migrated.compositions[0]!.layers[0]!.element).toMatchObject({
      crawl: text.element.crawl,
    });
  });
  it('rejects nonfinite, negative and unsupported configuration', () => {
    for (const value of [{ speedPixelsPerSecond: NaN }, { gap: -1 }, { direction: 'up' }])
      expect(() => normalizeTextCrawl(value as never)).toThrow();
    expect(textCrawlErrors(null)).toEqual([]);
  });
});
