import { describe, expect, it } from 'vitest';
import {
  createDefaultTransform,
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
});
