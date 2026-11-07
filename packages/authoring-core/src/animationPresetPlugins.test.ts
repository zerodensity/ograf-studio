import { describe, expect, it } from 'vitest';
import {
  createAnimationPresetPluginSnapshot,
  createProject,
  getLayerPropertyValueAtFrame,
  studioPluginReference,
} from '@ograf-editor/scene-model';
import { compileDescriptor } from '@ograf-editor/codegen';
import { AuthoringSession } from './session';

function fixture() {
  const project = createProject();
  const pack = createAnimationPresetPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'animation-presets',
      id: 'test.motion',
      version: '1.0.0',
      name: 'Test motion',
      license: 'MIT',
    },
    licenseText: 'Test motion license',
    presets: [
      {
        id: 'slide',
        name: 'Slide',
        parameters: [{ id: 'distance', label: 'Distance', default: 80, min: 0, max: 400, step: 1 }],
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
            {
              property: 'opacity',
              mode: 'absolute',
              keys: [
                { at: 0, value: 0 },
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
            {
              property: 'opacity',
              mode: 'absolute',
              keys: [
                { at: 0, value: 'on-air' },
                { at: 1, value: 0 },
              ],
            },
          ],
        },
      },
    ],
  });
  project.compositions[0]!.animationPresetPlugins = [pack];
  const session = new AuthoringSession(project);
  session.apply({
    expectedRevision: 0,
    operations: [{ type: 'add_layer', id: 'rect', kind: 'rectangle', name: 'Panel' }],
  });
  const reference = studioPluginReference(pack);
  const operation = {
    type: 'apply_animation_preset' as const,
    layerId: 'rect',
    reference,
    presetId: 'slide',
    side: 'in' as const,
    durationFrames: 6,
    parameters: { distance: 120 },
  };
  return { session, pack, reference, operation };
}

describe('declarative animation preset authoring', () => {
  it('applies an exact composition preset as editable tracks and one undo step', () => {
    const { session, operation, reference } = fixture();
    const before = session.snapshot();
    const anchor = getLayerPropertyValueAtFrame(
      before.project.compositions[0]!.layers[0]!,
      'x',
      12,
    );
    const result = session.apply({ expectedRevision: 1, operations: [operation] });
    expect(result.validation.errors).toEqual([]);
    const layer = result.project.compositions[0]!.layers[0]!;
    expect(getLayerPropertyValueAtFrame(layer, 'x', 0)).toBe(anchor - 120);
    expect(getLayerPropertyValueAtFrame(layer, 'x', 12)).toBe(anchor);
    expect(getLayerPropertyValueAtFrame(layer, 'opacity', 0)).toBe(0);
    expect(layer.animationPresets?.in).toMatchObject({
      reference,
      presetId: 'slide',
      parameters: { distance: 120 },
    });
    const restored = session.undo(2);
    expect(restored.project).toEqual(before.project);
  });

  it('exports ordinary keys without preset definitions or a plugin engine dependency', () => {
    const { session, operation, pack } = fixture();
    const result = session.apply({ expectedRevision: 1, operations: [operation] });
    const descriptor = compileDescriptor(result.project.compositions[0]!);
    expect(JSON.stringify(descriptor)).not.toContain(pack.manifest.id);
    expect(descriptor).not.toHaveProperty('animationPresetPlugins');
    expect(descriptor.layers[0]!.animationTracks.x).toBeDefined();
  });

  it.each([
    { reference: { id: 'test.motion', version: '2.0.0', sha256: 'a'.repeat(64) } },
    { presetId: 'missing' },
    { durationFrames: 13 },
    { parameters: { distance: 401 } },
    { parameters: { unknown: 1 } },
  ])('rejects invalid application atomically: %j', (patch) => {
    const { session, operation } = fixture();
    const before = session.snapshot();
    expect(() =>
      session.apply({
        expectedRevision: 1,
        operations: [
          { type: 'rename_layer', layerId: 'rect', name: 'Should roll back' },
          { ...operation, ...patch },
        ],
      }),
    ).toThrow();
    expect(session.snapshot()).toEqual(before);
  });

  it('clears last-applied provenance when a native preset replaces that side', () => {
    const { session, operation } = fixture();
    session.apply({ expectedRevision: 1, operations: [operation] });
    const result = session.apply({
      expectedRevision: 2,
      operations: [
        {
          type: 'set_layer_motion',
          layerId: 'rect',
          side: 'in',
          spec: { style: 'fade', durationFrames: 6 },
        },
      ],
    });
    expect(result.project.compositions[0]!.layers[0]!.animationPresets?.in).toBeUndefined();
  });
  it('removes only an exact unused source pack and never its baked tracks', () => {
    const { session, operation, reference } = fixture();
    session.apply({ expectedRevision: 1, operations: [operation] });
    expect(() =>
      session.apply({
        expectedRevision: 2,
        operations: [{ type: 'remove_animation_preset_plugin', reference }],
      }),
    ).toThrow('still referenced');
    session.apply({
      expectedRevision: 2,
      operations: [{ type: 'set_layer_motion', layerId: 'rect', side: 'in', spec: null }],
    });
    const before = session.snapshot().project.compositions[0]!.layers[0]!;
    const result = session.apply({
      expectedRevision: 3,
      operations: [{ type: 'remove_animation_preset_plugin', reference }],
    });
    expect(result.project.compositions[0]!.animationPresetPlugins).toBeUndefined();
    expect(result.project.compositions[0]!.layers[0]).toEqual(before);
  });
});
