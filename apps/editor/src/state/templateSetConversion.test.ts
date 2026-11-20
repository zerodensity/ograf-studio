import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '@ograf-editor/scene-model';
import { getHistorySnapshot, resetHistory, undo } from './historyStore';
import { useProjectStore } from './projectStore';
import { useProjectSetStore } from './projectSetStore';
import { addSecondTemplateToNewSet } from './templateSetConversion';

vi.stubGlobal('window', { clearTimeout });

describe('adding a second template', () => {
  beforeEach(() => {
    useProjectSetStore.getState().clearProjectSet();
    useProjectStore.getState().newProject();
    resetHistory();
  });

  it('creates one undoable set without changing the open project', () => {
    const original = useProjectStore.getState().project;
    const incoming = createProject({ name: 'Another' });
    incoming.compositions[0]!.width = original.compositions[0]!.width - 100;
    expect(addSecondTemplateToNewSet(incoming, original.id)).toBe('Another');
    const templates = useProjectSetStore.getState().projectSet?.templates;
    expect(templates).toHaveLength(2);
    expect(templates?.[1]).toMatchObject({ inheritSettings: false, inheritBrandKit: false });
    expect(templates?.[1]?.project.compositions[0]?.width).toBe(incoming.compositions[0]!.width);
    expect(useProjectStore.getState().project.id).toBe(original.id);
    expect(getHistorySnapshot().past).toHaveLength(1);
    expect(getHistorySnapshot().past[0]?.label).toBe('Create template set');
    undo();
    expect(useProjectSetStore.getState().projectSet).toBeNull();
    expect(useProjectStore.getState().project.id).toBe(original.id);
  });

  it('rejects a stale document without creating a set', () => {
    expect(() => addSecondTemplateToNewSet(createProject(), 'stale-id')).toThrow(
      'document changed',
    );
    expect(useProjectSetStore.getState().projectSet).toBeNull();
    expect(getHistorySnapshot().past).toHaveLength(0);
  });
});
