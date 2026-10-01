import { describe, expect, it, vi } from 'vitest';
import { expressionSourceRect } from './expressionBounds';
import { createDefaultTransform, createTextElement, createLayerOfKind } from './factory';

describe('expression source bounds', () => {
  it('uses local box geometry and optional stroke extents', () => {
    const layer = createLayerOfKind('rectangle');
    if (layer.element.type !== 'rectangle') throw Error('rectangle');
    layer.element.strokeWidth = 4;
    const pose = createDefaultTransform({ x: 300, y: 200, width: 100, height: 50, rotation: 90 });
    expect(expressionSourceRect(layer.element, pose)).toEqual({
      left: 0,
      top: 0,
      width: 100,
      height: 50,
    });
    expect(expressionSourceRect(layer.element, pose, true)).toEqual({
      left: -2,
      top: -2,
      width: 104,
      height: 54,
    });
  });
  it('uses renderer text measurements and returns zero for empty text', () => {
    const text = createTextElement({ content: 'Hello', strokeWidth: 2 });
    const measure = vi.fn(() => ({ left: 10, top: 5, width: 80, height: 20 }));
    expect(expressionSourceRect(text, createDefaultTransform(), true, measure)).toEqual({
      left: 9,
      top: 4,
      width: 82,
      height: 22,
    });
    expect(
      expressionSourceRect({ ...text, content: '' }, createDefaultTransform(), false, measure),
    ).toEqual({ left: 0, top: 0, width: 0, height: 0 });
    expect(measure).toHaveBeenCalledTimes(1);
  });

  it.each([
    [2, 1.5],
    [0.5, 0.25],
  ])('scales fitted text stroke extents by %s horizontally and %s vertically', (x, y) => {
    const text = createTextElement({ content: 'Hello', autoFit: 'squeeze', strokeWidth: 20 });
    const measure = () => ({
      left: 10,
      top: 5,
      width: 80,
      height: 20,
      strokeScaleX: x,
      strokeScaleY: y,
    });
    expect(expressionSourceRect(text, createDefaultTransform(), false, measure)).toEqual({
      left: 10,
      top: 5,
      width: 80,
      height: 20,
    });
    expect(expressionSourceRect(text, createDefaultTransform(), true, measure)).toEqual({
      left: 10 - 10 * x,
      top: 5 - 10 * y,
      width: 80 + 20 * x,
      height: 20 + 20 * y,
    });
  });
});
