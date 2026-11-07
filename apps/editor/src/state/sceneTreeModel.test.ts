import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createComposition,
  createFieldDefinition,
  createImageLayer,
  createProject,
} from '@ograf-editor/scene-model';
import { filterSceneTree, findSceneTreePath, visibleSceneTreeNodes } from './sceneTreeModel';
import { activateSceneTreeNode, applyProjectSetChange } from './projectSetSession';
import { useProjectStore } from './projectStore';
import { useProjectSetStore } from './projectSetStore';
import { useSelectionStore } from './selectionStore';
import {
  addProjectSetTemplate,
  addProjectSetControl,
  buildProjectSetSceneTree,
  createProjectSet,
  resolveProjectSetTemplate,
  setProjectSetControlValue,
  type ProjectSetSceneNode,
} from './projectSet';

vi.mock('./historyStore', () => ({
  resetHistory: vi.fn(),
  runDiscreteHistoryStep: (mutation: () => unknown) => mutation(),
}));

const node = (
  id: string,
  label: string,
  children: ProjectSetSceneNode[] = [],
): ProjectSetSceneNode => ({ id, label, kind: 'assets', children });
const root = node('set', 'Evening Show', [
  node('news', 'News', [
    node('assets', 'Assets', [node('logo', 'Station Logo', [node('use', 'Logo on air')])]),
  ]),
  node('sports', 'Sports'),
]);

describe('Scene Tree explorer', () => {
  beforeEach(() => {
    useProjectSetStore.getState().clearProjectSet();
    useProjectStore.getState().newProject();
    useSelectionStore.getState().select(null);
  });

  it('searches deeply while retaining ancestors and uses of a matched asset', () => {
    const filtered = filterSceneTree(root, 'station logo')!;
    expect(visibleSceneTreeNodes(filtered, new Set(), true).map((item) => item.node.id)).toEqual([
      'set',
      'news',
      'assets',
      'logo',
      'use',
    ]);
    expect(filterSceneTree(root, 'missing')).toBeNull();
    expect(root.children).toHaveLength(2);
  });

  it('provides keyboard order and ancestry without exposing collapsed descendants', () => {
    expect(visibleSceneTreeNodes(root, new Set(['set'])).map((item) => item.node.id)).toEqual([
      'set',
      'news',
      'sports',
    ]);
    const path = findSceneTreePath(root, (item) => item.id === 'use')!;
    expect(path.map((item) => item.id)).toEqual(['set', 'news', 'assets', 'logo', 'use']);
    const visible = visibleSceneTreeNodes(root, new Set(path.map((item) => item.id)));
    expect(visible.find((item) => item.node.id === 'logo')).toMatchObject({
      depth: 3,
      parentId: 'assets',
      position: 1,
      siblingCount: 1,
    });
  });

  it('selects an asset instance in its actual composition without changing the main composition', () => {
    const project = createProject();
    const composition = createComposition({ name: 'Nested scene' });
    const layer = createImageLayer();
    composition.layers.push(layer);
    project.compositions.push(composition);
    useProjectStore.getState().loadProject(project);
    activateSceneTreeNode({
      id: 'use',
      kind: 'asset-instance',
      label: 'Logo use',
      compositionId: composition.id,
      targetId: layer.id,
      targetKind: 'layer',
      children: [],
    });
    expect(useProjectStore.getState().activeCompositionId).toBe(composition.id);
    expect(useProjectStore.getState().project.mainCompositionId).toBe(project.mainCompositionId);
    expect(useSelectionStore.getState().selectedLayerId).toBe(layer.id);
  });

  it('preserves outgoing template edits when navigating to another template layer', () => {
    const first = createProject({ name: 'News' });
    const second = createProject({ name: 'Sports' });
    const layer = createImageLayer();
    second.compositions[0]!.layers.push(layer);
    const set = addProjectSetTemplate(createProjectSet('Show', first), second);
    useProjectSetStore.getState().setProjectSet(set);
    useProjectSetStore.getState().setActiveTemplateId(set.templates[0]!.id);
    useProjectStore.getState().loadProject(first);
    useProjectStore.getState().setProjectMeta({ description: 'Unsaved edits' });
    const path = findSceneTreePath(
      buildProjectSetSceneTree(set),
      (node) => node.kind === 'layer' && node.targetId === layer.id,
    )!;
    activateSceneTreeNode(path.at(-1)!);
    expect(useProjectSetStore.getState().activeTemplateId).toBe(set.templates[1]!.id);
    expect(useProjectSetStore.getState().projectSet!.templates[0]!.project.description).toBe(
      'Unsaved edits',
    );
    expect(useSelectionStore.getState().selectedLayerId).toBe(layer.id);
  });

  it('keeps the selected scene and layer when editing an inherited control from the explorer', () => {
    const project = createProject({ name: 'News' });
    const nested = createComposition({ name: 'Nested scene' });
    const field = createFieldDefinition('text', {
      key: 'headline',
      defaultValue: 'Local headline',
    });
    const layer = createImageLayer();
    nested.dataFields.push(field);
    nested.layers.push(layer);
    project.compositions.push(nested);
    let set = createProjectSet('Show', project);
    const templateId = set.templates[0]!.id;
    set = addProjectSetControl(set, templateId, nested.id, field.id, project);
    useProjectSetStore.getState().setProjectSet(set);
    useProjectSetStore.getState().setActiveTemplateId(templateId);
    useProjectStore.getState().loadProject(resolveProjectSetTemplate(set, templateId));
    useProjectStore.getState().setActiveComposition(nested.id);
    useSelectionStore.getState().select(layer.id);
    const changed = setProjectSetControlValue(set, set.controls[0]!.field.id, 'Shared headline');

    applyProjectSetChange(changed, true);

    const current = useProjectStore.getState();
    expect(current.activeCompositionId).toBe(nested.id);
    expect(useSelectionStore.getState().selectedLayerId).toBe(layer.id);
    expect(
      current.project.compositions.find((item) => item.id === nested.id)!.dataFields[0]!
        .defaultValue,
    ).toBe('Shared headline');
  });
});
