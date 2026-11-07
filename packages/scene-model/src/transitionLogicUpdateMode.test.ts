import { describe, expect, it } from 'vitest';
import {
  TRANSITION_LOGIC_VERSION,
  transitionLogicErrors,
  type TransitionLogicDefinition,
} from './transitionLogic';
import { transitionLogicUpdateRecipe } from './transitionLogicPlanner';

function definition(
  version: number,
  updateMode?: unknown,
): TransitionLogicDefinition & { version: never } {
  return {
    version,
    id: 'lanes',
    name: 'Lanes',
    defaultTransitionId: 'fade',
    slots: [
      { id: 'main', name: 'Main', order: 0, ...(updateMode === undefined ? {} : { updateMode }) },
    ],
    states: [{ id: 'headline', name: 'Headline', slotId: 'main', templateId: 'headline' }],
    transitions: [
      {
        id: 'fade',
        name: 'Fade',
        durationFrames: 10,
        outgoingFrames: 10,
        incomingStartFrame: 0,
        incomingFrames: 10,
        sharedFrames: 10,
        easing: 'linear',
      },
      {
        id: 'quick',
        name: 'Quick',
        durationFrames: 4,
        outgoingFrames: 4,
        incomingStartFrame: 0,
        incomingFrames: 4,
        sharedFrames: 4,
        easing: 'linear',
      },
    ],
    routes: [
      {
        id: 'self',
        slotId: 'main',
        from: 'headline',
        to: 'headline',
        transitionId: 'quick',
        priority: 0,
      },
    ],
    sharedInstances: [],
    initialSharedValues: [],
  } as unknown as TransitionLogicDefinition & { version: never };
}

describe('the lane update mode', () => {
  it('accepts the current version with either mode, and no mode at all', () => {
    expect(TRANSITION_LOGIC_VERSION).toBe(6);
    expect(transitionLogicErrors(definition(6))).toEqual([]);
    expect(transitionLogicErrors(definition(6, 'transition'))).toEqual([]);
    expect(transitionLogicErrors(definition(6, 'in-place'))).toEqual([]);
  });

  it('still reads every older version that does not use it', () => {
    for (const version of [1, 2, 3, 4, 5])
      expect(transitionLogicErrors(definition(version))).toEqual([]);
  });

  it('needs version 6, because an older runtime would ignore it', () => {
    for (const version of [1, 5])
      expect(transitionLogicErrors(definition(version, 'in-place'))).toContain(
        'Slot main updateMode requires Transition Logic version 6.',
      );
  });

  it('rejects a mode it does not know', () => {
    expect(transitionLogicErrors(definition(6, 'instant'))).toContain(
      'Slot main has an unsupported updateMode.',
    );
  });

  it('finds the recipe an update on this selection would have used', () => {
    const selection = {
      stateId: 'headline',
      templateId: 'headline',
      requestId: 'one',
      instanceId: 'one',
      data: {},
    };
    expect(transitionLogicUpdateRecipe(definition(6), 'main', selection).id).toBe('quick');
    const noRoute = definition(6);
    noRoute.routes = [];
    expect(transitionLogicUpdateRecipe(noRoute, 'main', selection).id).toBe('fade');
  });
});
