import { describe, expect, it } from 'vitest';
import {
  createChartElement,
  createChartLayer,
  createProject,
  createRendererPluginSnapshot,
  studioPluginReference,
  type ComponentDefinition,
  type RendererPluginSnapshot,
} from '@ograf-editor/scene-model';
import type { InstalledStudioPlugin } from './pluginSettingsStore';
import {
  resolveStudioChartRenderer,
  resolveStudioRendererComponent,
  resolveStudioRendererComposition,
  resolveStudioRendererProject,
} from './studioRendererResolution';

function plugin(build: string, manifest: Partial<RendererPluginSnapshot['manifest']> = {}) {
  return createRendererPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'chart',
      id: 'test.chart',
      version: '1.0.0',
      name: 'Test Chart',
      license: 'MIT',
      presets: ['bar', 'line'],
      ...manifest,
    },
    source: `export default {apiVersion:1,create(){/* ${build} */}};`,
    licenseText: 'MIT',
  });
}

function installed(
  snapshot: RendererPluginSnapshot,
  options: Partial<InstalledStudioPlugin> = {},
): InstalledStudioPlugin {
  return {
    snapshot,
    enabled: true,
    trusted: true,
    installedAt: '2026-11-19T00:00:00.000Z',
    ...options,
  };
}

const saved = plugin('saved', { chartFeatures: ['mark-paint-v1'] });
const current = plugin('current', { chartFeatures: ['mark-paint-v1'] });
const chart = createChartElement({ provider: studioPluginReference(saved), preset: 'bar' });

describe('Studio chart renderer resolution', () => {
  it('uses the trusted same-version local build, preferring the bundled fallback, and honors an exact local match', () => {
    const userBuild = installed(plugin('user build'), { installedAt: '2026-11-19T01:00:00.000Z' });
    const bundled = installed(current, { bundled: true });
    expect(resolveStudioChartRenderer(chart, [saved], [userBuild, bundled])).toBe(current);
    expect(resolveStudioChartRenderer(chart, [saved], [bundled, installed(saved)])).toBe(saved);
    expect(
      resolveStudioChartRenderer(
        chart,
        [saved],
        [userBuild, bundled, installed(saved, { enabled: false })],
      ),
    ).toBe(current);
  });

  it('retains missing and corrupt pin diagnostics without granting trust across builds', () => {
    const enabled = [installed(current)];
    expect(resolveStudioChartRenderer(chart, [], enabled)).toBeNull();
    expect(
      resolveStudioChartRenderer(chart, [{ ...saved, source: 'tampered' }], enabled),
    ).toBeNull();
    expect(
      resolveStudioChartRenderer(chart, [saved, { ...current, licenseText: 'tampered' }], enabled),
    ).toBeNull();
    expect(
      resolveStudioChartRenderer(
        chart,
        [saved],
        [
          installed(current, { trusted: false }),
          installed(current, { enabled: false }),
          installed({ ...current, source: 'tampered' }),
          installed(plugin('different plug-in', { id: 'other.chart' })),
          installed(plugin('newer version', { version: '1.0.1' })),
          installed(plugin('same precedence metadata', { version: '1.0.0+20261119' })),
        ],
      ),
    ).toBeNull();
  });

  it('requires the local build to support the chart preset and enabled features', () => {
    const styledChart = { ...chart, fill: '#203040' };
    const differentPreset = plugin('wrong preset', {
      presets: ['line'],
      chartFeatures: ['mark-paint-v1'],
    });
    const available = [installed(differentPreset), installed(plugin('missing feature'))];
    expect(resolveStudioChartRenderer(styledChart, [saved], available)).toBeNull();
    expect(
      resolveStudioChartRenderer(styledChart, [saved], [...available, installed(current)]),
    ).toBe(current);
  });

  it('retains the old snapshot when a chart in the same composition still needs it', () => {
    const composition = createProject().compositions[0]!;
    const plain = { ...createChartLayer(), element: chart };
    const styled = { ...createChartLayer(), element: { ...chart, fill: '#203040' } };
    const limited = plugin('same version without mark paint');
    composition.layers.push(plain, styled);
    composition.rendererPlugins = [saved];

    const effective = resolveStudioRendererComposition(composition, [installed(limited)]);
    expect(effective.layers[0]?.element).toMatchObject({
      provider: studioPluginReference(limited),
    });
    expect(effective.layers[1]).toBe(styled);
    expect(effective.rendererPlugins).toEqual([saved, limited]);
  });

  it('projects composition and component pins with the chosen bytes without changing authored data', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const layer = { ...createChartLayer(), isLocked: true, isGuide: true, element: chart };
    const component: ComponentDefinition = {
      id: 'component-chart',
      name: 'Reusable chart',
      layers: [layer],
      dataFields: [],
      context: {
        frameRate: composition.frameRate,
        keyframes: composition.keyframes,
        transitions: composition.transitions,
        customActions: [],
        rendererPlugins: [saved],
      },
    };
    const unrelated = plugin('different version', { version: '2.0.0' });
    composition.layers.push(layer);
    composition.components.push(component);
    composition.rendererPlugins = [saved, unrelated];
    const before = structuredClone(project);
    const catalog = [installed(current)];

    const effective = resolveStudioRendererProject(project, catalog).compositions[0]!;
    const effectiveLayer = effective.layers[0]!;
    expect(effectiveLayer).toEqual({
      ...layer,
      element: { ...chart, provider: studioPluginReference(current) },
    });
    expect(effectiveLayer.element.type === 'chart' && effectiveLayer.element.data).toBe(chart.data);
    expect(effective.rendererPlugins).toEqual([unrelated, current]);
    expect(effective.components[0]).toEqual(resolveStudioRendererComponent(component, catalog));
    expect(effective.components[0]?.layers[0]).toEqual(effectiveLayer);
    expect(effective.components[0]?.context?.rendererPlugins).toEqual([current]);
    expect(project).toEqual(before);

    expect(resolveStudioRendererProject(project, [installed(saved)])).toBe(project);
    expect(resolveStudioRendererComposition(composition, [])).toBe(composition);
    expect(resolveStudioRendererComponent(component, [installed(saved)])).toBe(component);
  });
});
