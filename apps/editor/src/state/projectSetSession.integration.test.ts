import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFieldDefinition, createLayerOfKind, createProject } from '@ograf-editor/scene-model';
import { useProjectStore } from './projectStore';
import { useProjectSetStore } from './projectSetStore';
import { useSelectionStore } from './selectionStore';
import { useTestDataStore } from './testDataStore';
import { useTimelineStore } from './timelineStore';
import { useLayerClipboardStore } from './layerClipboardStore';
import { resolvePreviewFieldValue } from './previewFieldValue';
import {
  addProjectSetControl,
  addProjectSetTemplate,
  bindProjectSetControl,
  createProjectSet,
  resolveProjectSetTemplate,
  setProjectSetControlValue,
} from './projectSet';

vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
vi.stubGlobal('window', {
  clearTimeout: (timer: ReturnType<typeof setTimeout> | undefined) => clearTimeout(timer),
});
const history = await import('./historyStore');
const { activateProjectSetTemplate, activateAdjacentProjectSetTemplate } =
  await import('./projectSetSession');

function makeProject(name: string) {
  const project = createProject({ name });
  const composition = project.compositions[0]!;
  composition.name = `${name} composition`;
  composition.layers.push(createLayerOfKind('text'));
  // Independently created or imported templates can retain the same field identity.
  composition.dataFields.push(
    createFieldDefinition('text', {
      id: 'shared-field-id',
      key: 'headline',
      label: 'Headline',
      defaultValue: `${name} headline`,
    }),
  );
  return project;
}

function fixture() {
  const first = makeProject('News');
  const second = makeProject('Weather');
  const third = makeProject('Sport');
  const set = addProjectSetTemplate(
    addProjectSetTemplate(createProjectSet('Broadcast', first), second),
    third,
  );
  const [firstId, secondId, thirdId] = set.templates.map((template) => template.id) as [
    string,
    string,
    string,
  ];
  useProjectSetStore.setState({ projectSet: set, activeTemplateId: firstId });
  useProjectStore.getState().loadProject(resolveProjectSetTemplate(set, firstId));
  history.resetHistory();
  return { set, first, second, third, firstId, secondId, thirdId };
}

function currentHeadline() {
  const project = useProjectStore.getState().project;
  const field = project.compositions[0]!.dataFields.find((item) => item.key === 'headline')!;
  return resolvePreviewFieldValue(field, useTestDataStore.getState().values[field.id]);
}

describe('template selection shared by Templates and Preview & Export', () => {
  beforeEach(() => {
    useProjectSetStore.getState().clearProjectSet();
    useProjectStore.getState().newProject();
    useTestDataStore.getState().resetAll();
    useSelectionStore.getState().select(null);
    history.resetHistory();
  });

  afterAll(() => {
    history.resetHistory();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('distinguishes reopening a document from navigation and ordinary edits', () => {
    const { set, secondId } = fixture();
    const store = useProjectStore.getState();
    const opened = store.documentLoadRevision;
    store.setProjectMeta({ name: 'Edited title' });
    expect(useProjectStore.getState().documentLoadRevision).toBe(opened);
    activateProjectSetTemplate(secondId);
    expect(useProjectStore.getState().documentLoadRevision).toBe(opened);
    store.loadProject(resolveProjectSetTemplate(set, secondId));
    expect(useProjectStore.getState().documentLoadRevision).toBe(opened + 1);
    store.loadProject(resolveProjectSetTemplate(set, secondId));
    expect(useProjectStore.getState().documentLoadRevision).toBe(opened + 2);
    expect(useProjectStore.getState().project).not.toHaveProperty('documentLoadRevision');
  });

  it('uses one selection and the correct composition when moving forward and backward', () => {
    const { first, second, third, firstId, secondId, thirdId } = fixture();
    for (const [templateId, project] of [
      [secondId, second],
      [thirdId, third],
      [secondId, second],
      [firstId, first],
    ] as const) {
      expect(activateProjectSetTemplate(templateId)).toBe(true);
      expect(useProjectSetStore.getState().activeTemplateId).toBe(templateId);
      expect(useProjectSetStore.getState().projectSet?.activeTemplateId).toBe(templateId);
      expect(useProjectStore.getState().project.id).toBe(project.id);
      expect(useProjectStore.getState().activeCompositionId).toBe(project.mainCompositionId);
      expect(currentHeadline()).toBe(`${project.name} headline`);
    }
  });

  it('handles rapid next, next, previous navigation using the latest selection', () => {
    const { firstId, secondId, thirdId } = fixture();
    useProjectStore.getState().setProjectMeta({ name: 'Updated before Next' });
    expect(activateAdjacentProjectSetTemplate(1)).toBe(true);
    expect(useProjectSetStore.getState().activeTemplateId).toBe(secondId);
    expect(activateAdjacentProjectSetTemplate(1)).toBe(true);
    expect(useProjectSetStore.getState().activeTemplateId).toBe(thirdId);
    expect(activateAdjacentProjectSetTemplate(-1)).toBe(true);
    expect(useProjectSetStore.getState().activeTemplateId).toBe(secondId);
    expect(currentHeadline()).toBe('Weather headline');
    expect(
      useProjectSetStore.getState().projectSet!.templates.find((item) => item.id === firstId)!
        .project.name,
    ).toBe('Updated before Next');
  });

  it('does not wrap or reload at the first and last template boundaries', () => {
    const { firstId, thirdId } = fixture();
    const first = useProjectStore.getState().project;
    useTestDataStore.getState().setValue('shared-field-id', 'First preview');
    expect(activateAdjacentProjectSetTemplate(-1)).toBe(false);
    expect(useProjectSetStore.getState().activeTemplateId).toBe(firstId);
    expect(useProjectStore.getState().project).toBe(first);
    expect(currentHeadline()).toBe('First preview');
    activateProjectSetTemplate(thirdId);
    const last = useProjectStore.getState().project;
    useTestDataStore.getState().setValue('shared-field-id', 'Last preview');
    expect(activateAdjacentProjectSetTemplate(1)).toBe(false);
    expect(useProjectSetStore.getState().activeTemplateId).toBe(thirdId);
    expect(useProjectStore.getState().project).toBe(last);
    expect(currentHeadline()).toBe('Last preview');
  });

  it('allows Next to select the first template when the session selection is missing', () => {
    const { firstId } = fixture();
    useProjectSetStore.getState().setActiveTemplateId('deleted-template');
    expect(activateAdjacentProjectSetTemplate(-1)).toBe(false);
    expect(useProjectSetStore.getState().activeTemplateId).toBe('deleted-template');
    expect(activateAdjacentProjectSetTemplate(1)).toBe(true);
    expect(useProjectSetStore.getState().activeTemplateId).toBe(firstId);
    expect(currentHeadline()).toBe('News headline');
  });

  it('discards outgoing preview data and rule results even when incoming field IDs match', () => {
    const { secondId, firstId } = fixture();
    useTestDataStore.setState({
      values: { 'shared-field-id': 'Temporary operator edit', oldOnly: true },
      visualRuleStateOverrides: {
        oldLayer: { visibility: false, properties: {}, transitionFrames: {} },
      },
    });
    activateProjectSetTemplate(secondId);
    expect(useTestDataStore.getState().values).toEqual({});
    expect(useTestDataStore.getState().visualRuleStateOverrides).toEqual({});
    expect(currentHeadline()).toBe('Weather headline');
    useTestDataStore.getState().setValue('shared-field-id', 'Weather preview');
    activateProjectSetTemplate(firstId);
    expect(currentHeadline()).toBe('News headline');
  });

  it('persists authored edits before switching and restores them on return', () => {
    const { firstId, secondId } = fixture();
    useProjectStore.getState().setProjectMeta({ name: 'Edited News' });
    useProjectStore
      .getState()
      .updateDataField('shared-field-id', { defaultValue: 'Edited headline' });
    activateProjectSetTemplate(secondId);
    const saved = useProjectSetStore
      .getState()
      .projectSet!.templates.find((template) => template.id === firstId)!.project;
    expect(saved.name).toBe('Edited News');
    expect(saved.compositions[0]!.dataFields[0]!.defaultValue).toBe('Edited headline');
    activateProjectSetTemplate(firstId);
    expect(useProjectStore.getState().project.name).toBe('Edited News');
    expect(currentHeadline()).toBe('Edited headline');
  });

  it('stops outgoing playback, clears child selection, and resets history', () => {
    const { secondId, first } = fixture();
    const stop = vi.fn();
    useTimelineStore.setState({
      currentFrame: 65,
      isPlaying: true,
      autoKeyframe: true,
      previewLoopLayerId: first.compositions[0]!.layers[0]!.id,
      controller: { stop, seek: vi.fn(), play: vi.fn(), pause: vi.fn() },
    });
    useSelectionStore.getState().select(first.compositions[0]!.layers[0]!.id);
    useProjectStore.getState().setProjectMeta({ name: 'Edited' });
    expect(history.getHistorySnapshot().canUndo).toBe(true);
    activateProjectSetTemplate(secondId);
    expect(stop).toHaveBeenCalledOnce();
    expect(useTimelineStore.getState()).toMatchObject({
      currentFrame: 12,
      isPlaying: false,
      autoKeyframe: false,
      previewLoopLayerId: null,
      controller: null,
    });
    expect(useSelectionStore.getState().selectedLayerIds).toEqual([]);
    expect(history.getHistorySnapshot()).toMatchObject({ canUndo: false, canRedo: false });
  });

  it('does not reload or clear data when reselecting the correctly active template', () => {
    const { firstId, first } = fixture();
    const project = useProjectStore.getState().project;
    useTestDataStore.getState().setValue('shared-field-id', 'Keep operator edit');
    useTimelineStore.getState().setCurrentFrame(42);
    const layerId = first.compositions[0]!.layers[0]!.id;
    expect(activateProjectSetTemplate(firstId, layerId)).toBe(true);
    expect(useProjectStore.getState().project).toBe(project);
    expect(currentHeadline()).toBe('Keep operator edit');
    expect(useTimelineStore.getState().currentFrame).toBe(42);
    expect(useSelectionStore.getState().selectedLayerId).toBe(layerId);
  });

  it('repairs a stale active template ID without saving an unrelated project over the template', () => {
    const { firstId, first } = fixture();
    useProjectStore.getState().loadProject(makeProject('Unrelated document'));
    useTestDataStore.getState().setValue('shared-field-id', 'Unrelated preview');
    expect(activateProjectSetTemplate(firstId)).toBe(true);
    expect(useProjectStore.getState().project.id).toBe(first.id);
    expect(currentHeadline()).toBe('News headline');
    expect(useProjectSetStore.getState().projectSet!.templates[0]!.project.name).toBe('News');
  });

  it('does not overwrite the outgoing source when Next follows an unrelated project load', () => {
    const { firstId, secondId, second } = fixture();
    useProjectStore.getState().loadProject(makeProject('Unrelated document'));
    expect(activateAdjacentProjectSetTemplate(1)).toBe(true);
    expect(useProjectSetStore.getState().activeTemplateId).toBe(secondId);
    expect(useProjectStore.getState().project.id).toBe(second.id);
    expect(
      useProjectSetStore.getState().projectSet!.templates.find((item) => item.id === firstId)!
        .project.name,
    ).toBe('News');
  });

  it('reapplies shared controls for the incoming template after clearing local preview data', () => {
    const { set, first, second, firstId, secondId } = fixture();
    let sharedSet = addProjectSetControl(set, firstId, first.mainCompositionId, 'shared-field-id');
    const controlId = sharedSet.controls[0]!.field.id;
    sharedSet = bindProjectSetControl(
      sharedSet,
      controlId,
      secondId,
      second.mainCompositionId,
      'shared-field-id',
    );
    sharedSet = setProjectSetControlValue(sharedSet, controlId, 'Shared bulletin');
    useProjectSetStore.getState().setProjectSet(sharedSet);
    useTestDataStore.getState().setValue('shared-field-id', 'Old local edit');
    activateProjectSetTemplate(secondId);
    expect(currentHeadline()).toBe('Shared bulletin');
    expect(useTestDataStore.getState().values).toEqual({ 'shared-field-id': 'Shared bulletin' });
  });

  it('leaves all state untouched when asked for an unknown template', () => {
    fixture();
    useTestDataStore.getState().setValue('shared-field-id', 'Keep this');
    const project = useProjectStore.getState().project;
    const session = useProjectSetStore.getState();
    const data = useTestDataStore.getState().values;
    const snapshot = history.getHistorySnapshot();
    expect(() => activateProjectSetTemplate('missing-template')).toThrow('Template not found');
    expect(useProjectStore.getState().project).toBe(project);
    expect(useProjectSetStore.getState()).toBe(session);
    expect(useTestDataStore.getState().values).toBe(data);
    expect(history.getHistorySnapshot()).toBe(snapshot);
  });

  it('rejects an invalid target before changing selection, history, preview data or playback', () => {
    const { first, secondId } = fixture();
    const broken = structuredClone(useProjectSetStore.getState().projectSet!);
    const text = broken.templates.find((template) => template.id === secondId)!.project
      .compositions[0]!.layers[0]!.element;
    if (text.type !== 'text') throw new Error('Expected a text layer.');
    text.fontSize = 16;
    text.minFontSize = 24;
    useProjectSetStore.getState().setProjectSet(broken);
    useProjectStore.getState().setProjectMeta({ name: 'Unsaved outgoing edit' });
    useSelectionStore.getState().select(first.compositions[0]!.layers[0]!.id);
    useTestDataStore.getState().setValue('shared-field-id', 'Keep preview data');
    useLayerClipboardStore.getState().copy(first.compositions[0]!.layers);
    const stop = vi.fn();
    useTimelineStore.setState({
      currentFrame: 37,
      isPlaying: true,
      controller: { stop, seek: vi.fn(), play: vi.fn(), pause: vi.fn() },
    });
    const project = useProjectStore.getState();
    const session = useProjectSetStore.getState();
    const selection = useSelectionStore.getState();
    const data = useTestDataStore.getState();
    const timeline = useTimelineStore.getState();
    const clipboard = useLayerClipboardStore.getState();
    const snapshot = history.getHistorySnapshot();
    expect(() => activateProjectSetTemplate(secondId)).toThrow(/minimum font size/);
    expect(useProjectStore.getState()).toBe(project);
    expect(useProjectSetStore.getState()).toBe(session);
    expect(useSelectionStore.getState()).toBe(selection);
    expect(useTestDataStore.getState()).toBe(data);
    expect(useTimelineStore.getState()).toBe(timeline);
    expect(useLayerClipboardStore.getState()).toBe(clipboard);
    expect(history.getHistorySnapshot()).toBe(snapshot);
    expect(stop).not.toHaveBeenCalled();
  });

  it('commits no set or editor changes when the target loader rejects', () => {
    const { first, secondId } = fixture();
    useSelectionStore.getState().select(first.compositions[0]!.layers[0]!.id);
    useTestDataStore.getState().setValue('shared-field-id', 'Keep this');
    const original = useProjectStore.getState().loadProject;
    const rejected = vi.fn(() => {
      throw new Error('Target load rejected');
    });
    useProjectStore.setState({ loadProject: rejected });
    const project = useProjectStore.getState();
    const session = useProjectSetStore.getState();
    const selection = useSelectionStore.getState();
    const data = useTestDataStore.getState();
    const snapshot = history.getHistorySnapshot();
    try {
      expect(() => activateProjectSetTemplate(secondId)).toThrow('Target load rejected');
      expect(rejected).toHaveBeenCalledOnce();
      expect(useProjectStore.getState()).toBe(project);
      expect(useProjectSetStore.getState()).toBe(session);
      expect(useSelectionStore.getState()).toBe(selection);
      expect(useTestDataStore.getState()).toBe(data);
      expect(history.getHistorySnapshot()).toBe(snapshot);
    } finally {
      useProjectStore.setState({ loadProject: original });
    }
  });

  it('keeps outgoing templates independent when imported children share a project ID', () => {
    const { firstId, secondId } = fixture();
    const set = structuredClone(useProjectSetStore.getState().projectSet!);
    const first = set.templates.find((template) => template.id === firstId)!;
    set.templates.find((template) => template.id === secondId)!.project.id = first.project.id;
    useProjectSetStore.getState().setProjectSet(set);
    useProjectStore.getState().setProjectMeta({ name: 'Edited News' });
    activateProjectSetTemplate(secondId);
    expect(useProjectStore.getState().project.name).toBe('Weather');
    expect(
      useProjectSetStore
        .getState()
        .projectSet!.templates.find((template) => template.id === firstId)!.project.name,
    ).toBe('Edited News');
    activateProjectSetTemplate(firstId);
    expect(useProjectStore.getState().project.name).toBe('Edited News');
  });

  it('does nothing when no template set is open', () => {
    const project = useProjectStore.getState().project;
    expect(activateProjectSetTemplate('missing-template')).toBe(false);
    expect(activateAdjacentProjectSetTemplate(1)).toBe(false);
    expect(activateAdjacentProjectSetTemplate(-1)).toBe(false);
    expect(useProjectStore.getState().project).toBe(project);
    expect(useProjectSetStore.getState().activeTemplateId).toBeNull();
  });
});
