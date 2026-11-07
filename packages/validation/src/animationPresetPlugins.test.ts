import { describe, expect, it } from 'vitest';
import {
  applyAnimationPreset,
  buildComponentDefinition,
  computeKeyframeFrames,
  createLayerKeyframe,
  createProject,
  createRectangleLayer,
  createAnimationPresetPluginSnapshot,
} from '@ograf-editor/scene-model';
import { validateProject } from './validateProject';

function fixture() {
  const project = createProject();
  const composition = project.compositions[0]!;
  const layer = createRectangleLayer();
  layer.keyframes = computeKeyframeFrames(composition).map((entry) =>
    createLayerKeyframe(entry.frame, {
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      rotation: 0,
      opacity: 1,
      transformOriginX: 0.5,
      transformOriginY: 0.5,
    }),
  );
  composition.layers = [layer];
  const snapshot = createAnimationPresetPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'animation-presets',
      id: 'test.motion',
      version: '1.0.0',
      name: 'Motion',
      license: 'MIT',
    },
    licenseText: 'MIT definitions license',
    presets: [
      {
        id: 'fade',
        name: 'Fade',
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
  applyAnimationPreset(composition, layer, snapshot, 'fade', 'in', { durationFrames: 12 });
  return { project, composition, layer, snapshot };
}

describe('portable animation definitions and provenance validation', () => {
  it('accepts applied definitions and finds references retained in saved components', () => {
    const { project, composition, layer } = fixture();
    expect(validateProject(project).errors).toEqual([]);
    composition.components = [buildComponentDefinition(composition, [layer.id], 'Saved motion')];
    composition.layers = [];
    expect(validateProject(project).errors).toEqual([]);
    composition.animationPresetPlugins = [];
    // Saved components retain their own portable pinned definitions independently of the host.
    expect(validateProject(project).errors).toEqual([]);
    composition.components[0]!.context!.animationPresetPlugins = [];
    expect(validateProject(project).errors.join(' ')).toContain('missing pinned definition');
  });

  it.each(['missing', 'digest', 'preset', 'duration', 'parameter'] as const)(
    'rejects invalid %s provenance',
    (problem) => {
      const { project, composition, layer } = fixture();
      const application = layer.animationPresets!.in!;
      if (problem === 'missing') composition.animationPresetPlugins = [];
      if (problem === 'digest') application.reference.sha256 = '0'.repeat(64);
      if (problem === 'preset') application.presetId = 'missing';
      if (problem === 'duration') application.durationFrames = 13;
      if (problem === 'parameter') application.parameters = { unknown: 1 };
      expect(validateProject(project).valid).toBe(false);
      expect(validateProject(project).errors.join(' ')).toMatch(
        /animation preset|definition|duration|parameter/,
      );
    },
  );

  it('rejects duplicate snapshots, oversized catalog counts and modified definitions', () => {
    const { project, composition, snapshot } = fixture();
    composition.animationPresetPlugins!.push(structuredClone(snapshot));
    expect(validateProject(project).errors.join(' ')).toContain('duplicate animation preset');
    composition.animationPresetPlugins = Array(17).fill(snapshot);
    expect(validateProject(project).errors.join(' ')).toContain('16 snapshots');
    composition.animationPresetPlugins = [structuredClone(snapshot)];
    composition.animationPresetPlugins[0]!.presets[0]!.name = 'Changed';
    expect(validateProject(project).errors.join(' ')).toContain('integrity');
  });

  it('does not accept executable source on the data-only animation catalog', () => {
    const { project, composition, snapshot } = fixture();
    composition.animationPresetPlugins = [
      { ...snapshot, source: 'console.log("never execute")' },
    ] as never;
    expect(validateProject(project).errors.join(' ')).toContain('unknown field source');
  });
});
