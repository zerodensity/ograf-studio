import { describe, expect, it, vi } from 'vitest';
import {
  createDefaultTransform,
  createAnimationPresetPluginSnapshot,
  createLayerEffects,
  createRectangleLayer,
  createTransitionContentAnimationComposition,
  studioPluginReference,
} from '@ograf-editor/scene-model';
import type { CompiledLayer } from '@ograf-editor/ograf-types';
import { compileDescriptor } from '@ograf-editor/codegen';
import {
  applyTransitionLogicContentPose,
  sampleTransitionLogicContentAnimation,
} from './transitionLogicContentAnimation';
import type { TransitionLogicLifecyclePose } from './transitionLogicLifecycle';

vi.mock('lottie-web/build/player/lottie_light_canvas.js', () => ({ default: {} }));

const key = (frame: number, value: number) => ({
  id: String(frame),
  frame,
  value,
  easing: 'linear' as const,
});
function animation() {
  const layer: CompiledLayer = {
    id: 'wrapper',
    element: createRectangleLayer().element,
    effects: createLayerEffects(),
    isVisible: true,
    bindings: [],
    keyframes: [
      {
        id: 'start',
        frame: 0,
        easing: 'linear',
        transform: createDefaultTransform({ x: 0, y: 0, width: 1920, height: 1080 }),
      },
    ],
    animationTracks: {},
  };
  return { layer, durationFrames: 100 };
}
const incoming: TransitionLogicLifecyclePose = {
  phase: 'in',
  startFrame: 50,
  durationFrames: 20,
};
const outgoing: TransitionLogicLifecyclePose = {
  phase: 'out',
  startFrame: 200,
  durationFrames: 40,
};

describe('coordinated content-wrapper animations', () => {
  it('samples a parameterized pinned animation plugin through the normal bake and compiler', () => {
    const pack = createAnimationPresetPluginSnapshot({
      manifest: {
        schemaVersion: 1,
        apiVersion: 1,
        kind: 'animation-presets',
        id: 'test.wrapper',
        version: '1.0.0',
        name: 'Wrapper',
        license: 'MIT',
      },
      licenseText: 'MIT',
      presets: [
        {
          id: 'travel',
          name: 'Travel',
          targetKinds: ['rectangle'],
          parameters: [
            { id: 'distance', label: 'Distance', default: 80, min: 0, max: 1000, step: 1 },
          ],
          tracks: {
            in: [
              {
                property: 'x',
                mode: 'offset',
                keys: [
                  { at: 0, value: { parameter: 'distance', multiplier: -1 } },
                  { at: 1, value: 'on-air' },
                ],
              },
            ],
            out: [
              {
                property: 'x',
                mode: 'offset',
                keys: [
                  { at: 0, value: 'on-air' },
                  { at: 1, value: { parameter: 'distance' } },
                ],
              },
            ],
          },
        },
      ],
    });
    const choice = {
      type: 'plugin' as const,
      reference: studioPluginReference(pack),
      presetId: 'travel',
      parameters: { distance: 600 },
    };
    const bake = (side: 'in' | 'out') => ({
      layer: compileDescriptor(
        createTransitionContentAnimationComposition(choice, side, 20, 1920, 1080, 50, [pack])!,
      ).layers[0]!,
      durationFrames: 20,
    });
    expect(
      sampleTransitionLogicContentAnimation(bake('in'), incoming, 60, 1920, 1080).transform,
    ).toBe('translate(-300px, 0px) rotate(0deg) scale(1, 1)');
    expect(
      sampleTransitionLogicContentAnimation(bake('out'), outgoing, 220, 1920, 1080).transform,
    ).toBe('translate(300px, 0px) rotate(0deg) scale(1, 1)');
  });

  it('samples independent In/Out durations and gating without an extra opacity envelope', () => {
    const baked = animation();
    baked.layer.animationTracks.x = [key(0, -2000), key(100, 0), key(200, 2000)];
    const sample = (frame: number, lifecycle = incoming) =>
      sampleTransitionLogicContentAnimation(baked, lifecycle, frame, 1920, 1080);
    expect(sample(49).opacity).toBe('0');
    expect(sample(60)).toMatchObject({
      opacity: '1',
      transform: 'translate(-1000px, 0px) rotate(0deg) scale(1, 1)',
    });
    expect(sample(70).transform).toBe('');
    expect(sample(220, outgoing)).toMatchObject({
      opacity: '1',
      transform: 'translate(1000px, 0px) rotate(0deg) scale(1, 1)',
    });
    expect(sample(240, outgoing).opacity).toBe('0');
    const middle = sample(60);
    sample(245, outgoing);
    expect(sample(60)).toEqual(middle);
  });

  it('scales baked box size without resizing or reflowing content, retaining Grow edge geometry', () => {
    const baked = animation();
    baked.layer.animationTracks.width = [key(0, 0), key(100, 1920)];
    const left = sampleTransitionLogicContentAnimation(baked, incoming, 60, 1920, 1080);
    expect(left.transform).toBe('translate(-480px, 0px) rotate(0deg) scale(0.5, 1)');
    baked.layer.animationTracks.x = [key(0, 1920), key(100, 0)];
    const right = sampleTransitionLogicContentAnimation(baked, incoming, 60, 1920, 1080);
    expect(right.transform).toBe('translate(480px, 0px) rotate(0deg) scale(0.5, 1)');
    expect(right.transformOrigin).toBe('960px 540px');
    const host = { style: { width: '1920px', height: '1080px' } } as unknown as HTMLElement;
    applyTransitionLogicContentPose(host, right);
    expect(host.style.width).toBe('1920px');
    expect(host.style.height).toBe('1080px');
  });

  it('uses the baked full-canvas origin even when the template viewport is cropped', () => {
    const baked = animation();
    baked.layer.animationTracks.scale = [key(0, 0.5), key(100, 1)];
    const host = { style: { width: '800px', height: '450px' } } as unknown as HTMLElement;
    applyTransitionLogicContentPose(
      host,
      sampleTransitionLogicContentAnimation(baked, incoming, 60, 1920, 1080),
    );
    expect(host.style.transformOrigin).toBe('960px 540px');
    expect(host.style.width).toBe('800px');
    expect(host.style.height).toBe('450px');
  });

  it('shares the normal layer reveal, scale, rotation and blur channels', () => {
    const baked = animation();
    baked.layer.animationTracks.scale = [key(0, 0.5), key(100, 1)];
    baked.layer.animationTracks.rotation = [key(0, -90), key(100, 0)];
    baked.layer.animationTracks.clipLeft = [key(0, 1), key(100, 0)];
    baked.layer.animationTracks.blur = [key(0, 24), key(100, 0)];
    baked.layer.animationTracks.opacity = [key(0, 0), key(100, 1)];
    expect(sampleTransitionLogicContentAnimation(baked, incoming, 60, 1920, 1080)).toMatchObject({
      opacity: '0.5',
      transform: 'translate(0px, 0px) rotate(-45deg) scale(0.75, 0.75)',
      clipPath: 'inset(0% 0% 0% 50%)',
      filter: 'blur(12px)',
    });
  });

  it('handles zero duration and clears transient styles in the settled pose', () => {
    const baked = animation();
    const sample = (frame: number, phase: 'in' | 'out') =>
      sampleTransitionLogicContentAnimation(
        baked,
        { phase, startFrame: 50, durationFrames: 0 },
        frame,
        1920,
        1080,
      );
    expect(sample(49, 'in').opacity).toBe('0');
    expect(sample(50, 'in').opacity).toBe('1');
    expect(sample(49, 'out').opacity).toBe('1');
    expect(sample(50, 'out').opacity).toBe('0');
    const host = {
      style: { transform: 'scale(0)', clipPath: 'inset(100%)', filter: 'blur(24px)' },
    } as unknown as HTMLElement;
    applyTransitionLogicContentPose(host, sample(50, 'in'));
    expect(host.style).toMatchObject({ transform: '', clipPath: '', filter: 'none' });
  });
});
