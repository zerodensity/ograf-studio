import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFieldDefinition,
  createProject,
  createTextLayer,
  type Project,
} from '@ograf-editor/scene-model';
import {
  getHistorySnapshot,
  redo,
  resetHistory,
  runDiscreteHistoryStep,
  undo,
} from './historyStore';
import { useLayerClipboardStore } from './layerClipboardStore';
import { addProjectSetTemplate, createProjectSet, resolveProjectSetTemplate } from './projectSet';
import { useProjectSetStore } from './projectSetStore';
import { useProjectStore } from './projectStore';
import { useSelectionStore } from './selectionStore';
import {
  copyTemplate,
  duplicateTemplate,
  insertTemplateProjectWithReport,
  pasteTemplateWithReport,
  useTemplateClipboardStore,
} from './templateCommands';
import {
  captureTemplateTransferDestination,
  commitTemplateTransfer,
  prepareTemplateTransfer,
} from './templateTransfer';
import { useTestDataStore } from './testDataStore';
import { useTimelineStore } from './timelineStore';
import { createDefaultTransitionLogic } from './transitionLogicEditing';

function makeProject(name: string, settings: { width: number; frameRate: number }) {
  const project = createProject({ name });
  const composition = project.compositions[0]!;
  Object.assign(composition, settings);
  composition.layers.push(createTextLayer());
  composition.dataFields.push(
    createFieldDefinition('text', { key: 'headline', label: 'Headline' }),
  );
  return project;
}

function openSet(project: Project) {
  const deck = createProjectSet(project.name + ' Set', project);
  const activeTemplateId = deck.templates[0]!.id;
  useProjectSetStore.setState({ projectSet: deck, activeTemplateId });
  useProjectStore.getState().loadProject(resolveProjectSetTemplate(deck, activeTemplateId));
  resetHistory();
  return deck;
}

describe('preserved template transfer commands', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { clearTimeout });
    useTemplateClipboardStore.setState({ copied: null, removed: null });
    useProjectSetStore.getState().clearProjectSet();
    useProjectStore.getState().newProject();
    useSelectionStore.getState().select(null);
    useTestDataStore.getState().resetAll();
    resetHistory();
  });

  afterEach(() => {
    useTimelineStore.getState().setController(null);
    resetHistory();
    vi.unstubAllGlobals();
  });

  it('pastes a frozen cross-set source in one undoable step and returns stable destination IDs', () => {
    const source = makeProject('Source', { width: 1280, frameRate: 25 });
    const sourceDeck = openSet(source);
    copyTemplate(sourceDeck.templates[0]!.id);
    const frozenSource = structuredClone(sourceDeck);

    const destination = makeProject('Destination', { width: 1920, frameRate: 50 });
    const destinationDeck = openSet(destination);
    runDiscreteHistoryStep(
      () => useProjectStore.getState().setProjectMeta({ description: 'An earlier edit' }),
      'Edit description',
    );
    const projectBefore = useProjectStore.getState().project;
    const previousHistory = getHistorySnapshot();
    const originalPrompt = 'Copy the title as it currently looks.';
    const result = pasteTemplateWithReport(
      destinationDeck.activeTemplateId,
      'before',
      originalPrompt,
    );
    const transfer = result.transfer!;
    const setAfter = useProjectSetStore.getState().projectSet!;
    const projectAfter = useProjectStore.getState().project;
    const added = setAfter.templates[0]!;

    expect(transfer).toMatchObject({
      policy: 'keep-appearance',
      sourceKind: 'clipboard',
      templateId: added.id,
      projectId: added.project.id,
      compositionId: added.project.mainCompositionId,
      inheritSettings: false,
      inheritBrandKit: false,
    });
    expect(transfer.settingsDifferences).toEqual(
      expect.arrayContaining([
        { key: 'width', source: 1280, destination: 1920 },
        { key: 'frameRate', source: 25, destination: 50 },
      ]),
    );
    expect(added).toMatchObject({ inheritSettings: false, inheritBrandKit: false });
    expect(projectAfter.compositions[0]).toMatchObject({ width: 1280, frameRate: 25 });
    expect(projectAfter.id).not.toBe(source.id);
    expect(projectAfter.mainCompositionId).not.toBe(source.mainCompositionId);
    expect(projectAfter.authoringPrompts?.at(-1)?.text).toBe(originalPrompt);
    expect(setAfter.templates[1]!.project.description).toBe('An earlier edit');
    expect(sourceDeck).toEqual(frozenSource);
    expect(getHistorySnapshot().past.map(({ label }) => label)).toEqual([
      ...previousHistory.past.map(({ label }) => label),
      'Transfer template',
    ]);

    undo();
    expect(useProjectSetStore.getState().projectSet).toBe(destinationDeck);
    expect(useProjectSetStore.getState().activeTemplateId).toBe(destinationDeck.activeTemplateId);
    expect(useProjectStore.getState().project).toBe(projectBefore);
    expect(getHistorySnapshot().past).toEqual(previousHistory.past);
    redo();
    expect(useProjectSetStore.getState().projectSet).toBe(setAfter);
    expect(useProjectSetStore.getState().activeTemplateId).toBe(transfer.templateId);
    expect(useProjectStore.getState().project).toBe(projectAfter);
  });

  it('keeps an inserted file local and retains that policy when duplicated or pasted within the set', () => {
    const original = makeProject('Backdrop', { width: 1920, frameRate: 50 });
    openSet(original);
    const incoming = makeProject('Imported', { width: 1280, frameRate: 25 });
    const { transfer } = insertTemplateProjectWithReport(incoming);
    expect(transfer).toMatchObject({
      inheritSettings: false,
      inheritBrandKit: false,
      sourceKind: 'resolved-file',
    });
    expect(transfer.projectId).toBe(incoming.id);
    expect(useProjectStore.getState().project.compositions[0]).toMatchObject({
      width: 1280,
      frameRate: 25,
    });
    expect(getHistorySnapshot().past.map(({ label }) => label)).toEqual(['Transfer template']);

    duplicateTemplate(transfer.templateId);
    const duplicate = useProjectSetStore.getState().projectSet!.templates[2]!;
    expect(duplicate).toMatchObject({ inheritSettings: false, inheritBrandKit: false });
    copyTemplate(duplicate.id);
    expect(pasteTemplateWithReport(duplicate.id).transfer).toBeUndefined();
    const pasted = useProjectSetStore.getState().projectSet!.templates[3]!;
    expect(pasted).toMatchObject({ inheritSettings: false, inheritBrandKit: false });
    expect(pasted.project.id).not.toBe(duplicate.project.id);
    expect(pasted.project.mainCompositionId).not.toBe(duplicate.project.mainCompositionId);
  });

  it('rejects both a stale picker and a prepared transfer after an intervening destination edit', () => {
    const destination = makeProject('Destination', { width: 1920, frameRate: 50 });
    const deck = openSet(destination);
    const source = makeProject('Source', { width: 1280, frameRate: 25 });
    const assertPickerDestination = captureTemplateTransferDestination();
    const prepared = prepareTemplateTransfer(deck, source, 'resolved-file');
    useProjectStore.getState().setProjectMeta({ description: 'Edited while reviewing the import' });
    const before = useProjectStore.getState().project;
    const history = getHistorySnapshot();
    const publications: string[] = [];
    const unsubscribeProject = useProjectStore.subscribe(() => publications.push('project'));
    const unsubscribeSet = useProjectSetStore.subscribe(() => publications.push('set'));
    try {
      expect(assertPickerDestination).toThrow('destination document changed');
      expect(() => commitTemplateTransfer(prepared)).toThrow('destination document changed');
    } finally {
      unsubscribeProject();
      unsubscribeSet();
    }
    expect(publications).toEqual([]);
    expect(useProjectStore.getState().project).toBe(before);
    expect(useProjectSetStore.getState().projectSet).toBe(deck);
    expect(getHistorySnapshot()).toEqual(history);
  });

  it('compares output format with the templates used in Transitions', () => {
    const first = makeProject('Standalone member', { width: 1920, frameRate: 50 });
    const lane = makeProject('On-air member', { width: 1280, frameRate: 25 });
    const set = addProjectSetTemplate(openSet(first), lane, lane.name, false);
    const transitionLogic = createDefaultTransitionLogic({
      ...set,
      templates: [set.templates[1]!],
    });
    const coordinated = { ...set, transitionLogic };

    expect(
      prepareTemplateTransfer(coordinated, lane, 'clipboard').result.transfer.warnings,
    ).toEqual([]);
    expect(
      prepareTemplateTransfer(coordinated, first, 'clipboard').result.transfer.warnings,
    ).toEqual([expect.stringContaining('1280 × 1080 at 25 fps')]);
  });

  it('restores the destination and history if activation fails after the project changes', () => {
    const destination = makeProject('Destination', { width: 1920, frameRate: 50 });
    const deck = openSet(destination);
    const composition = useProjectStore.getState().project.compositions[0]!;
    const layer = composition.layers[0]!;
    const field = composition.dataFields[0]!;
    const controller = {
      seek: vi.fn(),
      play: vi.fn(),
      pause: vi.fn(),
      stop: vi.fn(() => {
        throw new Error('The timeline failed to stop.');
      }),
    };
    useTimelineStore.getState().setController(controller);
    useTimelineStore.getState().setCurrentFrame(17);
    useTimelineStore.getState().setPlaying(true);
    useSelectionStore.getState().select(layer.id);
    useLayerClipboardStore.getState().copy([layer]);
    useTestDataStore
      .getState()
      .setValue(field.id, 'Operator text', composition.layers, composition.dataFields);
    const beforeProject = useProjectStore.getState();
    const beforeTimeline = useTimelineStore.getState();
    const beforeSelection = useSelectionStore.getState();
    const beforeData = useTestDataStore.getState();
    const beforeClipboard = useLayerClipboardStore.getState();
    const history = getHistorySnapshot();

    expect(() =>
      insertTemplateProjectWithReport(makeProject('Source', { width: 1280, frameRate: 25 })),
    ).toThrow('The timeline failed to stop.');
    expect(useProjectStore.getState()).toBe(beforeProject);
    expect(useProjectSetStore.getState().projectSet).toBe(deck);
    expect(useProjectSetStore.getState().activeTemplateId).toBe(deck.activeTemplateId);
    expect(useTimelineStore.getState()).toBe(beforeTimeline);
    expect(useSelectionStore.getState()).toBe(beforeSelection);
    expect(useTestDataStore.getState()).toBe(beforeData);
    expect(useLayerClipboardStore.getState()).toBe(beforeClipboard);
    expect(getHistorySnapshot()).toEqual(history);
    expect(controller.seek).toHaveBeenCalledWith(17);
    expect(controller.play).toHaveBeenCalledTimes(1);
  });
});
