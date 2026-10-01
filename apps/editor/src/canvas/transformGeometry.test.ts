import { describe, expect, it } from 'vitest';
import {
  authoredPositionAfterDrag,
  parseCssTransform,
  renderedLayerGeometry,
} from './transformGeometry';
import { snapLayerPosition } from './layoutGeometry';
import { evaluateExpression } from '@ograf-editor/scene-model';

describe('parseCssTransform', () => {
  it('reads the translate3d format emitted by GSAP', () => {
    expect(parseCssTransform('translate3d(100px, 42.5px, 0px) rotate(15deg)')).toEqual({
      x: 100,
      y: 42.5,
      rotation: 15,
    });
  });

  it('reads the translate format emitted by Moveable', () => {
    expect(parseCssTransform('translate(-12px, 30px) rotateZ(-5deg)')).toEqual({
      x: -12,
      y: 30,
      rotation: -5,
    });
  });

  it('reads translation and rotation from a 2D matrix', () => {
    const result = parseCssTransform('matrix(0, 1, -1, 0, 80, 90)');
    expect(result.x).toBe(80);
    expect(result.y).toBe(90);
    expect(result.rotation).toBeCloseTo(90);
  });

  it('returns identity values for an absent transform', () => {
    expect(parseCssTransform('none')).toEqual({ x: 0, y: 0, rotation: 0 });
  });
});

describe('dragging a layer with a position expression', () => {
  it('snaps to rendered positions and dimensions rather than authored bounds', () => {
    const authored = { x: 0, y: 0, width: 100, height: 50 };
    const element = {
      style: { transform: 'translate(500px, 40px)', width: '230.5px', height: '70px' },
    } as HTMLElement;
    const rendered = renderedLayerGeometry(element, authored);
    expect(rendered).toEqual({ x: 500, y: 40, width: 230.5, height: 70 });
    const snapped = snapLayerPosition(
      { x: 728, y: 90, width: 40, height: 20 },
      { threshold: 5, verticalGuides: [rendered.x + rendered.width], horizontalGuides: [] },
    );
    // Studio's existing snapping rounds the final position to whole pixels.
    expect(snapped.x).toBe(731);
    element.style.width = '0px';
    element.style.height = '';
    expect(renderedLayerGeometry(element, authored)).toMatchObject({ width: 0, height: 50 });
    expect(renderedLayerGeometry(undefined, authored)).toEqual(authored);
  });

  it('moves the authored position by the displayed delta instead of replacing it', () => {
    expect(authoredPositionAfterDrag(200, 900, 930)).toBe(230);
    expect(authoredPositionAfterDrag(200, 900, 870)).toBe(170);
  });
  it.each([
    ['width', 100, 100, 30],
    ['height', 50, 20, -10],
    ['rotation', 15, 45, 20],
  ])(
    'keeps an additive %s expression stable after a canvas edit',
    (_property, authored, offset, delta) => {
      const source = `value + ${offset}`;
      const before = evaluateExpression(source, { value: authored });
      const edited = authoredPositionAfterDrag(authored, before, before + delta);
      expect(evaluateExpression(source, { value: edited })).toBe(before + delta);
    },
  );
});
