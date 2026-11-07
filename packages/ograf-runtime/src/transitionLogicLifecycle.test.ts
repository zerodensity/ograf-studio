import { describe, expect, it, vi } from 'vitest';
import type { CompiledGraphicDescriptor, CompiledLayer } from '@ograf-editor/ograf-types';
import {
  addEffect,
  createDefaultTransform,
  createLayerEffects,
  createLayerLoopClip,
  createLayerOfKind,
  createRectangleLayer,
  effectParameterValue,
  effectProperty,
  type EffectParameterProperty,
} from '@ograf-editor/scene-model';
import {
  sampleTransitionLogicLayerVisualState,
  sampleTransitionLogicLifecycle,
  type TransitionLogicLifecyclePose,
} from './transitionLogicLifecycle';

vi.mock('lottie-web/build/player/lottie_light_canvas.js', () => ({ default: {} }));

const key = (frame: number, value: number) => ({
  id: `${frame}`,
  frame,
  value,
  easing: 'linear' as const,
});
function layer(id = 'panel'): CompiledLayer {
  return {
    id,
    element: createRectangleLayer().element,
    isVisible: true,
    effects: createLayerEffects(),
    keyframes: [
      {
        id: 'start',
        frame: 0,
        easing: 'linear',
        transform: createDefaultTransform({ x: 0, y: 0, width: 400, height: 80 }),
      },
    ],
    animationTracks: {},
    bindings: [],
  };
}
function descriptor(layers: CompiledLayer[] = []): CompiledGraphicDescriptor {
  return {
    width: 1920,
    height: 1080,
    frameRate: 25,
    backgroundColor: 'transparent',
    layers,
    keyframes: [
      { id: 'start', frame: 0, role: 'start' },
      { id: 'hold', frame: 25, role: 'step' },
      { id: 'end', frame: 50, role: 'end' },
    ],
    transitions: [],
    stepKeyframeIds: ['hold'],
    stepCount: 1,
    startKeyframeId: 'start',
    endKeyframeId: 'end',
    customActions: [],
  };
}
const incoming: TransitionLogicLifecyclePose = {
  phase: 'in',
  startFrame: 100,
  durationFrames: 50,
  loopStartFrame: 150,
};
const outgoing: TransitionLogicLifecyclePose = {
  phase: 'out',
  startFrame: 200,
  durationFrames: 50,
  loopStartFrame: 150,
};

describe('coordinated authored lifecycle sampling', () => {
  it('samples an explicitly proven exit tail without changing the on-air pose', () => {
    const compiled = descriptor();
    compiled.exitTailStartFrame = 40;
    expect(sampleTransitionLogicLifecycle(compiled, 200, 100, outgoing).frame).toBe(40);
    expect(sampleTransitionLogicLifecycle(compiled, 225, 100, outgoing).frame).toBe(45);
    expect(sampleTransitionLogicLifecycle(compiled, 250, 100, outgoing).frame).toBe(50);
    expect(sampleTransitionLogicLifecycle(compiled, 175, 100).frame).toBe(25);
  });
  it('holds authored entrance/exit channels during a wrapper override while retaining loop timing', () => {
    const panel = layer();
    panel.animationTracks.width = [key(0, 0), key(25, 400), key(50, 0)];
    panel.loop = createLayerLoopClip({
      durationFrames: 100,
      tracks: { x: [key(0, 0), key(100, 100)] },
    });
    const compiled = descriptor([panel]);
    const sample = (frame: number, lifecycle: TransitionLogicLifecyclePose) =>
      sampleTransitionLogicLayerVisualState(
        compiled,
        panel,
        sampleTransitionLogicLifecycle(compiled, frame, 100, { ...lifecycle, contentAtHold: true }),
        {},
      ).transform;
    expect(sample(125, incoming)).toMatchObject({ width: 400, x: 0 });
    expect(sample(175, { ...incoming, phase: 'hold' })).toMatchObject({ width: 400, x: 25 });
    // Out keeps the existing deterministic boundary freeze, but never replays authored Out.
    expect(sample(225, outgoing)).toMatchObject({ width: 400, x: 50 });
    expect(sample(250, outgoing)).toMatchObject({ width: 400, x: 50 });
  });

  it('maps delayed and stretched coordinator segments to the exact authored timeline', () => {
    const compiled = descriptor();
    expect(sampleTransitionLogicLifecycle(compiled, 90, 100, incoming).frame).toBe(0);
    expect(sampleTransitionLogicLifecycle(compiled, 125, 100, incoming).frame).toBe(12.5);
    expect(sampleTransitionLogicLifecycle(compiled, 150, 100, incoming).frame).toBe(25);
    expect(sampleTransitionLogicLifecycle(compiled, 175, 100, incoming).frame).toBe(25);
    expect(sampleTransitionLogicLifecycle(compiled, 225, 100, outgoing).frame).toBe(37.5);
    expect(sampleTransitionLogicLifecycle(compiled, 250, 100, outgoing).frame).toBe(50);
    expect(sampleTransitionLogicLifecycle(compiled, 300, 100).frame).toBe(25);
  });

  it('executes bracket, panel and text-mask staging instead of interpolating only hold poses', () => {
    const bracket = layer('bracket'),
      panel = layer(),
      mask = layer('text-mask');
    bracket.animationTracks.height = [key(0, 0), key(5, 80), key(45, 80), key(50, 0)];
    panel.animationTracks.width = [key(0, 0), key(5, 0), key(15, 400), key(35, 400), key(45, 0)];
    mask.animationTracks.width = [key(0, 0), key(15, 0), key(25, 400), key(35, 0), key(50, 0)];
    const compiled = descriptor([bracket, panel, mask]);
    const sample = (frame: number, lifecycle = incoming) =>
      compiled.layers.map(
        (value) =>
          sampleTransitionLogicLayerVisualState(
            compiled,
            value,
            sampleTransitionLogicLifecycle(compiled, frame, 100, lifecycle),
            {},
          ).transform,
      );
    const early = sample(108);
    expect(early[0]!.height).toBe(64);
    expect(early[1]!.width).toBe(0);
    expect(early[2]!.width).toBe(0);
    const middle = sample(120);
    expect(middle[0]!.height).toBe(80);
    expect(middle[1]!.width).toBe(200);
    expect(middle[2]!.width).toBe(0);
    expect(sample(140)[2]!.width).toBe(200);
    // Text clears first, panel retracts next, bracket leaves last.
    const earlyOut = sample(210, outgoing);
    expect(earlyOut[2]!.width).toBe(200);
    expect(earlyOut[1]!.width).toBe(400);
    expect(earlyOut[0]!.height).toBe(80);
    const middleOut = sample(230, outgoing);
    expect(middleOut[2]!.width).toBe(0);
    expect(middleOut[1]!.width).toBe(200);
    expect(middleOut[0]!.height).toBe(80);
    expect(sample(246, outgoing)[0]!.height).toBe(32);
  });

  it('samples effect-stack, reveal and path channels at the same authored lifecycle frame', () => {
    const authored = createLayerOfKind('rectangle');
    const glow = addEffect(authored, 'glow');
    const radius = effectProperty(glow, 'radius') as EffectParameterProperty;
    const panel = layer();
    panel.effects = authored.effects;
    panel.animationTracks[radius] = [key(0, 0), key(25, 20), key(50, 0)];
    panel.animationTracks.clipLeft = [key(0, 1), key(25, 0), key(50, 1)];
    panel.animationTracks.motionPathProgress = [key(0, 0), key(25, 1), key(50, 0)];
    const compiled = descriptor([panel]);
    const state = sampleTransitionLogicLayerVisualState(
      compiled,
      panel,
      sampleTransitionLogicLifecycle(compiled, 125, 100, incoming),
      {},
    );
    expect(effectParameterValue(state.effects, radius)).toBe(10);
    expect(state.paintTracks.clipLeft?.[0]?.value).toBe(0.5);
    expect(state.paintTracks.motionPathProgress?.[0]?.value).toBe(0.5);
  });

  it('activates independent loops only once the authored incoming segment reaches its Step', () => {
    const panel = layer();
    panel.loop = createLayerLoopClip({
      durationFrames: 100,
      tracks: { x: [key(0, 0), key(100, 100)] },
    });
    const compiled = descriptor([panel]);
    const sample = (frame: number, lifecycle = incoming) =>
      sampleTransitionLogicLayerVisualState(
        compiled,
        panel,
        sampleTransitionLogicLifecycle(compiled, frame, 100, lifecycle),
        {},
      ).transform.x;
    expect(sample(125)).toBe(0);
    expect(sample(150)).toBe(0);
    expect(sample(175, { ...incoming, phase: 'hold' })).toBe(25);
  });

  it('freezes loop geometry at OUT then blends it into the authored staged exit', () => {
    const panel = layer();
    panel.animationTracks.width = [key(0, 0), key(25, 400), key(35, 400), key(50, 0)];
    panel.loop = createLayerLoopClip({
      durationFrames: 100,
      tracks: { width: [key(0, 400), key(100, 600)] },
    });
    const compiled = descriptor([panel]);
    const sample = (frame: number) =>
      sampleTransitionLogicLayerVisualState(
        compiled,
        panel,
        sampleTransitionLogicLifecycle(compiled, frame, 100, outgoing),
        {},
      ).transform.width;
    expect(sample(200)).toBe(500);
    expect(sample(210)).toBe(480);
    expect(sample(250)).toBe(0);
  });

  it('exits from the active Step without exposing a different intermediate Step', () => {
    const panel = layer();
    const compiled = descriptor([panel]);
    compiled.keyframes.splice(2, 0, { id: 'second', frame: 50, role: 'step' });
    compiled.keyframes.at(-1)!.frame = 75;
    compiled.stepKeyframeIds.push('second');
    compiled.stepCount = 2;
    panel.animationTracks.width = [key(0, 0), key(25, 400), key(50, 1000), key(75, 0)];
    const sample = (frame: number, stepKeyframeId = 'hold') =>
      sampleTransitionLogicLayerVisualState(
        compiled,
        panel,
        sampleTransitionLogicLifecycle(compiled, frame, 100, { ...outgoing, stepKeyframeId }),
        {},
      ).transform.width;
    expect(sample(200)).toBe(400);
    expect(sample(225)).toBe(200);
    expect(sample(250)).toBe(0);
    expect(sample(200, 'second')).toBe(1000);
    expect(sample(225, 'second')).toBe(500);
  });

  it('settles zero-duration segments and reproduces backward seeks without mutating source', () => {
    const panel = layer();
    panel.animationTracks.width = [key(0, 0), key(25, 400), key(50, 0)];
    const compiled = descriptor([panel]);
    const before = structuredClone(compiled);
    const sample = (frame: number, lifecycle = incoming) =>
      sampleTransitionLogicLayerVisualState(
        compiled,
        panel,
        sampleTransitionLogicLifecycle(compiled, frame, 100, lifecycle),
        {},
      );
    const middle = sample(125);
    sample(150);
    expect(sample(125)).toEqual(middle);
    expect(sample(100, { ...incoming, durationFrames: 0 }).transform.width).toBe(400);
    expect(sample(200, { ...outgoing, durationFrames: 0 }).transform.width).toBe(0);
    expect(compiled).toEqual(before);
  });
});
