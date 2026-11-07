import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createComposition,
  createFieldDefinition,
  createProject,
  type FieldDefinition,
} from '@ograf-editor/scene-model';
import type { PlayoutControlsSession } from '../state/playoutControlsStore';
import { useBehaviorPreviewStore } from '../state/behaviorPreviewStore';
import { addProjectSetTemplate, createProjectSet } from '../state/projectSet';
import { createDefaultTransitionLogic } from '../state/transitionLogicEditing';
import { useTransitionLogicDraftStore } from '../state/transitionLogicDraftStore';
import {
  previewSlotSelectionKey,
  setPreviewSlotSelection,
  usePreviewSlotSelectionStore,
} from '../state/previewSlotSelectionStore';
import { PreviewPlayoutControls } from './PreviewPlayoutControls';

// Read current operator stores in server markup, as the browser does. Zustand's
// default SSR snapshot intentionally uses each store's original initial state.
vi.mock('../state/behaviorPreviewStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../state/behaviorPreviewStore')>();
  const store = actual.useBehaviorPreviewStore;
  return {
    ...actual,
    useBehaviorPreviewStore: Object.assign(
      (selector?: (state: ReturnType<typeof store.getState>) => unknown) =>
        selector ? selector(store.getState()) : store.getState(),
      store,
    ),
  };
});
vi.mock('../state/transitionLogicDraftStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../state/transitionLogicDraftStore')>();
  const store = actual.useTransitionLogicDraftStore;
  return {
    ...actual,
    useTransitionLogicDraftStore: Object.assign(
      (selector: (state: ReturnType<typeof store.getState>) => unknown) =>
        selector(store.getState()),
      store,
    ),
  };
});
vi.mock('../state/previewSlotSelectionStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../state/previewSlotSelectionStore')>();
  const store = actual.usePreviewSlotSelectionStore;
  return {
    ...actual,
    usePreviewSlotSelectionStore: Object.assign(
      (selector: (state: ReturnType<typeof store.getState>) => unknown) =>
        selector(store.getState()),
      store,
    ),
  };
});
vi.mock('./PreviewDataFields', () => ({
  PreviewDataFields: ({
    fields,
    values,
  }: {
    fields: FieldDefinition[];
    values: Record<string, unknown>;
  }) =>
    createElement(
      'div',
      { className: 'preview-data-form' },
      fields.map((field) =>
        createElement(
          'span',
          { key: field.id, 'data-field': field.key },
          String(values[field.key]),
        ),
      ),
    ),
}));
vi.mock('./PreviewBackgroundControls', () => ({
  PreviewBackgroundControls: () => 'background controls',
}));
vi.mock('./TickerPendingUpdates', () => ({ TickerPendingUpdates: () => null }));
vi.mock('./EditorPreviewControls', () => ({ EditorPreviewControls: () => null }));

function session(overrides: Partial<PlayoutControlsSession> = {}): PlayoutControlsSession {
  return {
    templateName: 'Name',
    templateIndex: 0,
    templateCount: 1,
    currentStep: undefined,
    stepCount: 1,
    ready: true,
    loading: false,
    error: '',
    behaviorActive: false,
    behaviorLabel: 'Preview',
    projectSet: null,
    activeTemplateId: null,
    dataTemplateId: null,
    dataTemplateName: 'Name',
    data: { name: 'EDITOR NAME' },
    fields: [createFieldDefinition('text', { key: 'name' })],
    values: { name: 'EDITOR NAME' },
    customActions: [{ id: 'flash', name: 'Editor-only action' }],
    changeTemplate: vi.fn(),
    play: vi.fn(),
    out: vi.fn(),
    customAction: vi.fn(),
    updateData: vi.fn(),
    navigate: vi.fn(),
    canNavigate: () => true,
    ...overrides,
  };
}

function coordinatedSession() {
  const template = (key: string, name: string) => {
    const composition = createComposition({
      dataFields: [createFieldDefinition('text', { key, defaultValue: `SAVED ${name}` })],
    });
    return createProject({ name, mainCompositionId: composition.id, compositions: [composition] });
  };
  const source = addProjectSetTemplate(
    createProjectSet('News', template('name', 'Name')),
    template('headline', 'Headline'),
  );
  source.transitionLogic = createDefaultTransitionLogic(source);
  const activeTemplateId = source.templates[0]!.id;
  return session({
    projectSet: source,
    templateCount: 2,
    activeTemplateId,
    dataTemplateId: activeTemplateId,
  });
}

const render = (value: PlayoutControlsSession) =>
  renderToStaticMarkup(createElement(PreviewPlayoutControls, { session: value }));

describe('preview playout fields shared by popup and docked controls', () => {
  beforeEach(() => {
    useBehaviorPreviewStore.setState(useBehaviorPreviewStore.getInitialState(), true);
    useTransitionLogicDraftStore.setState({ drafts: {} });
    usePreviewSlotSelectionStore.setState({ choices: {} });
  });

  it('retains standalone template fields, custom actions and background controls', () => {
    const markup = render(session());
    expect(markup).toContain('EDITOR NAME');
    expect(markup).toContain('Editor-only action');
    expect(markup).toContain('background controls');
    expect(markup).not.toContain('Playout transitions');
  });

  it('retains standalone fields for a set without applied transitions', () => {
    const value = coordinatedSession();
    delete value.projectSet!.transitionLogic;
    const markup = render(value);
    expect(markup).toContain('EDITOR NAME');
    expect(markup).toContain('Editor-only action');
    expect(markup).not.toContain('Playout transitions');
  });

  it('renders the selected lane fields only once while Ready and off air', () => {
    const markup = render(coordinatedSession());
    expect(markup).toContain('Data · Name');
    expect(markup).toContain('Next');
    expect(markup.match(/data-field="name"/g)).toHaveLength(1);
    expect(markup).toContain('SAVED Name');
    expect(markup).not.toContain('EDITOR NAME');
    expect(markup).not.toContain('Editor-only action');
    expect(markup).not.toContain('Current template');
    expect(markup).toContain('background controls');
    expect(markup).toContain('Take In ▶');
    expect(markup).toContain('Take Out');
  });

  it('does not leak editor template fields when another lane template is selected', () => {
    const value = coordinatedSession();
    const source = value.projectSet!;
    const definition = source.transitionLogic!;
    setPreviewSlotSelection(
      previewSlotSelectionKey(
        source.id,
        definition.id,
        value.activeTemplateId,
        definition.slots[0]!.id,
      ),
      definition.states[1]!.id,
    );
    const markup = render(value);
    expect(markup).toContain('Data · Headline');
    expect(markup.match(/data-field="headline"/g)).toHaveLength(1);
    expect(markup).not.toContain('data-field="name"');
    expect(markup).not.toContain('EDITOR NAME');
    expect(markup).not.toContain('Editor-only action');
  });

  it('uses the lane form for an unapplied transition draft before the first Take', () => {
    const value = coordinatedSession();
    const source = value.projectSet!;
    const definition = source.transitionLogic!;
    delete source.transitionLogic;
    useTransitionLogicDraftStore.getState().sync(source.id, null);
    useTransitionLogicDraftStore.getState().replace(source.id, definition);
    const markup = render(value);
    expect(markup).toContain('Playout transitions');
    expect(markup).toContain('Data · Name');
    expect(markup.match(/data-field="name"/g)).toHaveLength(1);
    expect(markup).not.toContain('EDITOR NAME');
  });

  it('restores standalone fields if the draft removes transitions and no session is running', () => {
    const value = coordinatedSession();
    const source = value.projectSet!;
    useTransitionLogicDraftStore.getState().sync(source.id, source.transitionLogic);
    useTransitionLogicDraftStore.getState().replace(source.id, null);
    const markup = render(value);
    expect(markup).not.toContain('Playout transitions');
    expect(markup).toContain('EDITOR NAME');
    expect(markup).toContain('Editor-only action');
  });

  it('retains running lane ownership after its authored definition is removed', () => {
    const value = coordinatedSession();
    const source = value.projectSet!;
    const definition = source.transitionLogic!;
    delete source.transitionLogic;
    useBehaviorPreviewStore.setState({ requestId: 'preview', sourceSetId: source.id, definition });
    const markup = render(value);
    expect(markup).toContain('Playout transitions');
    expect(markup).not.toContain('EDITOR NAME');
    expect(markup).not.toContain('Editor-only action');
    expect(markup).not.toContain('This template has no exposed data fields.');
  });

  it('keeps editor-synchronized fields even when the set has transitions', () => {
    const markup = render({
      ...coordinatedSession(),
      editorSynchronized: true,
      behaviorActive: true,
    });
    expect(markup).not.toContain('Playout transitions');
    expect(markup).toContain('EDITOR NAME');
    expect(markup).toContain('background controls');
  });

  it('shows the empty-fields note for standalone previews, not for a selected lane', () => {
    expect(render(session({ fields: [] }))).toContain('This template has no exposed data fields.');
    const value = coordinatedSession();
    value.projectSet!.templates[0]!.project.compositions[0]!.dataFields = [];
    value.fields = [];
    const markup = render(value);
    expect(markup).toContain('Playout transitions');
    expect(markup).not.toContain('This template has no exposed data fields.');
    expect(markup).not.toContain('Editor-only action');
  });
});
