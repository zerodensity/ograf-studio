import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoordinatedPlayoutSlot } from '@ograf-editor/ograf-types';
import { createTransitionLogicNewsExample } from '../examples/transitionLogicNews';
import { previewSlotDataKey, usePreviewSlotDataStore } from '../state/previewSlotDataStore';
import { stageSharedPreviewSlotField } from '../state/playoutControlsStore';
import { PreviewTransitionLogicControls, SlotControls } from './PreviewTransitionLogicControls';

const dataForms = (markup: string) =>
  [...markup.matchAll(/<details class="preview-slot-data"([^>]*)><summary>(.*?)<\/summary>/g)].map(
    ([, attributes, summary]) => ({
      open: attributes!.includes('open=""'),
      summary: summary!.replace(/<[^>]+>/g, '').trim(),
    }),
  );

const fixture = vi.hoisted(() => ({ choice: '' }));
vi.mock('../state/previewSlotSelectionStore', () => ({
  usePreviewSlotSelectionStore: (
    selector: (state: { choices: Record<string, string> }) => unknown,
  ) => selector({ choices: { selection: fixture.choice, ticker: fixture.choice } }),
  setPreviewSlotSelection: vi.fn(),
  previewSlotSelectionKey: (...parts: unknown[]) => JSON.stringify(parts),
}));
vi.mock('../state/previewSlotDataStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../state/previewSlotDataStore')>();
  // Static markup normally reads Zustand's initial SSR snapshot; use the test's current
  // operator drafts so these assertions exercise the same values as the browser view.
  const store = actual.usePreviewSlotDataStore;
  return {
    ...actual,
    usePreviewSlotDataStore: Object.assign(
      (selector: (state: ReturnType<typeof store.getState>) => unknown) =>
        selector(store.getState()),
      store,
    ),
  };
});
vi.mock('../components/PropertyRow', async () => {
  const { createElement } = await import('react');
  return {
    PropertyRow: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  };
});
vi.mock('../components/ColorInput', async () => {
  const { createElement } = await import('react');
  return {
    ColorInput: ({ label }: { label: string }) => createElement('input', { 'aria-label': label }),
  };
});

describe('coordinated preview lane data controls', () => {
  beforeEach(() => {
    fixture.choice = '';
    usePreviewSlotDataStore.setState({ drafts: {}, observed: {} });
  });

  it('shows only the selected graphic data when another graphic is on air', () => {
    const source = createTransitionLogicNewsExample(0);
    const definition = source.transitionLogic!;
    const slot = definition.slots.find((item) => item.id === 'lower-third')!;
    const states = definition.states.filter((state) => state.slotId === slot.id);
    const selectionKey = 'selection';
    fixture.choice = 'headline';
    const status: CoordinatedPlayoutSlot = {
      slotId: slot.id,
      name: slot.name,
      current: {
        requestId: 'request',
        instanceId: 'instance',
        stateId: 'name',
        templateId: 'news-template-name',
        data: { name: 'ON AIR CORRESPONDENT', role: 'REPORTER' },
      },
      desired: null,
      outgoing: null,
      incoming: null,
      pending: null,
      readiness: 'ready',
      error: null,
      transition: null,
    };
    const markup = renderToStaticMarkup(
      createElement(SlotControls, {
        selectionKey,
        source,
        definition,
        slot,
        states,
        status,
        activeTemplateId: null,
        requestedStateId: null,
        disabled: false,
        fieldsDisabled: false,
        onTake: vi.fn(),
        onOut: vi.fn(),
        customActions: [],
        onCustomAction: vi.fn(),
        action: vi.fn(),
      }),
    );
    expect(markup).not.toContain('Data · Correspondent');
    expect(markup).toContain('Data · Headline');
    expect(markup).toContain('Next');
    expect(markup).not.toContain('ON AIR CORRESPONDENT');
    expect(markup).toContain('Headline');
    expect(dataForms(markup)).toEqual([{ open: true, summary: 'Data · Headline Next' }]);
  });

  it('offers the next graphic data while a lane is off air', () => {
    const source = createTransitionLogicNewsExample(0);
    const definition = source.transitionLogic!;
    const slot = definition.slots.find((item) => item.id === 'ticker')!;
    const states = definition.states.filter((state) => state.slotId === slot.id);
    const markup = renderToStaticMarkup(
      createElement(SlotControls, {
        selectionKey: 'ticker',
        source,
        definition,
        slot,
        states,
        activeTemplateId: null,
        requestedStateId: null,
        disabled: false,
        fieldsDisabled: false,
        onTake: vi.fn(),
        onOut: vi.fn(),
        customActions: [],
        onCustomAction: vi.fn(),
        action: vi.fn(),
      }),
    );
    expect(markup).toContain('Data · Ticker');
    expect(markup).toContain('Next');
    expect(markup).toContain('Ticker');
    expect(markup).toContain('<fieldset class="preview-slot-data-fields">');
    expect(dataForms(markup)).toEqual([{ open: true, summary: 'Data · Ticker Next' }]);
  });

  it('uses the native lane controls and public staged data for shared live playout', () => {
    const source = createTransitionLogicNewsExample(0);
    const definition = source.transitionLogic!;
    const state = definition.states.find((item) => item.id === 'name')!;
    const template = source.templates.find((item) => item.id === state.templateId)!;
    const composition = template.project.compositions.find(
      (item) => item.id === template.project.mainCompositionId,
    )!;
    composition.dataFields.find((field) => field.key === 'role')!.exposeToOgraf = false;
    const privateKey = previewSlotDataKey(
      source.id,
      definition.id,
      state.slotId,
      state.id,
      state.templateId,
    );
    usePreviewSlotDataStore.setState({
      observed: { [privateKey]: { name: 'PRIVATE REHEARSAL NAME', role: 'PRIVATE ROLE' } },
    });
    const sendAction = vi.fn();
    const render = () =>
      renderToStaticMarkup(
        createElement(PreviewTransitionLogicControls, {
          projectSet: source,
          activeTemplateId: template.id,
          dataTemplateId: template.id,
          data: {},
          shared: { source, snapshot: null, ready: false, sendAction },
        }),
      );
    const initial = render();
    expect(initial).toContain('Playout transitions');
    expect(initial).toContain('Clear all');
    expect(initial).toContain('Data · Correspondent');
    expect(initial).not.toContain('PRIVATE REHEARSAL NAME');
    expect(initial.split('</details>', 1)[0]).not.toContain('aria-label="Role"');
    stageSharedPreviewSlotField(source, definition, state, 'name', 'STAGED SHARED NAME');
    expect(render()).toContain('STAGED SHARED NAME');
    expect(sendAction).not.toHaveBeenCalled();
  });

  it('changes the selected form without taking output or losing another state draft', () => {
    const source = createTransitionLogicNewsExample(0);
    const definition = source.transitionLogic!;
    const slot = definition.slots.find((item) => item.id === 'lower-third')!;
    const states = definition.states.filter((state) => state.slotId === slot.id);
    const headline = states.find((state) => state.id === 'headline')!;
    const draftKey = previewSlotDataKey(
      source.id,
      definition.id,
      slot.id,
      headline.id,
      headline.templateId,
    );
    usePreviewSlotDataStore.setState({ drafts: { [draftKey]: { headline: 'STAGED HEADLINE' } } });
    const drafts = structuredClone(usePreviewSlotDataStore.getState().drafts);
    const callbacks = {
      onTake: vi.fn(),
      onOut: vi.fn(),
      onCustomAction: vi.fn(),
      action: vi.fn(),
    };
    const status: CoordinatedPlayoutSlot = {
      slotId: slot.id,
      name: slot.name,
      current: {
        requestId: 'request',
        instanceId: 'instance',
        stateId: 'name',
        templateId: 'news-template-name',
        data: { name: 'ON AIR NAME', role: 'REPORTER' },
      },
      desired: null,
      outgoing: null,
      incoming: null,
      pending: null,
      readiness: 'ready',
      error: null,
      transition: null,
    };
    const render = () =>
      renderToStaticMarkup(
        createElement(SlotControls, {
          selectionKey: 'selection',
          source,
          definition,
          slot,
          states,
          status,
          activeTemplateId: null,
          requestedStateId: null,
          disabled: false,
          fieldsDisabled: false,
          customActions: [{ id: 'current.action', name: 'On-air graphic action' }],
          ...callbacks,
        }),
      );
    fixture.choice = 'headline';
    const next = render();
    expect(next).toContain('STAGED HEADLINE');
    expect(next).not.toContain('On-air graphic action');
    expect(dataForms(next)).toHaveLength(1);
    fixture.choice = 'name';
    const onAir = render();
    expect(dataForms(onAir)).toEqual([{ open: true, summary: 'Data · Correspondent On air' }]);
    expect(onAir).toContain('ON AIR NAME');
    expect(onAir).toContain('On-air graphic action');
    fixture.choice = 'headline';
    const selectedAgain = render();
    expect(selectedAgain).toContain('STAGED HEADLINE');
    expect(selectedAgain).not.toContain('ON AIR NAME');
    expect(selectedAgain).not.toContain('On-air graphic action');
    expect(usePreviewSlotDataStore.getState().drafts).toEqual(drafts);
    for (const callback of Object.values(callbacks)) expect(callback).not.toHaveBeenCalled();
  });

  it('disables lane data while a take or preparation is busy', () => {
    const source = createTransitionLogicNewsExample(0);
    const definition = source.transitionLogic!;
    const slot = definition.slots.find((item) => item.id === 'ticker')!;
    const states = definition.states.filter((state) => state.slotId === slot.id);
    const markup = renderToStaticMarkup(
      createElement(SlotControls, {
        selectionKey: 'ticker',
        source,
        definition,
        slot,
        states,
        activeTemplateId: null,
        requestedStateId: null,
        disabled: true,
        fieldsDisabled: true,
        onTake: vi.fn(),
        onOut: vi.fn(),
        customActions: [],
        onCustomAction: vi.fn(),
        action: vi.fn(),
      }),
    );
    expect(markup).toContain('<fieldset class="preview-slot-data-fields" disabled=""');
  });

  it('keeps data editable during a field-only update while take controls are busy', () => {
    const source = createTransitionLogicNewsExample(0);
    const definition = source.transitionLogic!;
    const slot = definition.slots.find((item) => item.id === 'ticker')!;
    const states = definition.states.filter((state) => state.slotId === slot.id);
    const markup = renderToStaticMarkup(
      createElement(SlotControls, {
        selectionKey: 'ticker',
        source,
        definition,
        slot,
        states,
        activeTemplateId: null,
        requestedStateId: null,
        disabled: true,
        fieldsDisabled: false,
        onTake: vi.fn(),
        onOut: vi.fn(),
        customActions: [],
        onCustomAction: vi.fn(),
        action: vi.fn(),
      }),
    );
    expect(markup).toContain('<fieldset class="preview-slot-data-fields">');
    expect(markup).toContain('aria-label="Take Ticker" disabled=""');
  });
});
