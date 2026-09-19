import { afterAll, describe, expect, it, vi } from 'vitest';
import { compileDescriptor } from '@ograf-editor/codegen';
import {
  createComposition,
  createKeyframe,
  createLayerKeyframe,
  createLayerLoopClip,
  createLayerOfKind,
  defaultTransformForRole,
} from '@ograf-editor/scene-model';
import { ShaderPreviewClock } from './shaderPreviewClock';
vi.hoisted(() => vi.stubGlobal('HTMLElement', class {}));
afterAll(() => vi.unstubAllGlobals());
import { StageLoopPreviewClock } from './stageLoopPreviewClock';

function fixture() {
  const composition = createComposition({
    frameRate: 25,
    keyframes: [
      createKeyframe({ role: 'start' }),
      createKeyframe({ role: 'step' }),
      createKeyframe({ role: 'step' }),
      createKeyframe({ role: 'end' }),
    ],
  });
  const ambient = createLayerOfKind('rectangle'),
    step = createLayerOfKind('rectangle');
  ambient.loop = createLayerLoopClip({ durationFrames: 25, activation: { type: 'lifecycle' } });
  step.loop = createLayerLoopClip({
    durationFrames: 25,
    activation: { type: 'step', stepKeyframeId: composition.keyframes[2]!.id },
  });
  for (const layer of [ambient, step])
    layer.keyframes = composition.keyframes.map((keyframe, index) =>
      createLayerKeyframe(index * 12, defaultTransformForRole('rectangle', keyframe.role)),
    );
  composition.layers = [ambient, step];
  return compileDescriptor(composition);
}

describe('Stage local-loop clock', () => {
  it('freezes held shader loops on manual Pause and retains their phase when the timeline resumes', () => {
    const descriptor = fixture(),
      layer = descriptor.layers[0]!;
    const content = new ShaderPreviewClock(),
      loops = new StageLoopPreviewClock();
    content.play(0);
    expect(loops.sample(descriptor, layer, 12, content.sample(480))).toBe(0);
    expect(loops.sample(descriptor, layer, 12, content.sample(2480))).toBe(50);
    content.pause(2480);
    expect(loops.sample(descriptor, layer, 12, content.sample(12480))).toBe(50);
    content.play(12480);
    expect(loops.sample(descriptor, layer, 18, content.sample(12720))).toBe(56);
    expect(loops.sample(descriptor, layer, 24, content.sample(12960))).toBe(62);
  });

  it('starts a newly activated Step loop without inheriting earlier Step hold time', () => {
    const descriptor = fixture(),
      loops = new StageLoopPreviewClock();
    expect(loops.sample(descriptor, descriptor.layers[1]!, 12, 2480)).toBeUndefined();
    expect(loops.sample(descriptor, descriptor.layers[1]!, 24, 2960)).toBe(0);
    expect(loops.sample(descriptor, descriptor.layers[1]!, 24, 3960)).toBe(25);
    expect(loops.sample(descriptor, descriptor.layers[1]!, 36, 4440)).toBeUndefined();
  });

  it('resets on explicit same-frame and backward scrubs while using the canonical composition loop phase', () => {
    const descriptor = fixture(),
      layer = descriptor.layers[0]!,
      loops = new StageLoopPreviewClock();
    loops.sample(descriptor, layer, 12, 480);
    expect(loops.sample(descriptor, layer, 12, 2480)).toBe(50);
    expect(loops.sample(descriptor, layer, 12, 480)).toBe(0);
    expect(loops.sample(descriptor, layer, 20, 800)).toBe(8);
    expect(loops.sample(descriptor, layer, 15, 600)).toBe(3);
    expect(loops.sample(descriptor, layer, 0, 0)).toBeUndefined();
  });
});
