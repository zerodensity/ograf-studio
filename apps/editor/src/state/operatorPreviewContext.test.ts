import { describe, expect, it } from 'vitest';
import { transitionLogicErrors, type TransitionLogicDefinition } from '@ograf-editor/scene-model';
import { operatorPreviewContext } from './operatorPreviewContext';

function fixture(): TransitionLogicDefinition {
  return {
    version: 4,
    id: 'signal-blue',
    name: 'Signal Blue',
    slots: [
      { id: 'headline', name: 'Headline', order: 0 },
      { id: 'second-line', name: 'Second line', order: 1, parentSlotId: 'headline' },
      { id: 'ticker', name: 'Ticker', order: 2 },
      { id: 'breaking', name: 'Breaking', order: 3 },
    ],
    states: [
      {
        id: 'headline-main',
        name: 'Headline',
        slotId: 'headline',
        templateId: 'template-headline',
      },
      {
        id: 'headline-alternate',
        name: 'Alternate',
        slotId: 'headline',
        templateId: 'template-headline-alt',
      },
      {
        id: 'second-main',
        name: 'Second line',
        slotId: 'second-line',
        templateId: 'template-second',
      },
      { id: 'ticker-main', name: 'Ticker', slotId: 'ticker', templateId: 'template-ticker' },
      {
        id: 'breaking-main',
        name: 'Breaking',
        slotId: 'breaking',
        templateId: 'template-breaking',
      },
    ],
    transitions: [
      {
        id: 'morph',
        name: 'Morph',
        durationFrames: 20,
        outgoingFrames: 10,
        incomingStartFrame: 10,
        incomingFrames: 10,
        sharedFrames: 20,
        easing: 'linear',
      },
    ],
    routes: [],
    sharedInstances: [],
    initialSharedValues: [],
    defaultTransitionId: 'morph',
    layoutRules: [
      {
        id: 'room',
        name: 'Make room',
        slotId: 'headline',
        whenSlotId: 'second-line',
        sharedOffsets: [],
      },
    ],
  };
}

describe('operator preview context', () => {
  it('keeps the legacy layout context and prefers the currently selected template', () => {
    const definition = fixture();
    definition.version = 3;
    expect(transitionLogicErrors(definition)).toEqual([]);
    const state = definition.states.find((entry) => entry.id === 'second-main')!;
    expect(operatorPreviewContext(definition, state, 'template-headline-alt')).toEqual([
      'headline-alternate',
    ]);
    expect(operatorPreviewContext(definition, state, null)).toEqual(['headline-main']);
  });

  it('does not cold-Take required parent lanes to satisfy an explicit admission guard', () => {
    const definition = fixture();
    definition.slots[1]!.admission = { requireOnSlotIds: ['headline'] };
    expect(transitionLogicErrors(definition)).toEqual([]);
    expect(operatorPreviewContext(definition, definition.states[2]!, 'template-headline')).toEqual(
      [],
    );
  });

  it('does not build implicit context when a blocking lane guard must inspect real output', () => {
    const definition = fixture();
    definition.slots[1]!.admission = { blockWhileActiveSlotIds: ['breaking'] };
    expect(transitionLogicErrors(definition)).toEqual([]);
    expect(operatorPreviewContext(definition, definition.states[2]!, 'template-headline')).toEqual(
      [],
    );
  });

  it('preserves context for empty guards and ignores guards belonging to other lanes', () => {
    const definition = fixture();
    definition.slots[1]!.admission = { requireOnSlotIds: [], blockWhileActiveSlotIds: [] };
    definition.slots[2]!.admission = { requireOnSlotIds: ['headline'] };
    expect(transitionLogicErrors(definition)).toEqual([]);
    expect(
      operatorPreviewContext(definition, definition.states[2]!, 'template-headline-alt'),
    ).toEqual(['headline-alternate']);
  });

  it('deduplicates layout lanes and omits layout targets with no selectable state', () => {
    const definition = fixture();
    definition.layoutRules!.push({
      id: 'also-room',
      name: 'Also room',
      slotId: 'headline',
      whenSlotId: 'second-line',
      sharedOffsets: [],
    });
    definition.states = definition.states.filter((state) => state.slotId !== 'headline');
    expect(
      operatorPreviewContext(
        definition,
        definition.states.find((state) => state.id === 'second-main')!,
        null,
      ),
    ).toEqual([]);
    definition.states.push({
      id: 'headline-new',
      name: 'New',
      slotId: 'headline',
      templateId: 'template-new',
    });
    expect(
      operatorPreviewContext(
        definition,
        definition.states.find((state) => state.id === 'second-main')!,
        null,
      ),
    ).toEqual(['headline-new']);
  });
});
