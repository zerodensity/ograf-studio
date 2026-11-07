import { describe, expect, it } from 'vitest';
import {
  createAnimationPresetPluginSnapshot,
  createComposition,
  createLayerKeyframe,
  createProject,
  createRectangleLayer,
  defaultTransformFor,
  studioPluginReference,
  type TransitionLogicDefinition,
} from '@ograf-editor/scene-model';
import type { CompiledTransitionLogicDescriptor } from '@ograf-editor/ograf-types';
import {
  buildCoordinatedExportArtifactsWithRuntime,
  type CoordinatedExportInput,
} from './buildCoordinatedExportArtifacts';

function fixture(): CoordinatedExportInput {
  const layer = createRectangleLayer();
  layer.id = 'source-layer';
  layer.keyframes = [createLayerKeyframe(0, defaultTransformFor('rectangle'))];
  const composition = createComposition({ layers: [layer] });
  const project = createProject({ mainCompositionId: composition.id, compositions: [composition] });
  const definition: TransitionLogicDefinition = {
    version: 5,
    id: 'transition-animation',
    name: 'Transition animation',
    slots: [{ id: 'main', name: 'Main', order: 0 }],
    states: [{ id: 'title', name: 'Title', templateId: 'title', slotId: 'main' }],
    transitions: [
      {
        id: 'move',
        name: 'Move',
        durationFrames: 12,
        outgoingFrames: 12,
        incomingStartFrame: 0,
        incomingFrames: 12,
        sharedFrames: 12,
        easing: 'linear',
      },
    ],
    routes: [],
    sharedInstances: [],
    initialSharedValues: [],
    defaultTransitionId: 'move',
  };
  return {
    id: 'motion-export',
    name: 'Motion export',
    definition,
    templates: [{ id: 'title', name: 'Title', project }],
    componentAssets: [],
  };
}
function descriptor(input: CoordinatedExportInput) {
  const artifacts = buildCoordinatedExportArtifactsWithRuntime(
    input,
    'class CoordinatedGraphicElement {}',
  );
  expect(artifacts.errors).toEqual([]);
  const Graphic = new Function(
    artifacts.mainJs
      .replaceAll('import.meta.url', JSON.stringify('file:///graphic/main.js'))
      .replace('export default ExportedCoordinatedGraphic;', 'return ExportedCoordinatedGraphic;'),
  )() as { transitionDescriptor: CompiledTransitionLogicDescriptor };
  return { artifacts, descriptor: Graphic.transitionDescriptor };
}

describe('coordinated transition animation compilation', () => {
  it('keeps omitted legacy behavior and explicit authored choices unwrapped', () => {
    const input = fixture();
    expect(descriptor(input).descriptor.contentAnimations).toBeUndefined();
    input.definition.transitions[0]!.incomingAnimation = { type: 'template' };
    expect(descriptor(input).descriptor.contentAnimations).toBeUndefined();
  });

  it('bakes independent native entry and exit wrappers without changing source tracks', () => {
    const input = fixture();
    const recipe = input.definition.transitions[0]!;
    recipe.incomingAnimation = { type: 'builtin', motion: { style: 'fly', direction: 'left' } };
    recipe.outgoingAnimation = { type: 'builtin', motion: { style: 'wipe', direction: 'right' } };
    const original = structuredClone(input);
    const result = descriptor(input);
    const motion = result.descriptor.contentAnimations!.move!;
    expect(motion.incoming!.durationFrames).toBe(12);
    expect(motion.incoming!.layer.animationTracks.x!.at(0)!.value).toBeLessThan(-1920);
    expect(motion.incoming!.layer.animationTracks.x!.at(-1)!.value).toBe(0);
    expect(motion.outgoing!.layer.animationTracks.clipLeft!.at(-1)!.value).toBe(1);
    expect(result.descriptor.templates[0]!.descriptor.layers[0]!.keyframes).toHaveLength(1);
    expect(input).toEqual(original);
    expect(descriptor(input).artifacts).toEqual(result.artifacts);
  });

  it('ships pinned plugin data and baked tracks, not executable plugin code or global installs', () => {
    const input = fixture();
    const plugin = createAnimationPresetPluginSnapshot({
      manifest: {
        schemaVersion: 1,
        apiVersion: 1,
        kind: 'animation-presets',
        id: 'test.portable-motion',
        version: '1.0.0',
        name: 'Portable motion',
        license: 'MIT',
      },
      licenseText: 'MIT test animation license',
      presets: [
        {
          id: 'soft-in',
          name: 'Soft in',
          tracks: {
            in: [
              {
                property: 'opacity',
                mode: 'absolute',
                keys: [
                  { at: 0, value: 0 },
                  { at: 1, value: 'on-air' },
                ],
              },
            ],
          },
        },
      ],
    });
    input.definition.animationPresetPlugins = [plugin];
    input.definition.transitions[0]!.incomingAnimation = {
      type: 'plugin',
      reference: studioPluginReference(plugin),
      presetId: 'soft-in',
    };
    const result = descriptor(input);
    expect(result.descriptor.definition.animationPresetPlugins).toEqual([plugin]);
    expect(
      result.descriptor.contentAnimations!.move!.incoming!.layer.animationTracks.opacity!.map(
        (key) => [key.frame, key.value],
      ),
    ).toEqual([
      [0, 0],
      [12, 1],
      [24, 1],
    ]);
    expect(result.descriptor.templates[0]!.descriptor.rendererPlugins ?? []).toEqual([]);
    expect(result.artifacts.resources.some((resource) => resource.path.endsWith('.mjs'))).toBe(
      false,
    );
  });

  it('does not synthesize keys for zero-duration cuts and rejects missing plugin pins', () => {
    const input = fixture();
    input.definition.transitions[0]!.incomingFrames = 0;
    input.definition.transitions[0]!.incomingAnimation = {
      type: 'builtin',
      motion: { style: 'pop' },
    };
    expect(descriptor(input).descriptor.contentAnimations).toBeUndefined();
    input.definition.transitions[0]!.incomingAnimation = {
      type: 'plugin',
      reference: { id: 'missing.motion', version: '1.0.0', sha256: '0'.repeat(64) },
      presetId: 'missing',
    };
    expect(() => descriptor(input)).toThrow(/exact pinned/);
  });
});
