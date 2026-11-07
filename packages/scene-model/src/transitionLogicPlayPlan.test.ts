import { describe, expect, it } from 'vitest';
import {
  createTransitionLogicSession,
  type TransitionLogicDefinition,
  type TransitionLogicSelection,
} from './index';
import {
  planTransitionLogicPlay,
  safeTransitionLogicStartupStates,
} from './transitionLogicPlayPlan';

function news(): TransitionLogicDefinition {
  const ids = ['headline', 'subline', 'header', 'bug', 'locator', 'ticker', 'sidebar', 'alert'];
  return {
    version: 4,
    id: 'signal-blue',
    name: 'Signal Blue',
    defaultTransitionId: 'cut',
    slots: ids.map((id, order) => ({
      id,
      name: id,
      order,
      ...(['subline', 'header'].includes(id)
        ? {
            parentSlotId: 'headline',
            admission: {
              requireOnSlotIds: ['headline'],
              blockWhileActiveSlotIds: ['alert'],
            },
          }
        : {}),
    })),
    states: ids.map((id) => ({
      id: id === 'header' ? 'source' : id,
      name: id,
      slotId: id,
      templateId: `template-${id}`,
      ...(id === 'headline'
        ? { takeOutSlotIds: ['alert'] }
        : id === 'alert'
          ? { takeOutSlotIds: ['headline'] }
          : {}),
    })),
    transitions: [
      {
        id: 'cut',
        name: 'Cut',
        durationFrames: 0,
        outgoingFrames: 0,
        incomingStartFrame: 0,
        incomingFrames: 0,
        sharedFrames: 0,
        easing: 'linear',
      },
    ],
    routes: [],
    sharedInstances: [],
    initialSharedValues: [],
  };
}

const normal = () => ({
  headline: 'headline',
  subline: null,
  header: null,
  bug: 'bug',
  locator: 'locator',
  ticker: 'ticker',
  sidebar: 'sidebar',
  alert: null,
});
const selection = (id: string): TransitionLogicSelection => ({
  requestId: `request-${id}`,
  instanceId: `instance-${id}`,
  stateId: id,
  templateId: `template-${id}`,
  data: {},
});

describe('safe coordinated startup selections', () => {
  it('starts Signal Blue roots compatibly while dependent lanes and the mutually replacing Alert stay Off', () => {
    const definition = news();
    const before = structuredClone(definition);
    expect(safeTransitionLogicStartupStates(definition)).toEqual(normal());
    expect(definition).toEqual(before);
    expect(
      planTransitionLogicPlay(definition, createTransitionLogicSession(definition), normal()),
    ).toEqual({
      valid: true,
      errors: [],
      stages: [
        { outSlotIds: [], takeSlotIds: ['headline', 'bug', 'locator', 'ticker', 'sidebar'] },
      ],
    });
  });

  it('uses explicit lane order and picks the first compatible state, preserving stable array tie order', () => {
    const definition = news();
    definition.slots.reverse();
    definition.slots.push({ id: 'extra', name: 'Extra', order: 9 });
    definition.states.push(
      {
        id: 'extra-conflict',
        name: 'Conflict',
        slotId: 'extra',
        templateId: 'extra',
        takeOutSlotIds: ['headline'],
      },
      { id: 'extra-compatible', name: 'Compatible', slotId: 'extra', templateId: 'extra' },
    );
    expect(safeTransitionLogicStartupStates(definition)).toEqual({
      ...normal(),
      extra: 'extra-compatible',
    });
    definition.slots.find((slot) => slot.id === 'headline')!.order = 7;
    expect(safeTransitionLogicStartupStates(definition)).toMatchObject({
      alert: 'alert',
      headline: null,
    });
  });

  it('honors blockers in either direction and lifecycle cascades of takeover targets', () => {
    const definition = news();
    definition.slots.find((slot) => slot.id === 'bug')!.admission = {
      blockWhileActiveSlotIds: ['locator'],
    };
    definition.slots.find((slot) => slot.id === 'ticker')!.parentSlotId = 'alert';
    expect(safeTransitionLogicStartupStates(definition)).toEqual({
      ...normal(),
      locator: null,
      ticker: null,
    });
  });
});

describe('atomic coordinated Play planning', () => {
  it('stages cold-start prerequisite chains while compatible independent lanes enter concurrently', () => {
    const definition = news();
    const session = createTransitionLogicSession(definition);
    const requested = { ...normal(), subline: 'subline', header: 'source' };
    const before = structuredClone({ definition, session, requested });
    expect(planTransitionLogicPlay(definition, session, requested)).toEqual({
      valid: true,
      errors: [],
      stages: [
        { outSlotIds: [], takeSlotIds: ['headline', 'bug', 'locator', 'ticker', 'sidebar'] },
        { outSlotIds: [], takeSlotIds: ['subline', 'header'] },
      ],
    });
    expect({ definition, session, requested }).toEqual(before);
    expect(planTransitionLogicPlay(definition, session, requested)).toEqual(
      planTransitionLogicPlay(definition, session, requested),
    );
  });

  it('rejects a missing required parent and all mutually conflicting final selections before any stages exist', () => {
    const definition = news();
    const session = createTransitionLogicSession(definition);
    const missing = planTransitionLogicPlay(definition, session, {
      ...normal(),
      headline: null,
      subline: 'subline',
    });
    expect(missing).toMatchObject({ valid: false, stages: [] });
    expect(missing.errors.join(' ')).toMatch(/required lane "headline"/);
    const conflict = planTransitionLogicPlay(definition, session, {
      ...normal(),
      alert: 'alert',
      subline: 'subline',
      header: 'source',
    });
    expect(conflict).toMatchObject({ valid: false, stages: [] });
    expect(conflict.errors.join(' ')).toMatch(/blocking lane "alert"/);
    expect(conflict.errors.join(' ')).toMatch(/takes lane "subline" Out/);
    expect(conflict.errors.join(' ')).toMatch(/takes lane "alert" Out/);
  });

  it('puts occupied and queued blockers through an Out barrier before parent/child Takes', () => {
    const definition = news();
    for (const queued of [false, true]) {
      const session = createTransitionLogicSession(definition);
      const alert = selection('alert');
      if (queued)
        session.slots.alert!.pending = {
          request: { requestId: alert.requestId, slotId: 'alert', stateId: 'alert' },
          selection: alert,
          ready: false,
        };
      else session.slots.alert!.settled = alert;
      const result = planTransitionLogicPlay(definition, session, {
        ...normal(),
        subline: 'subline',
        header: 'source',
      });
      expect(result).toEqual({
        valid: true,
        errors: [],
        stages: [
          { outSlotIds: ['alert'], takeSlotIds: [] },
          { outSlotIds: [], takeSlotIds: ['headline', 'bug', 'locator', 'ticker', 'sidebar'] },
          { outSlotIds: [], takeSlotIds: ['subline', 'header'] },
        ],
      });
    }
  });

  it('does not ignore queued intent when a partial request omits its lane', () => {
    const definition = news();
    const session = createTransitionLogicSession(definition);
    const alert = selection('alert');
    session.slots.alert!.desired = alert;
    session.slots.alert!.pending = {
      request: { requestId: alert.requestId, slotId: 'alert', stateId: 'alert' },
      selection: alert,
      ready: false,
    };
    expect(
      planTransitionLogicPlay(definition, session, { headline: 'headline', header: 'source' }),
    ).toMatchObject({ valid: false, stages: [] });
    expect(
      planTransitionLogicPlay(definition, session, {
        headline: 'headline',
        header: 'source',
        alert: null,
      }),
    ).toMatchObject({ valid: true });
  });

  it('requires explicit Off to cancel a prepared blocker and preserves unrelated omitted preparation', () => {
    const definition = news();
    const session = createTransitionLogicSession(definition);
    const requested = { headline: 'headline', header: 'source' };
    const rejected = planTransitionLogicPlay(definition, session, requested, ['alert']);
    expect(rejected).toMatchObject({ valid: false, stages: [] });
    expect(rejected.errors.join(' ')).toMatch(/prepared|preparation/);
    expect(
      planTransitionLogicPlay(definition, session, { ...requested, alert: null }, ['alert']),
    ).toEqual({
      valid: true,
      errors: [],
      stages: [
        { outSlotIds: ['alert'], takeSlotIds: [] },
        { outSlotIds: [], takeSlotIds: ['headline'] },
        { outSlotIds: [], takeSlotIds: ['header'] },
      ],
    });
    expect(planTransitionLogicPlay(definition, session, { headline: 'headline' }, ['bug'])).toEqual(
      { valid: true, errors: [], stages: [{ outSlotIds: [], takeSlotIds: ['headline'] }] },
    );
  });

  it('waits for the parent Out cascade once, instead of racing duplicate child Out requests', () => {
    const definition = news();
    const session = createTransitionLogicSession(definition);
    session.slots.headline!.settled = selection('headline');
    session.slots.subline!.settled = selection('subline');
    session.slots.header!.settled = { ...selection('source'), templateId: 'template-header' };
    expect(
      planTransitionLogicPlay(definition, session, { ...normal(), headline: null, alert: 'alert' }),
    ).toEqual({
      valid: true,
      errors: [],
      stages: [
        { outSlotIds: ['headline'], takeSlotIds: [] },
        { outSlotIds: [], takeSlotIds: ['bug', 'locator', 'ticker', 'sidebar', 'alert'] },
      ],
    });
  });

  it('accepts already settled parents and rejects a queued parent Out even if it is still visible', () => {
    const definition = news();
    const session = createTransitionLogicSession(definition);
    session.slots.headline!.settled = selection('headline');
    expect(planTransitionLogicPlay(definition, session, { header: 'source' })).toMatchObject({
      valid: true,
    });
    session.slots.headline!.pending = {
      request: { requestId: 'out', slotId: 'headline', stateId: null },
      selection: null,
      ready: true,
    };
    expect(planTransitionLogicPlay(definition, session, { header: 'source' })).toMatchObject({
      valid: false,
      stages: [],
    });
  });

  it('does not turn lifecycle parenting into implicit Take admission', () => {
    const definition = news();
    delete definition.slots.find((slot) => slot.id === 'header')!.admission;
    const session = createTransitionLogicSession(definition);
    session.slots.headline!.settled = selection('headline');
    session.slots.header!.settled = { ...selection('source'), templateId: 'template-header' };
    const result = planTransitionLogicPlay(definition, session, {
      ...normal(),
      headline: null,
      header: 'source',
    });
    expect(result).toEqual({
      valid: true,
      errors: [],
      stages: [
        { outSlotIds: ['headline'], takeSlotIds: [] },
        { outSlotIds: [], takeSlotIds: ['header', 'bug', 'locator', 'ticker', 'sidebar'] },
      ],
    });
  });

  it('rejects prerequisite cycles, invalid state/lane ownership and a foreign session atomically', () => {
    const definition = news();
    const session = createTransitionLogicSession(definition);
    expect(planTransitionLogicPlay(definition, session, { header: 'headline' })).toMatchObject({
      valid: false,
      stages: [],
    });
    expect(planTransitionLogicPlay(definition, session, { missing: 'headline' })).toMatchObject({
      valid: false,
      stages: [],
    });
    expect(
      planTransitionLogicPlay(definition, { ...session, definitionId: 'other' }, normal()),
    ).toMatchObject({ valid: false, stages: [] });
    definition.slots.find((slot) => slot.id === 'headline')!.admission = {
      requireOnSlotIds: ['subline'],
    };
    const cycle = planTransitionLogicPlay(definition, session, { ...normal(), subline: 'subline' });
    expect(cycle).toMatchObject({ valid: false, stages: [] });
    expect(cycle.errors.join(' ')).toMatch(/cyclic|cycle/);
  });
});
