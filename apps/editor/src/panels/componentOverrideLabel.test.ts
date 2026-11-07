import { describe, expect, it } from 'vitest';
import { componentOverrideLabel } from './componentOverrideLabel';

describe('component override labels', () => {
  it('identifies a deleted inherited key rather than describing it as an effect', () => {
    expect(componentOverrideLabel('/keyframes/@key-123', [])).toBe('Removed keyframe');
  });

  it('preserves existing effect and track labels', () => {
    expect(
      componentOverrideLabel('/effects/stack/@glow/params/radius', [{ id: 'glow', name: 'Glow' }]),
    ).toBe('Effects · Glow · Radius');
    expect(componentOverrideLabel('/animationTracks/opacity', [])).toBe(
      'Animation Tracks · Opacity',
    );
  });
});
