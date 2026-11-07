import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, type TransitionLogicDefinition } from '@ograf-editor/scene-model';
import { applyAuthoringOperations } from '../../../../packages/authoring-core/src/operations';
import { getActiveComposition, useProjectStore } from './projectStore';
import { useProjectSetStore } from './projectSetStore';
import { templateSetSettingsFromProject } from './templateSetSettings';
import {
  addProjectSetTemplate,
  createProjectSet,
  resolveProjectSetTemplate,
  validateProjectSetDocument,
} from './projectSet';

vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
vi.stubGlobal('window', {
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
});
const history = await import('./historyStore');
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function fixture() {
  const store = useProjectStore.getState();
  const panelId = store.addLayer('rectangle');
  const detailId = store.addLayer('rectangle');
  let set = createProjectSet('News', useProjectStore.getState().project);
  set = addProjectSetTemplate(set, createProject({ name: 'Ticker' }));
  useProjectSetStore.setState({ projectSet: set, activeTemplateId: set.templates[0]!.id });
  const componentId = store.createComponent([panelId, detailId], 'Shared panel')!;
  set = useProjectSetStore.getState().projectSet!;
  const value = { instanceId: 'panel', sourceLayerId: detailId, property: 'height' };
  const graph: TransitionLogicDefinition = {
    version: 3,
    id: 'news',
    name: 'News',
    slots: [
      { id: 'main', name: 'Main', order: 0 },
      { id: 'ticker', name: 'Ticker', order: 1 },
    ],
    states: [
      {
        id: 'panel',
        name: 'Panel',
        slotId: 'main',
        templateId: set.templates[0]!.id,
        sharedValues: [{ ...value, value: 100 }],
      },
    ],
    transitions: [
      {
        id: 'fade',
        name: 'Fade',
        durationFrames: 24,
        outgoingFrames: 24,
        incomingStartFrame: 0,
        incomingFrames: 24,
        sharedFrames: 24,
        easing: 'linear',
      },
    ],
    routes: [],
    sharedInstances: [
      {
        id: 'panel',
        name: 'Panel',
        componentAssetId: componentId,
        continuityKey: 'panel',
        slotId: 'main',
      },
    ],
    initialSharedValues: [{ ...value, value: 100 }],
    layoutRules: [
      {
        id: 'resize',
        name: 'Make room for ticker',
        slotId: 'main',
        whenSlotId: 'ticker',
        sharedOffsets: [{ ...value, value: -20 }],
      },
    ],
    defaultTransitionId: 'fade',
  };
  set = {
    ...set,
    transitionLogic: graph,
    settings: templateSetSettingsFromProject(useProjectStore.getState().project),
  };
  validateProjectSetDocument(set);
  useProjectSetStore.getState().setProjectSet(set);
  history.resetHistory();
  return { panelId, detailId, componentId, secondTemplateId: set.templates[1]!.id };
}

const composition = () => {
  const state = useProjectStore.getState();
  return getActiveComposition(state.project, state.activeCompositionId);
};

describe('atomic shared-component graph safety', () => {
  beforeEach(() => {
    useProjectSetStore.getState().clearProjectSet();
    useProjectStore.getState().newProject();
    history.resetHistory();
  });

  it('rejects a source removal before publishing either store or touching undo/redo', () => {
    const { panelId, detailId, componentId } = fixture();
    const beforeProject = useProjectStore.getState().project;
    const beforeSet = useProjectSetStore.getState().projectSet;
    const beforeHistory = history.getHistorySnapshot();
    const publications: string[] = [];
    const unproject = useProjectStore.subscribe(() => publications.push('project'));
    const unset = useProjectSetStore.subscribe(() => publications.push('set'));
    expect(() =>
      useProjectStore.getState().updateComponentFromLayers(componentId, [panelId]),
    ).toThrow(/Transitions.*unknown shared source layer/);
    unproject();
    unset();
    expect(useProjectStore.getState().project).toBe(beforeProject);
    expect(useProjectSetStore.getState().projectSet).toBe(beforeSet);
    expect(history.getHistorySnapshot()).toBe(beforeHistory);
    expect(publications).toEqual([]);
    expect(composition().components[0]!.layers.some((layer) => layer.id === detailId)).toBe(true);
    validateProjectSetDocument(useProjectSetStore.getState().projectSet!);
  });

  it.each(['pending', 'redo'] as const)(
    'retains an existing %s history entry on rejection',
    (kind) => {
      const { componentId, panelId, detailId } = fixture();
      const store = useProjectStore.getState();
      const detail = composition().components[0]!.layers.find((layer) => layer.id === detailId)!;
      if (detail.element.type !== 'rectangle') throw new Error('Expected rectangle.');
      store.updateComponentLayer(componentId, detailId, {
        element: { ...detail.element, fill: '#f05030' },
      });
      if (kind === 'redo') history.undo();
      const beforeHistory = history.getHistorySnapshot();
      expect(kind === 'redo' ? beforeHistory.canRedo : beforeHistory.canUndo).toBe(true);
      const beforeProject = useProjectStore.getState().project;
      const beforeSet = useProjectSetStore.getState().projectSet;
      expect(() => store.updateComponentFromLayers(componentId, [panelId])).toThrow(/Transitions/);
      expect(history.getHistorySnapshot()).toBe(beforeHistory);
      expect(useProjectStore.getState().project).toBe(beforeProject);
      expect(useProjectSetStore.getState().projectSet).toBe(beforeSet);
    },
  );

  it('rejects deletion of a source used only by a shared graph instance', () => {
    const { componentId } = fixture();
    const store = useProjectStore.getState();
    // A portable set may retain a source only for the coordinated shared instance.
    const graphOnly = structuredClone(store.project);
    graphOnly.compositions[0]!.layers = [];
    useProjectStore.setState({ project: graphOnly });
    history.resetHistory();
    const beforeProject = useProjectStore.getState().project;
    const beforeSet = useProjectSetStore.getState().projectSet;
    const beforeHistory = history.getHistorySnapshot();
    expect(() => store.removeComponent(componentId)).toThrow(/references missing component/);
    expect(useProjectStore.getState().project).toBe(beforeProject);
    expect(useProjectSetStore.getState().projectSet).toBe(beforeSet);
    expect(history.getHistorySnapshot()).toBe(beforeHistory);
  });

  it('rejects marking a graph-referenced source as a nonrendering guide', () => {
    const { componentId, detailId } = fixture();
    const beforeProject = useProjectStore.getState().project;
    const beforeSet = useProjectSetStore.getState().projectSet;
    const beforeHistory = history.getHistorySnapshot();
    expect(() =>
      useProjectStore.getState().updateComponentLayer(componentId, detailId, {
        isGuide: true,
      }),
    ).toThrow(/Transitions.*unknown shared source layer/);
    expect(useProjectStore.getState().project).toBe(beforeProject);
    expect(useProjectSetStore.getState().projectSet).toBe(beforeSet);
    expect(history.getHistorySnapshot()).toBe(beforeHistory);
  });

  it('preflights remote component and metadata changes before publishing or flushing history', () => {
    const { componentId, panelId } = fixture();
    const initial = useProjectStore.getState().project;
    const result = applyAuthoringOperations(initial, [
      {
        type: 'update_component_from_layers',
        compositionId: composition().id,
        componentId,
        layerIds: [panelId],
      },
    ]);
    result.project.compositions[0]!.width += 16;
    const beforeSet = useProjectSetStore.getState().projectSet;
    const beforeHistory = history.getHistorySnapshot();
    expect(() => history.applyRemoteProjectUpdate(result.project, { source: 'agent' })).toThrow(
      /Transitions/,
    );
    expect(useProjectStore.getState().project).toBe(initial);
    expect(useProjectSetStore.getState().projectSet).toBe(beforeSet);
    expect(history.getHistorySnapshot()).toBe(beforeHistory);
  });

  it('publishes legal source changes with all inactive templates already reconciled', () => {
    const { componentId, detailId, secondTemplateId } = fixture();
    const original = composition().components.find((component) => component.id === componentId)!;
    const detail = original.layers.find((layer) => layer.id === detailId)!;
    if (detail.element.type !== 'rectangle') throw new Error('Expected rectangle.');
    const graph = structuredClone(useProjectSetStore.getState().projectSet!.transitionLogic);
    const coherent: boolean[] = [];
    const unsubscribe = useProjectStore.subscribe(() => {
      const set = useProjectSetStore.getState().projectSet!;
      validateProjectSetDocument(set);
      const other = resolveProjectSetTemplate(
        set,
        secondTemplateId,
      ).compositions[0]!.components.find((component) => component.id === componentId)!;
      const otherDetail = other.layers.find((layer) => layer.id === detailId)!;
      coherent.push(
        otherDetail.element.type === 'rectangle' && otherDetail.element.fill === '#146aff',
      );
    });
    useProjectStore.getState().updateComponentLayer(componentId, detailId, {
      element: { ...detail.element, fill: '#146aff' },
    });
    unsubscribe();
    expect(coherent).toEqual([true]);
    expect(useProjectSetStore.getState().projectSet!.transitionLogic).toEqual(graph);
    history.undo();
    expect(
      composition()
        .components.find((component) => component.id === componentId)!
        .layers.find((layer) => layer.id === detailId)!.element,
    ).toEqual(detail.element);
    history.redo();
    expect(
      composition()
        .components.find((component) => component.id === componentId)!
        .layers.find((layer) => layer.id === detailId)!.element,
    ).toMatchObject({ fill: '#146aff' });
  });

  it('retains local component updates without requiring a template-set graph', () => {
    const store = useProjectStore.getState();
    const first = store.addLayer('rectangle');
    const second = store.addLayer('rectangle');
    const componentId = store.createComponent([first, second], 'Local panel')!;
    expect(store.updateComponentFromLayers(componentId, [first])).toBe(true);
    expect(composition().components[0]!.layers.map((layer) => layer.id)).toEqual([first]);
  });
});
