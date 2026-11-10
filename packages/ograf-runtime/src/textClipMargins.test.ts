import {
  createLayerOfKind,
  MAX_TEXT_CLIP_MARGIN,
  normalizeTextCrawl,
} from '@ograf-editor/scene-model';
import { describe, expect, it } from 'vitest';
import { applyTextClipMargins, getTextClipMargins, textClipPadding } from './textClipMargins';

describe('text clipping margins', () => {
  it('only expands the existing clip policy when a margin is present', () => {
    const { element } = createLayerOfKind('text');
    if (element.type !== 'text') throw new Error('Expected text');
    expect(getTextClipMargins({ ...element, overflowPolicy: 'clip' })).toBeNull();
    for (const overflowPolicy of ['visible', 'ellipsis'] as const) {
      expect(getTextClipMargins({ ...element, overflowPolicy, clipMarginX: 8 })).toBeNull();
    }
    expect(
      getTextClipMargins({
        ...element,
        overflowPolicy: 'clip',
        clipMarginX: 8,
        crawl: normalizeTextCrawl({}),
      }),
    ).toBeNull();
  });

  it('bounds the extra raster backing and preserves independent fractional margins', () => {
    const { element } = createLayerOfKind('text');
    if (element.type !== 'text') throw new Error('Expected text');
    const clipped = {
      ...element,
      overflowPolicy: 'clip' as const,
      clipMarginX: 8.25,
      clipMarginY: MAX_TEXT_CLIP_MARGIN + 2,
    };
    expect(getTextClipMargins(clipped)).toEqual({ x: 8.25, y: MAX_TEXT_CLIP_MARGIN });
    expect(textClipPadding(clipped)).toBe(MAX_TEXT_CLIP_MARGIN);
    expect(getTextClipMargins({ ...clipped, clipMarginX: NaN, clipMarginY: -2 })).toBeNull();
  });

  it('expands native painting in composition pixels without changing text layout', () => {
    const style = { overflow: 'hidden', width: '100%', whiteSpace: 'pre' } as CSSStyleDeclaration;
    applyTextClipMargins(style, { x: 8, y: 3 });
    expect(style).toMatchObject({
      overflow: 'visible',
      clipPath: 'inset(-3px -8px)',
      width: '100%',
      whiteSpace: 'pre',
    });
    applyTextClipMargins(style, { x: 8, y: 3 }, 2, 0.5);
    expect(style.clipPath).toBe('inset(-6px -4px)');
  });
});
