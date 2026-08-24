import { describe, expect, it } from 'vitest';
import { applyTextStrokeStyle } from './renderElement';

describe('text stroke rendering', () => {
  it('paints the outline behind the glyph fill with portable authored values', () => {
    const style = {} as CSSStyleDeclaration;

    applyTextStrokeStyle(style, '#101820', 4);

    expect(style.webkitTextStrokeColor).toBe('#101820');
    expect(style.webkitTextStrokeWidth).toBe('4px');
    expect(style.paintOrder).toBe('stroke fill');
  });

  it('retains stroke colour and paint order at zero width for later animation', () => {
    const style = {} as CSSStyleDeclaration;

    applyTextStrokeStyle(style, '#ffcc00', 0);

    expect(style.webkitTextStrokeColor).toBe('#ffcc00');
    expect(style.webkitTextStrokeWidth).toBe('0px');
    expect(style.paintOrder).toBe('stroke fill');
  });
});
