import { describe, expect, it } from 'vitest';
import { createDefaultGradient, normalizeTextPropertyAnimator } from '@ograf-editor/scene-model';
import { createTransitionLogicNewsExample } from '../examples/transitionLogicNews';
import { buildCoordinatedProjectSetArtifacts } from './coordinatedCompile';
describe('coordinated text property animators', () => {
  it('preserves seeded, keyframed animators and their bound text in the exported runtime descriptor', () => {
    const set = createTransitionLogicNewsExample(1760000000000);
    const composition = set.templates[0]!.project.compositions[0]!;
    const text = composition.layers.find(
      (layer) => layer.element.type === 'text' && layer.bindings.length > 0,
    );
    if (!text || text.element.type !== 'text') throw new Error('No bound text fixture');
    text.motionBlur = { enabled: true, shutterAngle: 180 };
    text.element.textAnimation = {
      ...text.element.textAnimation,
      animators: [
        normalizeTextPropertyAnimator({
          id: 'rise-seed',
          order: 'random',
          seed: 42,
          durationFrames: 20,
          properties: { y: 40, opacity: 0 },
          offsetKeyframes: [
            { frame: 0, value: 0 },
            { frame: 20, value: 0.25 },
          ],
        }),
      ],
    };
    const artifacts = buildCoordinatedProjectSetArtifacts(set);
    expect(artifacts.errors).toEqual([]);
    expect(artifacts.valid).toBe(true);
    const exported = artifacts.transitionDescriptor!.templates[0]!.descriptor.layers.find(
      (layer) => layer.id === text.id,
    )!;
    expect(exported.motionBlur).toEqual({ enabled: true, shutterAngle: 180 });
    expect(exported.element.type).toBe('text');
    if (exported.element.type !== 'text') throw new Error('not text');
    expect(exported.element.textAnimation.animators?.[0]).toMatchObject({
      id: 'rise-seed',
      order: 'random',
      seed: 42,
      properties: { y: 40, opacity: 0 },
      offsetKeyframes: [
        { frame: 0, value: 0 },
        { frame: 20, value: 0.25 },
      ],
    });
    expect(exported.bindings.length).toBeGreaterThan(0);
    expect(artifacts.mainJs).toContain('ografTextAnimatorGlyph');
    expect(artifacts.mainJs).toContain('ograf-motion-');
  });
  it('exports gradient color animation without changing the authored paint or data bindings', () => {
    const set = createTransitionLogicNewsExample(1760000000000);
    const c = set.templates[0]!.project.compositions[0]!;
    const text = c.layers.find(
      (layer) => layer.element.type === 'text' && layer.bindings.length > 0,
    )!;
    if (text.element.type !== 'text') throw new Error('not text');
    const fill = createDefaultGradient('linear');
    text.element.fill = fill;
    text.element.textAnimation = {
      ...text.element.textAnimation,
      animators: [
        normalizeTextPropertyAnimator({
          id: 'gradient-tint',
          properties: { color: '#ff0000' },
          durationFrames: 20,
        }),
      ],
    };
    const artifact = buildCoordinatedProjectSetArtifacts(set);
    expect(artifact.errors).toEqual([]);
    const compiled = artifact.transitionDescriptor!.templates[0]!.descriptor.layers.find(
      (layer) => layer.id === text.id,
    )!;
    if (compiled.element.type !== 'text') throw new Error('not text');
    expect(compiled.element.fill).toEqual(fill);
    expect(compiled.element.textAnimation.animators?.[0]?.properties.color).toBe('#ff0000');
    expect(compiled.bindings.length).toBeGreaterThan(0);
  });
});
