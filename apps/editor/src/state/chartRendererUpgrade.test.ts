import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createChartLayer,
  createFieldDefinition,
  createProject,
  createRendererPluginSnapshot,
  studioPluginReference,
  type RendererPluginSnapshot,
} from '@ograf-editor/scene-model';
import { chartRendererUpgradeOffers, compareRendererVersions } from './chartRendererUpgrade';
import { useProjectStore } from './projectStore';
import { useRendererPluginSettingsStore } from './pluginSettingsStore';
import { useProjectSetStore } from './projectSetStore';
import {
  addProjectSetTemplate,
  createProjectSet,
  createProjectSetArchive,
  openProjectSetArchive,
  resolveProjectSetTemplate,
  saveProjectSetTemplateEdits,
} from './projectSet';
import { validateProject } from '@ograf-editor/validation';
import { compileDescriptor } from '@ograf-editor/codegen';

vi.useFakeTimers();
vi.stubGlobal('window', { clearTimeout });
const history = await import('./historyStore');
const oldSettings = useRendererPluginSettingsStore.getState();

function plugin(
  version: string,
  presets: Array<'bar' | 'line'> = ['bar', 'line'],
): RendererPluginSnapshot {
  return createRendererPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'chart',
      id: 'test.chart',
      name: 'Chart',
      version,
      license: 'MIT',
      presets,
    },
    source: 'export default {apiVersion:1,create(){}};',
    licenseText: 'MIT',
  });
}
const old = plugin('1.0.0');
const next = plugin('1.1.0');
const entry = (snapshot: RendererPluginSnapshot, trusted = true, enabled = true) => ({
  snapshot,
  trusted,
  enabled,
  installedAt: '',
});

function projectWithChart() {
  const project = createProject();
  const composition = project.compositions[0]!;
  const chart = createChartLayer();
  if (chart.element.type !== 'chart') throw new Error('Expected chart');
  chart.element.provider = studioPluginReference(old);
  composition.layers.push(chart);
  composition.rendererPlugins = [old];
  return { project, chart };
}

beforeEach(() => {
  useProjectSetStore.getState().clearProjectSet();
  useProjectStore.getState().loadProject(projectWithChart().project);
  useRendererPluginSettingsStore.setState({ installed: [entry(next)] });
  history.resetHistory();
});
afterAll(() => {
  history.resetHistory();
  useRendererPluginSettingsStore.setState(oldSettings);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('chart renderer upgrade', () => {
  it('compares release and prerelease versions and does not infer ordering from hashes', () => {
    expect(compareRendererVersions('1.3.1', '1.3.1')).toBe(0);
    expect(compareRendererVersions('1.3.1', '1.3.1-rc.1')).toBe(1);
    expect(compareRendererVersions('1.3.1-rc.2', '1.3.1-rc.10')).toBe(-1);
    expect(compareRendererVersions('1.10.0', '1.9.9')).toBe(1);
  });

  it('offers only trusted and enabled compatible same-ID equal-or-newer builds', () => {
    const project = useProjectStore.getState().project;
    expect(chartRendererUpgradeOffers(project, [entry(next)])[0]).toMatchObject({
      objects: 1,
      componentObjects: 0,
      errors: [],
    });
    expect(chartRendererUpgradeOffers(project, [entry(next, false)])).toEqual([]);
    expect(chartRendererUpgradeOffers(project, [entry(next, true, false)])).toEqual([]);
    expect(chartRendererUpgradeOffers(project, [entry(plugin('0.9.0'))])).toEqual([]);
    expect(
      chartRendererUpgradeOffers(project, [entry(plugin('1.2.0', ['line']))])[0]?.errors.join(' '),
    ).toMatch(/chart type/);
  });

  it('updates only after an explicit action, preserves the old snapshot and undoes atomically', () => {
    const before = structuredClone(useProjectStore.getState().project);
    expect(chartRendererUpgradeOffers(before, [entry(next)])).toHaveLength(1);
    expect(useProjectStore.getState().project).toEqual(before);
    history.runDiscreteHistoryStep(
      () =>
        useProjectStore
          .getState()
          .upgradeChartRenderer(studioPluginReference(old), studioPluginReference(next)),
      'Update chart renderer',
    );
    const composition = useProjectStore.getState().project.compositions[0]!;
    const chart = composition.layers[0]!;
    expect(chart.element.type === 'chart' && chart.element.provider).toEqual(
      studioPluginReference(next),
    );
    expect(composition.rendererPlugins?.map((item) => item.sha256)).toEqual([
      old.sha256,
      next.sha256,
    ]);
    expect(history.getHistorySnapshot().past.at(-1)?.label).toBe('Update chart renderer');
    history.undo();
    expect(useProjectStore.getState().project).toEqual(before);
    history.redo();
    expect(
      useProjectStore
        .getState()
        .project.compositions[0]!.rendererPlugins?.map((item) => item.sha256),
    ).toEqual([old.sha256, next.sha256]);
  });

  it('rejects a missing, disabled, incompatible or locked target without partial changes', () => {
    for (const installed of [
      [],
      [entry(next, false)],
      [entry(next, true, false)],
      [entry(plugin('1.2.0', ['line']))],
    ]) {
      const before = useProjectStore.getState().project;
      useRendererPluginSettingsStore.setState({ installed });
      const target = installed[0]?.snapshot ?? next;
      expect(() =>
        useProjectStore
          .getState()
          .upgradeChartRenderer(studioPluginReference(old), studioPluginReference(target)),
      ).toThrow();
      expect(useProjectStore.getState().project).toBe(before);
    }
    useRendererPluginSettingsStore.setState({ installed: [entry(next)] });
    const id = useProjectStore.getState().project.compositions[0]!.layers[0]!.id;
    useProjectStore.getState().toggleLayerLock(id);
    const before = useProjectStore.getState().project;
    expect(() =>
      useProjectStore
        .getState()
        .upgradeChartRenderer(studioPluginReference(old), studioPluginReference(next)),
    ).toThrow(/Unlock/);
    expect(useProjectStore.getState().project).toBe(before);
  });

  it('updates saved component source charts and keeps their old and new embedded providers', () => {
    const { project } = projectWithChart();
    const composition = project.compositions[0]!;
    const source = createChartLayer();
    if (source.element.type !== 'chart') throw new Error('Expected chart');
    source.element.provider = studioPluginReference(old);
    composition.components.push({
      id: 'source-component',
      name: 'Reusable chart',
      scope: 'local',
      layers: [source],
      dataFields: [],
      context: {
        frameRate: composition.frameRate,
        keyframes: structuredClone(composition.keyframes),
        transitions: structuredClone(composition.transitions),
        customActions: [],
        rendererPlugins: [old],
      },
    });
    useProjectStore.getState().loadProject(project);
    history.resetHistory();
    const before = structuredClone(useProjectStore.getState().project);
    const offer = chartRendererUpgradeOffers(before, [entry(next)])[0]!;
    expect(offer).toMatchObject({ objects: 1, componentObjects: 1, errors: [] });
    history.runDiscreteHistoryStep(
      () =>
        useProjectStore
          .getState()
          .upgradeChartRenderer(studioPluginReference(old), studioPluginReference(next)),
      'Update chart renderer',
    );
    const result = useProjectStore.getState().project.compositions[0]!;
    const component = result.components[0]!;
    expect(
      component.layers[0]!.element.type === 'chart' && component.layers[0]!.element.provider,
    ).toEqual(studioPluginReference(next));
    expect(component.context?.rendererPlugins?.map((item) => item.sha256)).toEqual([
      old.sha256,
      next.sha256,
    ]);
    history.undo();
    expect(useProjectStore.getState().project).toEqual(before);
  });

  it('upgrades chart guides and runtime collection prototypes and exports the exact new provider', () => {
    const { project } = projectWithChart();
    const composition = project.compositions[0]!;
    const prototype = composition.layers[0]!;
    prototype.groupId = 'prototype';
    const guide = createChartLayer();
    if (guide.element.type !== 'chart') throw new Error('Expected chart');
    guide.element.provider = studioPluginReference(old);
    guide.isGuide = true;
    composition.layers.push(guide);
    const field = createFieldDefinition('array', {
      key: 'items',
      constraints: { maxItems: 2 },
      defaultValue: [],
      items: createFieldDefinition('object', { key: 'item', properties: [] }),
    });
    composition.dataFields = [field];
    composition.runtimeCollections = [
      {
        id: 'collection',
        name: 'Charts',
        fieldId: field.id,
        prototypeLayerIds: [prototype.id],
        offsetPerItem: { x: 0, y: 100 },
        capacity: 2,
        overflow: 'truncate',
      },
    ];
    useProjectStore.getState().loadProject(project);
    history.resetHistory();
    useProjectStore
      .getState()
      .upgradeChartRenderer(studioPluginReference(old), studioPluginReference(next));
    const updated = useProjectStore.getState().project.compositions[0]!;
    for (const layer of updated.layers) {
      expect(layer.element.type === 'chart' && layer.element.provider).toEqual(
        studioPluginReference(next),
      );
    }
    const descriptor = compileDescriptor(updated);
    expect(descriptor.collections?.[0]?.prototypeLayers[0]?.element).toMatchObject({
      provider: studioPluginReference(next),
    });
    expect(descriptor.rendererPlugins?.map((item) => item.sha256)).toEqual([next.sha256]);
    expect(updated.rendererPlugins?.map((item) => item.sha256)).toEqual([old.sha256, next.sha256]);
  });

  it('propagates shared component sources to other templates while keeping their local overrides', async () => {
    const store = useProjectStore.getState();
    const sourceId = store.project.compositions[0]!.layers[0]!.id;
    let set = addProjectSetTemplate(
      createProjectSet('Set', store.project),
      createProject({ name: 'Second' }),
    );
    const firstId = set.templates[0]!.id;
    const secondId = set.templates[1]!.id;
    useProjectSetStore.getState().setProjectSet(set);
    useProjectSetStore.getState().setActiveTemplateId(firstId);
    const componentId = store.createComponent([sourceId], 'Shared chart')!;
    set = useProjectSetStore.getState().projectSet!;
    useProjectSetStore.getState().setActiveTemplateId(secondId);
    store.loadProject(resolveProjectSetTemplate(set, secondId));
    const [instanceId] = store.instantiateComponent(componentId);
    store.updateLayerTransform(instanceId!, 0, { x: 412 });
    set = saveProjectSetTemplateEdits(
      useProjectSetStore.getState().projectSet!,
      secondId,
      useProjectStore.getState().project,
    );
    useProjectSetStore.getState().setProjectSet(set);
    useProjectSetStore.getState().setActiveTemplateId(firstId);
    store.loadProject(resolveProjectSetTemplate(set, firstId));
    const before = structuredClone(useProjectStore.getState().project);
    const beforeSet = structuredClone(useProjectSetStore.getState().projectSet);
    history.resetHistory();
    history.runDiscreteHistoryStep(
      () => store.upgradeChartRenderer(studioPluginReference(old), studioPluginReference(next)),
      'Update chart renderer',
    );
    const changedSet = useProjectSetStore.getState().projectSet!;
    const firstLayer = useProjectStore
      .getState()
      .project.compositions[0]!.layers.find((layer) => layer.id === sourceId)!;
    expect(
      firstLayer.componentLink?.overridePaths?.filter((path) =>
        path.startsWith('/element/provider'),
      ),
    ).toEqual([]);
    const other = resolveProjectSetTemplate(changedSet, secondId);
    const instance = other.compositions
      .flatMap((composition) => composition.layers)
      .find((layer) => layer.id === instanceId)!;
    expect(instance.element.type === 'chart' && instance.element.provider).toEqual(
      studioPluginReference(next),
    );
    expect(instance.keyframes[0]!.transform.x).toBe(412);
    expect(validateProject(other).errors).toEqual([]);
    vi.useRealTimers();
    const archived = await createProjectSetArchive(changedSet);
    const reopened = await openProjectSetArchive(await archived.arrayBuffer());
    vi.useFakeTimers();
    const restored = resolveProjectSetTemplate(reopened, secondId)
      .compositions.flatMap((scope) => scope.layers)
      .find((layer) => layer.id === instanceId)!;
    expect(restored.element.type === 'chart' && restored.element.provider).toEqual(
      studioPluginReference(next),
    );
    history.undo();
    expect(useProjectStore.getState().project).toEqual(before);
    expect(useProjectSetStore.getState().projectSet).toEqual(beforeSet);
  });

  it('blocks a shared update when a different template uses an unsupported chart override', () => {
    const store = useProjectStore.getState();
    const sourceId = store.project.compositions[0]!.layers[0]!.id;
    let set = addProjectSetTemplate(
      createProjectSet('Set', store.project),
      createProject({ name: 'Second' }),
    );
    const firstId = set.templates[0]!.id,
      secondId = set.templates[1]!.id;
    useProjectSetStore.getState().setProjectSet(set);
    useProjectSetStore.getState().setActiveTemplateId(firstId);
    const componentId = store.createComponent([sourceId], 'Shared chart')!;
    set = useProjectSetStore.getState().projectSet!;
    useProjectSetStore.getState().setActiveTemplateId(secondId);
    store.loadProject(resolveProjectSetTemplate(set, secondId));
    const [instanceId] = store.instantiateComponent(componentId);
    store.updateLayerElement(instanceId!, { preset: 'line' });
    set = saveProjectSetTemplateEdits(
      useProjectSetStore.getState().projectSet!,
      secondId,
      useProjectStore.getState().project,
    );
    useProjectSetStore.getState().setProjectSet(set);
    useProjectSetStore.getState().setActiveTemplateId(firstId);
    store.loadProject(resolveProjectSetTemplate(set, firstId));
    const incompatible = plugin('1.2.0', ['bar']);
    useRendererPluginSettingsStore.setState({ installed: [entry(incompatible)] });
    const current = useProjectStore.getState().project;
    const currentSet = useProjectSetStore.getState().projectSet!;
    const offer = chartRendererUpgradeOffers(
      current,
      [entry(incompatible)],
      currentSet,
      firstId,
    )[0]!;
    expect(offer.sharedInstances).toBe(1);
    expect(offer.errors.join(' ')).toMatch(/Second.*chart type/);
    expect(() =>
      store.upgradeChartRenderer(studioPluginReference(old), studioPluginReference(incompatible)),
    ).toThrow(/Second.*chart type/);
    expect(useProjectStore.getState().project).toBe(current);
    expect(useProjectSetStore.getState().projectSet).toBe(currentSet);
  });

  it('reports and preserves explicit renderer overrides in other templates', () => {
    const store = useProjectStore.getState();
    const sourceId = store.project.compositions[0]!.layers[0]!.id;
    let set = addProjectSetTemplate(
      createProjectSet('Set', store.project),
      createProject({ name: 'Second' }),
    );
    const firstId = set.templates[0]!.id,
      secondId = set.templates[1]!.id;
    useProjectSetStore.getState().setProjectSet(set);
    useProjectSetStore.getState().setActiveTemplateId(firstId);
    const componentId = store.createComponent([sourceId], 'Shared chart')!;
    set = useProjectSetStore.getState().projectSet!;
    useProjectSetStore.getState().setActiveTemplateId(secondId);
    store.loadProject(resolveProjectSetTemplate(set, secondId));
    const [instanceId] = store.instantiateComponent(componentId);
    const edited = structuredClone(useProjectStore.getState().project);
    const layer = edited.compositions[0]!.layers.find((item) => item.id === instanceId)!;
    layer.componentLink!.overridePaths = ['/element/provider'];
    useProjectStore.setState({ project: edited });
    set = saveProjectSetTemplateEdits(useProjectSetStore.getState().projectSet!, secondId, edited);
    useProjectSetStore.getState().setProjectSet(set);
    useProjectSetStore.getState().setActiveTemplateId(firstId);
    store.loadProject(resolveProjectSetTemplate(set, firstId));
    const activeSet = useProjectSetStore.getState().projectSet!;
    const offer = chartRendererUpgradeOffers(
      useProjectStore.getState().project,
      [entry(next)],
      activeSet,
      firstId,
    )[0]!;
    expect(offer).toMatchObject({ sharedInstances: 0, preservedOverrides: 1, errors: [] });
    store.upgradeChartRenderer(studioPluginReference(old), studioPluginReference(next));
    const other = resolveProjectSetTemplate(useProjectSetStore.getState().projectSet!, secondId);
    const result = other.compositions[0]!.layers.find((item) => item.id === instanceId)!;
    expect(result.element.type === 'chart' && result.element.provider).toEqual(
      studioPluginReference(old),
    );
    expect(result.componentLink?.overridePaths).toContain('/element/provider');
    expect(validateProject(other).errors).toEqual([]);
  });
});
