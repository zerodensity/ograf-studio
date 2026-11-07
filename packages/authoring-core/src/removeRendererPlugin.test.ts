import { describe, expect, it } from 'vitest';
import {
  buildComponentDefinition,
  createChartLayer,
  createFieldDefinition,
  createLayerKeyframe,
  createProject,
  createRendererPluginSnapshot,
  defaultTransformFor,
  type RendererPluginReference,
} from '@ograf-editor/scene-model';
import { AuthoringSession } from './session';

function fixture() {
  const project = createProject();
  const plugin = (version: string) =>
    createRendererPluginSnapshot({
      manifest: {
        schemaVersion: 1,
        apiVersion: 1,
        kind: 'chart',
        id: 'test.chart',
        version,
        name: 'Pinned chart',
        presets: ['bar'],
        license: 'MIT',
      },
      source: `export default {apiVersion:1,create(){}};//${version}`,
      licenseText: 'MIT fixture license',
    });
  const old = plugin('0.0.0');
  const current = plugin('0.1.0');
  const composition = project.compositions[0]!;
  composition.rendererPlugins = [old, current];
  composition.dataFields = [
    createFieldDefinition('text', { key: 'retained', defaultValue: 'Keep' }),
  ];
  const reference = { id: old.manifest.id, version: old.manifest.version, sha256: old.sha256 };
  return { project, composition, old, current, reference };
}

describe('unused pinned renderer removal', () => {
  it('dry-runs and removes only the requested version, preserving an empty scene and all fields', () => {
    const { project, reference, current } = fixture();
    const session = new AuthoringSession(project);
    const before = session.snapshot();
    const operation = { type: 'remove_renderer_plugin' as const, reference };
    const proposed = session.apply({ expectedRevision: 0, operations: [operation], dryRun: true });
    expect(proposed.project.compositions[0]!.rendererPlugins).toEqual([current]);
    expect(proposed.project.compositions[0]!.layers).toEqual([]);
    expect(proposed.project.compositions[0]!.dataFields).toEqual(
      before.project.compositions[0]!.dataFields,
    );
    expect(session.snapshot()).toEqual(before);
    const removed = session.apply({ expectedRevision: 0, operations: [operation] });
    expect(removed.validation.errors).toEqual([]);
    expect(removed.project.compositions[0]!.rendererPlugins).toEqual([current]);
    expect(removed.summary.operationTypes).toEqual(['remove_renderer_plugin']);
    expect(removed.summary.affectedCompositionIds).toEqual([project.mainCompositionId]);
    expect(removed.summary.affectedLayerIds).toEqual([]);
    expect(removed.summary.generatedIds).toEqual([]);
    expect(session.undo(1).project).toEqual(before.project);
  });

  it.each(['layer', 'guide', 'prototype', 'component'] as const)(
    'refuses a renderer used by a %s and rolls back all earlier operations in the batch',
    (kind) => {
      const { project, composition, reference } = fixture();
      const layer = createChartLayer();
      layer.name = 'Protected chart';
      layer.keyframes = [createLayerKeyframe(0, defaultTransformFor('chart'))];
      if (layer.element.type !== 'chart') throw new Error('Expected chart');
      layer.element.provider = reference;
      layer.isGuide = kind === 'guide';
      composition.layers = [layer];
      if (kind === 'component') {
        composition.components = [
          buildComponentDefinition(composition, [layer.id], 'Reusable chart'),
        ];
        composition.layers = [];
      } else if (kind === 'prototype') {
        layer.groupId = 'rows';
        const field = createFieldDefinition('array', {
          key: 'rows',
          defaultValue: [],
          constraints: { maxItems: 2 },
          items: createFieldDefinition('object', { key: 'row', properties: [] }),
        });
        composition.dataFields.push(field);
        composition.runtimeCollections = [
          {
            id: 'rows',
            name: 'Rows',
            fieldId: field.id,
            prototypeLayerIds: [layer.id],
            offsetPerItem: { x: 0, y: 100 },
            capacity: 2,
            overflow: 'truncate',
          },
        ];
      }
      const session = new AuthoringSession(project);
      const before = session.snapshot();
      expect(() =>
        session.apply({
          expectedRevision: 0,
          operations: [
            { type: 'add_layer', kind: 'rectangle' },
            { type: 'remove_renderer_plugin', reference },
          ],
        }),
      ).toThrow(/still used by "Protected chart"/);
      expect(session.snapshot()).toEqual(before);
    },
  );

  it.each(['missing', 'version', 'digest', 'malformed'] as const)(
    'rejects a %s reference without deleting another version',
    (kind) => {
      const { project, composition, reference } = fixture();
      let requested: RendererPluginReference = { ...reference };
      if (kind === 'missing') composition.rendererPlugins = [];
      if (kind === 'version') requested.version = '0.2.0';
      if (kind === 'digest') requested.sha256 = '0'.repeat(64);
      if (kind === 'malformed') requested = null as unknown as RendererPluginReference;
      const session = new AuthoringSession(project);
      const before = session.snapshot();
      expect(() =>
        session.apply({
          expectedRevision: 0,
          operations: [{ type: 'remove_renderer_plugin', reference: requested }],
        }),
      ).toThrow(/not found|reference must/);
      expect(session.snapshot()).toEqual(before);
    },
  );
});
