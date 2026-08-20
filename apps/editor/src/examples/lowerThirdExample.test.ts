import { describe, expect, it } from 'vitest';
import { compileDescriptor } from '@ograf-editor/codegen';
import { createLowerThirdExampleProject } from './lowerThirdExample';

describe('lower third example', () => {
  it('provides a complex exportable lifecycle with independently eased layers', () => {
    const project = createLowerThirdExampleProject();
    const composition = project.compositions[0]!;
    const descriptor = compileDescriptor(composition);
    expect(composition.layers).toHaveLength(5);
    expect(descriptor.stepCount).toBe(1);
    expect(descriptor.keyframes.at(-1)?.frame).toBe(90);
    expect(
      new Set(descriptor.layers.flatMap((layer) => layer.keyframes.map((key) => key.easing))).size,
    ).toBeGreaterThan(5);
    expect(descriptor.layers.some((layer) => layer.effects.dropShadowEnabled)).toBe(true);
    expect(descriptor.layers.filter((layer) => layer.binding)).toHaveLength(2);
  });
});
