import { describe, expect, it } from 'vitest';
import {
  createChartLayer,
  createLayerKeyframe,
  createProject,
  createRendererPluginSnapshot,
  createShaderPaint,
  defaultTransformFor,
} from '@ograf-editor/scene-model';
import { AuthoringSession } from './session';

function fixture() {
  const project = createProject();
  const plugin = createRendererPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'chart',
      id: 'test.chart',
      version: '1.0.0',
      name: 'Chart provider',
      presets: ['bar'],
      license: 'MIT',
    },
    source:
      'export default {apiVersion:1,create(){return {renderAtFrame(){},update(){},dispose(){}}}};',
    licenseText: 'Test plugin license',
  });
  project.compositions[0]!.rendererPlugins = [plugin];
  const provider = {
    id: plugin.manifest.id,
    version: plugin.manifest.version,
    sha256: plugin.sha256,
  };
  return { project, plugin, provider };
}

describe('explicit chart renderer provider authoring', () => {
  it.each([undefined, null])(
    'rejects provider %j chart creation atomically without an implicit fallback',
    (provider) => {
      const { project } = fixture();
      const session = new AuthoringSession(project);
      const before = session.snapshot();
      expect(() =>
        session.apply({
          expectedRevision: 0,
          operations: [
            { type: 'add_layer', kind: 'rectangle' },
            { type: 'add_layer', kind: 'chart', element: { provider } },
          ],
        }),
      ).toThrow('explicit pinned renderer provider');
      expect(session.snapshot()).toEqual(before);
    },
  );

  it('rejects a provider not present in this composition instead of selecting another version', () => {
    const { project, provider } = fixture();
    const session = new AuthoringSession(project);
    expect(() =>
      session.apply({
        expectedRevision: 0,
        operations: [
          {
            type: 'add_layer',
            kind: 'chart',
            element: { provider: { ...provider, version: '2.0.0' } },
          },
        ],
      }),
    ).toThrow('pinned catalog');
    expect(session.revision).toBe(0);
  });

  it('creates a chart from an exact pin and rejects clearing it or changing to an unsupported preset', () => {
    const { project, provider } = fixture();
    const session = new AuthoringSession(project);
    const created = session.apply({
      expectedRevision: 0,
      operations: [{ type: 'add_layer', id: 'chart', kind: 'chart', element: { provider } }],
    });
    expect(created.validation.errors).toEqual([]);
    expect(created.project.compositions[0]!.layers[0]!.element).toMatchObject({ provider });
    for (const patch of [{ provider: null }, { provider: undefined }, { preset: 'pie' }]) {
      expect(() =>
        session.apply({
          expectedRevision: 1,
          operations: [{ type: 'update_element', layerId: 'chart', patch }],
        }),
      ).toThrow(/explicit pinned|does not support/);
      expect(session.snapshot().project).toEqual(created.project);
      expect(session.revision).toBe(1);
    }
  });

  it('keeps an unassigned legacy chart editable and repairs it only through an explicit reference', () => {
    const { project, provider } = fixture();
    const chart = createChartLayer();
    chart.keyframes = [createLayerKeyframe(0, defaultTransformFor('chart'))];
    project.compositions[0]!.layers = [chart];
    const session = new AuthoringSession(project);
    expect(session.snapshot().validation.valid).toBe(true);
    expect(session.snapshot().validation.warnings.join(' ')).toContain(
      'no assigned chart renderer',
    );
    const edited = session.apply({
      expectedRevision: 0,
      operations: [{ type: 'update_element', layerId: chart.id, patch: { fontSize: 36 } }],
    });
    expect(edited.project.compositions[0]!.layers[0]!.element).toMatchObject({
      fontSize: 36,
      provider: null,
    });
    const repaired = session.apply({
      expectedRevision: 1,
      operations: [{ type: 'update_element', layerId: chart.id, patch: { provider } }],
    });
    expect(repaired.validation.errors).toEqual([]);
    expect(repaired.validation.warnings.join(' ')).not.toContain('no assigned chart renderer');
    expect(repaired.project.compositions[0]!.layers[0]!.element).toMatchObject({ provider });
  });

  it('does not silently enable new presentation controls on a legacy pin', () => {
    const { project, provider } = fixture();
    const session = new AuthoringSession(project);
    expect(() =>
      session.apply({
        expectedRevision: 0,
        operations: [
          {
            type: 'add_layer',
            kind: 'chart',
            element: { provider, presentation: { maxBarThickness: 40 } },
          },
        ],
      }),
    ).toThrow('does not support presentation-v1');
    expect(session.revision).toBe(0);
  });

  it('normalizes rows-only MCP creation and rejects an invalid complete edit atomically', () => {
    const { project, plugin } = fixture();
    const supported = createRendererPluginSnapshot({
      ...plugin,
      manifest: {
        ...plugin.manifest,
        chartFeatures: ['presentation-v1', 'canonical-data-v1', 'morph-update-v1'],
      },
    });
    project.compositions[0]!.rendererPlugins = [supported];
    const provider = {
      id: supported.manifest.id,
      version: supported.manifest.version,
      sha256: supported.sha256,
    };
    const session = new AuthoringSession(project);
    const created = session.apply({
      expectedRevision: 0,
      operations: [
        {
          type: 'add_layer',
          id: 'chart',
          kind: 'chart',
          element: {
            provider,
            data: {
              mode: 'counts',
              rows: [
                { id: 'transit', label: 'Transit', value: 40 },
                { id: 'car', label: 'Car', value: 30 },
                { id: 'other', label: 'Other', value: 20 },
              ],
            },
            presentation: { maxBarThickness: 40 },
          },
        },
      ],
    });
    const element = created.project.compositions[0]!.layers[0]!.element;
    expect(element.type === 'chart' && element.data.labels).toEqual(['Transit', 'Car', 'Other']);
    expect(element.type === 'chart' && element.data.datasets[0]!.data[0]).toBeCloseTo(44.44444444);
    expect(() =>
      session.apply({
        expectedRevision: 1,
        operations: [
          { type: 'add_layer', kind: 'rectangle' },
          {
            type: 'update_element',
            layerId: 'chart',
            patch: {
              data: { mode: 'percentages', rows: [{ id: 'one', label: 'One', value: 90 }] },
            },
          },
        ],
      }),
    ).toThrow('missing 10%');
    expect(session.revision).toBe(1);
    expect(session.snapshot().project).toEqual(created.project);
  });

  it('exposes chart shader parameters and resets an optional mark fill to the original palette', () => {
    const { project, plugin } = fixture();
    const supported = createRendererPluginSnapshot({
      ...plugin,
      manifest: { ...plugin.manifest, chartFeatures: ['mark-paint-v1'] },
    });
    project.compositions[0]!.rendererPlugins = [supported];
    const provider = {
      id: supported.manifest.id,
      version: supported.manifest.version,
      sha256: supported.sha256,
    };
    const session = new AuthoringSession(project);
    const created = session.apply({
      expectedRevision: 0,
      operations: [
        {
          type: 'add_layer',
          id: 'painted-chart',
          kind: 'chart',
          element: { provider, fill: createShaderPaint() },
        },
      ],
    });
    const composition = created.project.compositions[0]!;
    const chart = composition.layers[0]!;
    expect(
      composition.dataFields.some((field) => field.generatedShaderParameter?.layerId === chart.id),
    ).toBe(true);
    expect(
      chart.bindings.some((binding) => binding.targetProperty.startsWith('fill.parameters.')),
    ).toBe(true);
    const animated = session.apply({
      expectedRevision: 1,
      operations: [
        {
          type: 'set_property_key',
          layerId: chart.id,
          property: 'fill.parameters.waveFrequency',
          frame: 0,
          value: 4,
        },
      ],
    });
    expect(animated.validation.errors).toEqual([]);
    const reset = session.apply({
      expectedRevision: 2,
      operations: [{ type: 'update_element', layerId: chart.id, patch: { fill: null } }],
    });
    expect(reset.validation.errors).toEqual([]);
    const restored = reset.project.compositions[0]!.layers[0]!;
    expect(restored.element).not.toHaveProperty('fill');
    expect(restored.element.type === 'chart' && restored.element.data).toEqual(
      chart.element.type === 'chart' && chart.element.data,
    );
    expect(
      restored.bindings.some((binding) => binding.targetProperty.startsWith('fill.parameters.')),
    ).toBe(false);
  });
});
