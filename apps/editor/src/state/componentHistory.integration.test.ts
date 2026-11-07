import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '@ograf-editor/scene-model';
import { applyAuthoringOperations } from '../../../../packages/authoring-core/src/operations';
import { useProjectStore } from './projectStore';
import { useProjectSetStore } from './projectSetStore';
import { addProjectSetTemplate, createProjectSet, resolveProjectSetTemplate } from './projectSet';

vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
vi.stubGlobal('window', {
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
});
const history = await import('./historyStore');
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('component transactions across template history', () => {
  beforeEach(() => {
    useProjectSetStore.getState().clearProjectSet();
    useProjectStore.getState().newProject();
    history.resetHistory();
  });

  it('undoes and redoes a remote parent edit with its shared library as one change', () => {
    const store = useProjectStore.getState();
    const layerId = store.addLayer('rectangle');
    let set = createProjectSet('Package', useProjectStore.getState().project);
    set = addProjectSetTemplate(set, createProject({ name: 'Second' }));
    const firstId = set.templates[0]!.id;
    const secondId = set.templates[1]!.id;
    useProjectSetStore.getState().setProjectSet(set);
    useProjectSetStore.getState().setActiveTemplateId(firstId);
    const componentId = store.createComponent([layerId], 'Panel')!;
    const initial = useProjectStore.getState().project;
    const composition = initial.compositions[0]!;
    const source = composition.components.find((item) => item.id === componentId)!.layers[0]!;
    if (source.element.type !== 'rectangle') throw new Error('Expected rectangle.');
    const previousFill = source.element.fill;
    history.resetHistory();
    const update = applyAuthoringOperations(initial, [
      {
        type: 'update_component_layer',
        compositionId: composition.id,
        componentId,
        sourceLayerId: layerId,
        patch: { element: { fill: '#1234aa' } },
      },
    ]);
    history.applyRemoteProjectUpdate(update.project, { source: 'agent', reason: 'Edit component' });
    const fill = () => {
      const child = useProjectStore
        .getState()
        .project.compositions[0]!.layers.find((item) => item.id === layerId)!;
      return child.element.type === 'rectangle' ? child.element.fill : null;
    };
    const otherSourceFill = () => {
      const project = resolveProjectSetTemplate(
        useProjectSetStore.getState().projectSet!,
        secondId,
      );
      const child = project.compositions[0]!.components.find((item) => item.id === componentId)!
        .layers[0]!;
      return child.element.type === 'rectangle' ? child.element.fill : null;
    };
    expect(fill()).toBe('#1234aa');
    expect(otherSourceFill()).toBe('#1234aa');
    history.undo();
    expect(fill()).toEqual(previousFill);
    expect(otherSourceFill()).toEqual(previousFill);
    history.redo();
    expect(fill()).toBe('#1234aa');
    expect(otherSourceFill()).toBe('#1234aa');
    expect(useProjectStore.getState().project.compositions[0]!.layers[0]!.id).toBe(layerId);
  });
});
