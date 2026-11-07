import { describe, expect, it } from 'vitest';
import type { TransitionLogicDefinition } from '@ograf-editor/scene-model';
import {
  moveTemplateToLayer,
  removeLayer,
  setTemplateTakeOutSlots,
  templateTakeOutOptions,
} from './transitionChoreography';

function definition(): TransitionLogicDefinition {
  return {
    version: 3,
    id: 'takeover-authoring',
    name: 'Takeover authoring',
    defaultTransitionId: 'fade',
    slots: [
      { id: 'main', name: 'Main', order: 0 },
      { id: 'detail', name: 'Detail', order: 1, parentSlotId: 'main' },
      { id: 'urgent', name: 'Urgent', order: 2 },
      { id: 'ticker', name: 'Ticker', order: 3 },
    ],
    states: [
      { id: 'normal', name: 'Normal', slotId: 'main', templateId: 'normal-template' },
      { id: 'detail-state', name: 'Detail', slotId: 'detail', templateId: 'detail-template' },
      { id: 'breaking', name: 'Breaking', slotId: 'urgent', templateId: 'breaking-template' },
    ],
    transitions: [
      {
        id: 'fade',
        name: 'Fade',
        durationFrames: 12,
        outgoingFrames: 12,
        incomingStartFrame: 0,
        incomingFrames: 12,
        sharedFrames: 12,
        easing: 'linear',
      },
    ],
    routes: [],
    sharedInstances: [],
    initialSharedValues: [],
  };
}

describe('cross-lane takeover authoring', () => {
  it('offers other lanes in drawing order without the incoming lane or its lifetime ancestors', () => {
    const source = definition();
    expect(templateTakeOutOptions(source, 'breaking').map((slot) => slot.id)).toEqual([
      'ticker',
      'detail',
      'main',
    ]);
    expect(templateTakeOutOptions(source, 'detail-state').map((slot) => slot.id)).toEqual([
      'ticker',
      'urgent',
    ]);
    expect(templateTakeOutOptions(source, 'missing')).toEqual([]);
  });

  it('changes one incoming template immutably, deduplicates lane selections and clears empty policy', () => {
    const source = definition();
    const changed = setTemplateTakeOutSlots(source, 'breaking', ['main', 'detail', 'main']);
    expect(changed.states.find((state) => state.id === 'breaking')?.takeOutSlotIds).toEqual([
      'main',
      'detail',
    ]);
    expect(source.states.find((state) => state.id === 'breaking')).not.toHaveProperty(
      'takeOutSlotIds',
    );
    expect(changed.slots).toEqual(source.slots);
    expect(changed.routes).toEqual(source.routes);
    expect(changed.transitions).toEqual(source.transitions);
    expect(changed.states[0]).toEqual(source.states[0]);
    expect(setTemplateTakeOutSlots(changed, 'breaking', []).states[2]).not.toHaveProperty(
      'takeOutSlotIds',
    );
  });

  it('rejects unsafe lane references through shared model validation', () => {
    for (const target of ['missing', 'urgent'])
      expect(() => setTemplateTakeOutSlots(definition(), 'breaking', [target])).toThrow();
    expect(() => setTemplateTakeOutSlots(definition(), 'detail-state', ['main'])).toThrow();
    const first = setTemplateTakeOutSlots(definition(), 'breaking', ['main']);
    const reciprocal = setTemplateTakeOutSlots(first, 'normal', ['urgent']);
    expect(reciprocal.states[0]!.takeOutSlotIds).toEqual(['urgent']);
    expect(reciprocal.states[2]!.takeOutSlotIds).toEqual(['main']);
    expect(() => setTemplateTakeOutSlots(first, 'missing', [])).toThrow('removed');
  });

  it('cleans references when an empty lane is removed while preserving other selected lanes', () => {
    const source = setTemplateTakeOutSlots(definition(), 'breaking', ['main', 'ticker']);
    const removed = removeLayer(source, 'ticker');
    expect(removed.states.find((state) => state.id === 'breaking')?.takeOutSlotIds).toEqual([
      'main',
    ]);
    expect(source.states.find((state) => state.id === 'breaking')?.takeOutSlotIds).toEqual([
      'main',
      'ticker',
    ]);
    const only = setTemplateTakeOutSlots(definition(), 'breaking', ['ticker']);
    expect(removeLayer(only, 'ticker').states[2]).not.toHaveProperty('takeOutSlotIds');
  });

  it('removes the new own-lane reference when moving a template and retains other takeover targets', () => {
    const source = setTemplateTakeOutSlots(definition(), 'breaking', ['ticker', 'main']);
    const moved = moveTemplateToLayer(source, 'breaking', 'ticker');
    expect(moved.states.find((state) => state.id === 'breaking')).toMatchObject({
      slotId: 'ticker',
      takeOutSlotIds: ['main'],
    });
    expect(source.states.find((state) => state.id === 'breaking')?.slotId).toBe('urgent');
    const only = setTemplateTakeOutSlots(definition(), 'breaking', ['ticker']);
    expect(moveTemplateToLayer(only, 'breaking', 'ticker').states[2]).not.toHaveProperty(
      'takeOutSlotIds',
    );
  });
});
