import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, createRectangleLayer } from '@ograf-editor/scene-model';
import { createProjectSet, saveProjectSetTemplateEdits } from './projectSet';
import { useProjectStore } from './projectStore';
import { useProjectSetStore } from './projectSetStore';
import { useSelectionStore } from './selectionStore';
import { useTestDataStore } from './testDataStore';

vi.useFakeTimers();
vi.stubGlobal('window', {
  clearTimeout: (timer: ReturnType<typeof setTimeout> | undefined) => clearTimeout(timer),
});
const history = await import('./historyStore');

function openSet() {
  const project = createProject({ name: 'Correspondent' });
  const layer = createRectangleLayer();
  project.compositions[0]!.layers.push(layer);
  const set = createProjectSet('News', project);
  useProjectSetStore.setState({ projectSet: set, activeTemplateId: set.templates[0]!.id });
  useProjectStore.getState().loadProject(project);
  useSelectionStore.getState().select(layer.id);
  useTestDataStore.getState().setValue('old-preview-field', 'old value');
  history.resetHistory();
  return { project, set };
}

describe('standalone file and template-set association', () => {
  beforeEach(() => {
    useProjectSetStore.getState().clearProjectSet();
    useProjectStore.getState().newProject();
    useTestDataStore.getState().resetAll();
    history.resetHistory();
  });

  afterAll(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('closes the previous set when MCP explicitly opens a different standalone file', () => {
    const { set } = openSet();
    const beforeSet = structuredClone(set);
    const standalone = createProject({ name: 'L-band' });
    history.applyRemoteProjectUpdate(standalone, {
      source: 'agent',
      documentContext: 'standalone',
    });
    expect(useProjectStore.getState().project).toEqual(standalone);
    expect(useProjectSetStore.getState()).toMatchObject({
      projectSet: null,
      activeTemplateId: null,
    });
    expect(set).toEqual(beforeSet);
    expect(useSelectionStore.getState().selectedLayerIds).toEqual([]);
    expect(useTestDataStore.getState().values).toEqual({});
    expect(history.getHistorySnapshot()).toMatchObject({ past: [], future: [] });
  });

  it('also closes the set when opening a standalone export with the same project ID', () => {
    const { project } = openSet();
    history.applyRemoteProjectUpdate(structuredClone(project), {
      source: 'agent',
      documentContext: 'standalone',
    });
    expect(useProjectSetStore.getState().projectSet).toBeNull();
    expect(useProjectSetStore.getState().activeTemplateId).toBeNull();
    expect(useSelectionStore.getState().selectedLayerIds).toEqual([]);
    expect(useTestDataStore.getState().values).toEqual({});
  });

  it('preserves set membership for ordinary agent edits and synchronization', () => {
    const { project, set } = openSet();
    history.applyRemoteProjectUpdate(structuredClone(project), { source: 'system' });
    const edited = { ...project, name: 'Correspondent revised' };
    history.applyRemoteProjectUpdate(edited, { source: 'agent', reason: 'Rename template' });
    expect(useProjectSetStore.getState().projectSet?.id).toBe(set.id);
    expect(useProjectSetStore.getState().activeTemplateId).toBe(set.templates[0]!.id);
    const snapshot = saveProjectSetTemplateEdits(set, set.templates[0]!.id, edited);
    expect(snapshot.templates[0]!.project.name).toBe('Correspondent revised');
    history.undo();
    expect(useProjectStore.getState().project.name).toBe('Correspondent');
    expect(useProjectSetStore.getState().projectSet?.id).toBe(set.id);
  });

  it('never copies an unrelated project into a stale active template during snapshots or saves', () => {
    const { set } = openSet();
    const unrelated = createProject({ name: 'Other document' });
    const snapshot = saveProjectSetTemplateEdits(set, set.templates[0]!.id, unrelated);
    expect(snapshot).toBe(set);
    expect(snapshot.templates[0]!.project.name).toBe('Correspondent');
    expect(snapshot.templates[0]!.project.id).not.toBe(unrelated.id);
  });
});
