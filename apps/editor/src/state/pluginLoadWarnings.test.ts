import { describe, expect, it } from 'vitest';
import {
  createChartLayer,
  createProject,
  createRendererPluginSnapshot,
  studioPluginReference,
  type RendererPluginSnapshot,
} from '@ograf-editor/scene-model';
import { createProjectSet, addProjectSetTemplate } from './projectSet';
import { collectPluginLoadWarnings, pluginLoadWarningSignature } from './pluginLoadWarnings';

function plugin(version = '1.0.0', source = 'export default {apiVersion:1,create(){}};') {
  return createRendererPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'chart',
      id: 'test.chart',
      name: 'Chart.js',
      version,
      license: 'MIT',
      presets: ['bar', 'line'],
    },
    source,
    licenseText: 'MIT',
  });
}
const saved = plugin();
const installed = (snapshot: RendererPluginSnapshot, trusted = true, enabled = true) => ({
  snapshot,
  trusted,
  enabled,
  installedAt: '',
});
function fixture(name = 'Headline') {
  const project = createProject({ name });
  const composition = project.compositions[0]!;
  const chart = createChartLayer();
  if (chart.element.type !== 'chart') throw new Error('Expected chart');
  chart.element.provider = studioPluginReference(saved);
  composition.rendererPlugins = [saved];
  composition.layers.push(chart);
  return { project, composition, chart };
}
const warnings = (project = fixture().project, entries = [installed(saved)]) =>
  collectPluginLoadWarnings({ project, installed: entries, initialized: true });

describe('blocking document plugin requirements', () => {
  it('waits for catalog initialization and refresh rather than flashing missing-plugin warnings', () => {
    const project = fixture().project;
    expect(collectPluginLoadWarnings({ project, installed: [], initialized: false })).toEqual([]);
    expect(
      collectPluginLoadWarnings({ project, installed: [], initialized: true, loading: true }),
    ).toEqual([]);
    expect(warnings(project, [])[0]?.reason).toBe('not-installed');
  });

  it('does not interrupt a working exact renderer even when an optional newer build exists', () => {
    expect(warnings(fixture().project, [installed(saved), installed(plugin('1.1.0'))])).toEqual([]);
  });

  it.each([
    [false, true, 'untrusted'],
    [true, false, 'disabled'],
    [false, false, 'untrusted'],
  ] as const)('distinguishes local trust %s and enablement %s', (trusted, enabled, reason) => {
    expect(warnings(fixture().project, [installed(saved, trusted, enabled)])[0]).toMatchObject({
      reason,
      templateId: null,
      templateName: 'Headline',
      reference: studioPluginReference(saved),
      objects: 1,
      componentObjects: 0,
      replacement: null,
    });
  });

  it('offers a trusted compatible different build at the same version without treating its name as trust', () => {
    const replacement = plugin('1.0.0', 'export default {apiVersion:1,create(){/* revision */}};');
    const project = fixture().project;
    expect(warnings(project, [installed(replacement)])[0]).toMatchObject({
      reason: 'not-installed',
      replacement: studioPluginReference(replacement),
      replacementErrors: [],
    });
    expect(warnings(project, [installed(replacement, false)])[0]?.replacement).toBeNull();
  });

  it('does not offer a migration whose preflight would alter locked objects', () => {
    const { project, chart } = fixture();
    chart.isLocked = true;
    const warning = warnings(project, [installed(plugin('1.1.0'))])[0]!;
    expect(warning.replacement).toBeNull();
    expect(warning.replacementErrors.join(' ')).toContain('Unlock');
  });

  it('reports missing, invalid and unconfigured document requirements', () => {
    const { project, composition, chart } = fixture();
    composition.rendererPlugins = [];
    expect(warnings(project)[0]?.reason).toBe('missing-bundle');
    composition.rendererPlugins = [{ ...saved, source: 'changed after snapshot' }];
    expect(warnings(project)[0]?.reason).toBe('invalid-bundle');
    if (chart.element.type !== 'chart') throw new Error('Expected chart');
    chart.element.provider = null;
    expect(warnings(project)[0]).toMatchObject({ reason: 'unconfigured', reference: null });
    chart.element.provider = { ...studioPluginReference(saved), sha256: 'bad' };
    expect(warnings(project)[0]).toMatchObject({ reason: 'invalid-reference', reference: null });
  });

  it('rejects an installed identity with different exact source or license bytes', () => {
    expect(
      warnings(fixture().project, [installed({ ...saved, source: 'tampered' })])[0]?.reason,
    ).toBe('content-mismatch');
    expect(
      warnings(fixture().project, [installed({ ...saved, licenseText: 'different' })])[0]?.reason,
    ).toBe('content-mismatch');
  });

  it('scans inactive templates and uses only the active template live overlay', () => {
    const first = fixture('First');
    const second = fixture('Second');
    let set = createProjectSet('News', first.project);
    set = addProjectSetTemplate(set, second.project);
    const live = structuredClone(second.project);
    live.compositions[0]!.layers = [];
    const result = collectPluginLoadWarnings({
      project: live,
      projectSet: set,
      activeTemplateId: set.templates[1]!.id,
      installed: [],
      initialized: true,
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      templateId: set.templates[0]!.id,
      templateName: 'First',
      objects: 1,
    });
    // A transient navigation mismatch must not copy one template's requirements into another.
    expect(
      collectPluginLoadWarnings({
        project: live,
        projectSet: set,
        activeTemplateId: set.templates[0]!.id,
        installed: [],
        initialized: true,
      }),
    ).toHaveLength(2);
  });

  it('counts nested compositions, component sources and collection prototypes without expanding copies', () => {
    const { project, composition, chart } = fixture();
    composition.runtimeCollections = [
      {
        id: 'collection',
        name: 'Rows',
        fieldId: 'rows',
        prototypeLayerIds: [chart.id],
        capacity: 10,
        overflow: 'truncate',
        offsetPerItem: { x: 0, y: 80 },
      },
    ];
    const componentChart = structuredClone(chart);
    componentChart.id = 'component-chart';
    composition.components.push({
      id: 'component',
      name: 'Card',
      layers: [componentChart],
      dataFields: [],
    });
    const nested = structuredClone(composition);
    nested.id = 'nested';
    nested.layers = [{ ...structuredClone(chart), id: 'nested-chart' }];
    nested.components = [];
    project.compositions.push(nested);
    expect(warnings(project, [])[0]).toMatchObject({ objects: 2, componentObjects: 1 });
  });

  it('uses a component source context catalog when its own renderer is retained there', () => {
    const { project, composition, chart } = fixture();
    composition.layers = [];
    composition.rendererPlugins = [];
    composition.components.push({
      id: 'component',
      name: 'Card',
      layers: [chart],
      dataFields: [],
      context: {
        frameRate: composition.frameRate,
        keyframes: [],
        transitions: [],
        customActions: [],
        rendererPlugins: [saved],
      },
    });
    expect(warnings(project)).toEqual([]);
  });

  it('keeps its prompt identity stable across ordinary data edits and does not expose plugin source', () => {
    const { project, chart } = fixture();
    const before = warnings(project, []);
    chart.name = 'Renamed chart';
    const after = warnings(project, []);
    expect(pluginLoadWarningSignature(after)).toBe(pluginLoadWarningSignature(before));
    expect(JSON.stringify(after)).not.toContain(saved.source);
    expect(pluginLoadWarningSignature([])).toBe('[]');
  });
});
