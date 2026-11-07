import { beforeEach, describe, expect, it } from 'vitest';
import {
  createComposition,
  createCustomActionDefinition,
  createFieldDefinition,
  createMediaCue,
  createProject,
  type LogicFunctionDefinition,
} from '@ograf-editor/scene-model';
import { useProjectStore } from './projectStore';

describe('Studio function ownership and reference safety', () => {
  beforeEach(() => useProjectStore.getState().newProject());
  it('edits functions in the requested composition, rejects invalid replacement and protects referenced resources', () => {
    const project = createProject({ supportsNonRealTime: false });
    const composition = createComposition({
      dataFields: [createFieldDefinition('number', { id: 'score', key: 'score' })],
      customActions: [createCustomActionDefinition({ actionId: 'increment' })],
      mediaCues: [createMediaCue({ id: 'music' })],
    });
    project.compositions.push(composition);
    useProjectStore.getState().loadProject(project);
    const definition: LogicFunctionDefinition = {
      type: 'javascript',
      version: 1,
      id: 'counter',
      name: 'Counter',
      enabled: true,
      source: '(ctx)=>({data:{score:ctx.data.score+1}})',
      inputs: { score: 'score' },
      outputs: { score: 'score' },
      actions: ['increment'],
      media: { music: 'music' },
    };
    useProjectStore.getState().setLogicFunctions([definition], composition.id);
    expect(useProjectStore.getState().project.compositions[0]!.functions).toBeUndefined();
    expect(useProjectStore.getState().project.compositions[1]!.functions).toEqual([definition]);
    expect(useProjectStore.getState().project.supportsNonRealTime).toBe(false);
    const before = JSON.stringify(useProjectStore.getState().project);
    expect(() =>
      useProjectStore
        .getState()
        .setLogicFunctions([{ ...definition, outputs: { score: 'missing' } }], composition.id),
    ).toThrow(/missing data field/);
    expect(JSON.stringify(useProjectStore.getState().project)).toBe(before);
    useProjectStore.getState().setActiveComposition(composition.id);
    const actionId = composition.customActions[0]!.id;
    for (const action of [
      () => useProjectStore.getState().removeDataField('score'),
      () => useProjectStore.getState().removeMediaCue('music'),
      () => useProjectStore.getState().removeCustomAction(actionId),
      () => useProjectStore.getState().updateCustomAction(actionId, { actionId: 'renamed' }),
    ])
      expect(action).toThrow(/Remove or reconfigure the function first/);
    useProjectStore.getState().updateCustomAction(actionId, { name: 'Add one' });
    useProjectStore.getState().setLogicFunctions([]);
    useProjectStore.getState().removeDataField('score');
    expect(useProjectStore.getState().project.compositions[1]!.functions).toBeUndefined();
  });
});
