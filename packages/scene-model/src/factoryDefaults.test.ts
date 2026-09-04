import { describe, expect, it } from 'vitest';
import {
  createDefaultTransform,
  createComposition,
  defaultTransformFor,
  defaultTransformForRole,
  createLayerKeyframe,
  createLayerPropertyKeyframe,
  createTransition,
} from './factory';

describe('authoring factory defaults', () => {
  it('uses neutral linear easing for newly authored keys and transitions', () => {
    expect(createLayerKeyframe(12, createDefaultTransform()).easing).toBe('linear');
    expect(createLayerPropertyKeyframe(12, 100).easing).toBe('linear');
    expect(createTransition('start', 'step').easing).toBe('linear');
  });

  it('preserves an explicitly requested easing', () => {
    expect(createLayerPropertyKeyframe(12, 100, { easing: 'cubic-out' }).easing).toBe('cubic-out');
    expect(createTransition('start', 'step', { easing: 'sine-in-out' }).easing).toBe('sine-in-out');
  });

  it('creates ordinary elements at full alpha in every lifecycle role', () => {
    for (const kind of [
      'rectangle',
      'ellipse',
      'text',
      'image',
      'path',
      'image-sequence',
      'lottie',
    ] as const) {
      for (const role of ['start', 'step', 'end'] as const) {
        expect(defaultTransformForRole(kind, role).opacity).toBe(1);
      }
    }
  });

  it('starts rectangles as squares and ellipses as circles without changing other defaults', () => {
    expect(defaultTransformFor('rectangle')).toMatchObject({ width: 200, height: 200 });
    expect(defaultTransformFor('ellipse')).toMatchObject({ width: 200, height: 200 });
    expect(defaultTransformFor('image')).toMatchObject({ width: 400, height: 120 });
  });

  it('starts new compositions on black with the 20% gray outside-canvas fill enabled', () => {
    const composition = createComposition();
    expect(composition.backgroundColor).toBe('#000000');
    expect(composition.layout.dimOutsideCanvas).toBe(true);
    expect(composition.layout.presentationBackground).toBe('none');
    expect(composition.layout.presentationBackgroundImageSource).toBe('');
    expect(composition.layout.presentationBackgroundImageName).toBe('');
  });
});
