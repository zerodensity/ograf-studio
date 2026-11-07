import { describe, it, expect } from 'vitest';
import { createComposition, createLayerOfKind, createLayerPropertyKeyframe } from './factory';
import { assessStaticExitHold } from './exitHoldPreflight';

describe('tail-only exit preflight', () => {
  it('accepts a provably static hold and an exit contained in the tail', () => {
    const c = createComposition();
    c.transitions[0]!.durationFrames = 13;
    c.transitions[1]!.durationFrames = 112;
    const layer = createLayerOfKind('rectangle');
    layer.animationTracks.opacity = [
      createLayerPropertyKeyframe(13, 1),
      createLayerPropertyKeyframe(112, 1),
      createLayerPropertyKeyframe(125, 0),
    ];
    c.layers = [layer];
    expect(assessStaticExitHold(c, 13)).toEqual({ startFrame: 112 });
  });
  it('rejects authored animation in the proposed hold or staged tail', () => {
    const c = createComposition();
    c.transitions[0]!.durationFrames = 13;
    c.transitions[1]!.durationFrames = 112;
    const layer = createLayerOfKind('rectangle');
    layer.animationTracks.opacity = [
      createLayerPropertyKeyframe(13, 1),
      createLayerPropertyKeyframe(125, 0),
    ];
    c.layers = [layer];
    expect(assessStaticExitHold(c, 13).reason).toMatch(/animates during/);
    layer.animationTracks.opacity = [
      createLayerPropertyKeyframe(13, 1),
      createLayerPropertyKeyframe(112, 1),
      createLayerPropertyKeyframe(118, 0.5),
      createLayerPropertyKeyframe(125, 0),
    ];
    expect(assessStaticExitHold(c, 13).reason).toMatch(/staged exit/);
  });
  it('rejects unknown timed content rather than silently skipping it', () => {
    const c = createComposition();
    c.transitions[0]!.durationFrames = 13;
    c.transitions[1]!.durationFrames = 112;
    c.layers = [createLayerOfKind('ticker')];
    expect(assessStaticExitHold(c, 13).reason).toMatch(/not been proven static/);
  });
  it('accepts static unbound text but rejects animated text', () => {
    const c = createComposition();
    c.transitions[0]!.durationFrames = 13;
    c.transitions[1]!.durationFrames = 112;
    const text = createLayerOfKind('text');
    if (text.element.type !== 'text') throw new Error('text expected');
    text.element.textAnimation.cursor = 'none';
    c.layers = [text];
    expect(assessStaticExitHold(c, 13)).toEqual({ startFrame: 112 });
    text.element.textAnimation.type = 'typewriter';
    expect(assessStaticExitHold(c, 13).reason).toMatch(/not been proven static/);
  });
  it('rejects animated background, effect stacks and an exit bump returning to the same value', () => {
    const c = createComposition();
    c.transitions[0]!.durationFrames = 13;
    c.transitions[1]!.durationFrames = 112;
    const layer = createLayerOfKind('rectangle');
    c.layers = [layer];
    c.backgroundPaint = {
      type: 'linear',
      angle: 90,
      stops: [
        { offset: 0, color: '#000', opacity: 1 },
        { offset: 1, color: '#fff', opacity: 1 },
      ],
    };
    expect(assessStaticExitHold(c, 13).reason).toMatch(/require authored timing/);
    delete c.backgroundPaint;
    layer.effects.stack = [{ id: 'test', type: 'blur', enabled: true, radius: 1 } as never];
    expect(assessStaticExitHold(c, 13).reason).toMatch(/requires authored timing/);
    delete layer.effects.stack;
    layer.animationTracks.opacity = [
      createLayerPropertyKeyframe(13, 1),
      createLayerPropertyKeyframe(112, 1),
      createLayerPropertyKeyframe(118, 0.5),
      createLayerPropertyKeyframe(125, 1),
    ];
    expect(assessStaticExitHold(c, 13).reason).toMatch(/staged exit/);
  });
});
