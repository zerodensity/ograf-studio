import { describe, expect, it } from 'vitest';
import {
  transitionLogicAdmissionError,
  transitionLogicErrors,
  type TransitionLogicDefinition,
} from './transitionLogic';
import {
  createTransitionLogicSession,
  reduceTransitionLogic,
  sampleTransitionLogic,
} from './transitionLogicPlanner';
function definition(): TransitionLogicDefinition {
  return {
    version: 4,
    id: 'admission',
    name: 'Admission',
    defaultTransitionId: 'fade',
    slots: ['headline', 'header', 'subline', 'alert', 'bug', 'ticker'].map((id, order) => ({
      id,
      name: id,
      order,
      ...(['header', 'subline'].includes(id)
        ? {
            parentSlotId: 'headline',
            admission: { requireOnSlotIds: ['headline'], blockWhileActiveSlotIds: ['alert'] },
          }
        : {}),
    })),
    states: ['headline', 'header', 'subline', 'alert', 'bug', 'ticker'].map((id) => ({
      id,
      name: id,
      slotId: id,
      templateId: id,
      ...(id === 'alert' ? { takeOutSlotIds: ['headline'] } : {}),
    })),
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
    ],
    routes: [],
    sharedInstances: [],
    initialSharedValues: [],
  };
}
function harness(def = definition()) {
  let session = createTransitionLogicSession(def),
    n = 0;
  const event = (input: Parameters<typeof reduceTransitionLogic>[2]) => {
    const result = reduceTransitionLogic(def, session, input);
    session = result.session;
    return result.effects;
  };
  const request = (slotId: string, stateId: string | null, ready = true) => {
    const requestId = `r-${++n}`;
    event({ type: 'request', frame: session.frame, slotId, stateId, requestId });
    if (stateId && ready) event({ type: 'ready', frame: session.frame, slotId, requestId });
    return requestId;
  };
  const advance = (frames = 10) => event({ type: 'advance', frame: session.frame + frames });
  return {
    def,
    event,
    request,
    advance,
    get session() {
      return session;
    },
  };
}
describe('explicit Take admission', () => {
  it.each([1, 2, 3] as const)(
    'requires version 4 for guards and state presets instead of exposing them as legacy version %i',
    (version) => {
      const guarded = definition();
      guarded.version = version;
      expect(transitionLogicErrors(guarded).join(' ')).toMatch(
        /admission requires Transition Logic version 4/,
      );
      for (const slot of guarded.slots) delete slot.admission;
      guarded.states[0]!.dataDefaults = { label: 'Preset' };
      expect(transitionLogicErrors(guarded).join(' ')).toMatch(
        /defaults require Transition Logic version 4/,
      );
      delete guarded.states[0]!.dataDefaults;
      expect(transitionLogicErrors(guarded)).toEqual([]);
    },
  );
  it.each([3, 4] as const)('preserves layout phases in graph version %i', (version) => {
    const def = definition();
    for (const slot of def.slots) delete slot.admission;
    def.version = version;
    def.transitions[0]!.layoutPhase = { startFrame: 0, durationFrames: 10 };
    expect(transitionLogicErrors(def)).toEqual([]);
  });
  it('rechecks a ready Take waiting behind an earlier transition at its actual entry frame', () => {
    const h = harness();
    h.request('headline', 'headline');
    h.advance();
    h.request('header', 'header');
    const queued = h.request('header', 'header');
    h.request('alert', 'alert', false);
    const effects = h.advance();
    expect(effects).toContainEqual({
      type: 'rejected',
      slotId: 'header',
      requestId: queued,
      message: expect.stringMatching(/alert must be fully Off/),
    });
    expect(h.session.slots.header).toMatchObject({ pending: null, readiness: 'failed' });
  });
  it('fails a previously valid pending preparation if a blocker arrives before ready', () => {
    const h = harness();
    h.request('headline', 'headline');
    h.advance();
    const child = h.request('header', 'header', false);
    h.request('alert', 'alert', false);
    h.event({ type: 'ready', frame: h.session.frame, slotId: 'header', requestId: child });
    expect(h.session.slots.header).toMatchObject({
      desired: null,
      settled: null,
      pending: null,
      transition: null,
      readiness: 'failed',
      error: expect.stringMatching(/alert must be fully Off/),
    });
    h.event({ type: 'clear', frame: h.session.frame, slotId: 'alert' });
    h.advance();
    expect(h.session.slots.header!.settled).toBeNull();
  });
  it('rejects orphan Takes before any session mutation and never revives them later', () => {
    const h = harness();
    const before = structuredClone(h.session);
    for (const id of ['header', 'subline'])
      expect(() => h.request(id, id)).toThrow(/headline must be On/);
    expect(h.session).toEqual(before);
    h.request('headline', 'headline');
    expect(() => h.request('header', 'header')).toThrow(/finished entering/);
    h.advance();
    expect(h.session.slots.header!.pending).toBeNull();
    expect(h.session.slots.subline!.settled).toBeNull();
    h.request('header', 'header');
    h.advance();
    expect(h.session.slots.header!.settled?.stateId).toBe('header');
  });
  it('blocks Breaking prepare, enter, On and exit, preserving occupancy and independent lanes', () => {
    const h = harness();
    for (const id of ['headline', 'bug', 'ticker']) {
      h.request(id, id);
      h.advance();
    }
    const alert = h.request('alert', 'alert', false);
    const refused = () => {
      const before = structuredClone(h.session),
        sample = sampleTransitionLogic(h.def, h.session, h.session.frame);
      for (const id of ['header', 'subline'])
        expect(() => h.request(id, id)).toThrow(/alert must be fully Off|headline must be On/);
      expect(h.session).toEqual(before);
      expect(sampleTransitionLogic(h.def, h.session, h.session.frame)).toEqual(sample);
    };
    refused();
    h.event({ type: 'ready', frame: h.session.frame, slotId: 'alert', requestId: alert });
    refused();
    h.advance();
    refused();
    h.advance();
    refused();
    h.request('alert', null);
    refused();
    h.advance();
    h.request('headline', 'headline');
    h.advance();
    for (const id of ['header', 'subline']) expect(h.session.slots[id]!.settled).toBeNull();
    for (const id of ['bug', 'ticker']) expect(h.session.slots[id]!.settled?.stateId).toBe(id);
  });
  it('rejects explicit resource preparation in a blocking lane and permits Out/Clear', () => {
    const h = harness();
    h.request('headline', 'headline');
    h.advance();
    expect(transitionLogicAdmissionError(h.def, h.session, 'header', 'header', ['alert'])).toMatch(
      /alert must be fully Off/,
    );
    expect(transitionLogicAdmissionError(h.def, h.session, 'header', null, ['alert'])).toBeNull();
    h.event({ type: 'clear', frame: h.session.frame, slotId: 'header' });
  });
  it('does not redefine legacy Take-out-with as Require-On', () => {
    const def = definition();
    for (const slot of def.slots) delete slot.admission;
    const h = harness(def);
    h.request('header', 'header');
    h.advance();
    expect(h.session.slots.header!.settled?.stateId).toBe('header');
  });
  it('releases a completed old cascade so later orphan child Takes cannot stall a parent return', () => {
    const def = definition();
    for (const slot of def.slots) delete slot.admission;
    def.states.find((s) => s.id === 'headline')!.takeOutSlotIds = ['alert'];
    const h = harness(def);
    for (const id of ['bug', 'ticker', 'alert']) {
      h.request(id, id);
      h.advance();
    }
    for (const id of ['header', 'subline']) {
      h.request(id, id);
      h.advance();
    }
    h.request('alert', null);
    h.advance();
    h.request('headline', 'headline');
    h.advance();
    expect(h.session.slots.headline!.settled?.stateId).toBe('headline');
    expect(h.session.slots.headline!.pending).toBeNull();
  });
  it('validates missing, duplicate, self, cyclic and contradictory guards', () => {
    for (const admission of [
      { requireOnSlotIds: ['missing'] },
      { requireOnSlotIds: ['header'] },
      { requireOnSlotIds: ['headline', 'headline'] },
      { requireOnSlotIds: ['headline'], blockWhileActiveSlotIds: ['headline'] },
      { blockWhileActiveSlotIds: ['header'] },
      { surprise: [] },
    ]) {
      const def = definition();
      Object.assign(def.slots[1]!, { admission });
      expect(transitionLogicErrors(def).join(' ')).toMatch(/admission/);
    }
    const def = definition();
    def.slots[0]!.admission = { requireOnSlotIds: ['header'] };
    expect(transitionLogicErrors(def).join(' ')).toMatch(/cyclic require-On/);
  });
  it('applies state data presets and preserves explicit data over defaults across JSON replay', () => {
    const def = definition();
    def.states[0]!.dataDefaults = { label: 'HEADLINE', color: '#123456' };
    expect(transitionLogicErrors(def)).toEqual([]);
    const h = harness(JSON.parse(JSON.stringify(def)));
    h.request('headline', 'headline');
    h.advance();
    expect(h.session.slots.headline!.settled?.data).toEqual({
      label: 'HEADLINE',
      color: '#123456',
    });
    h.event({
      type: 'request',
      frame: h.session.frame,
      slotId: 'headline',
      stateId: 'headline',
      requestId: 'edited',
      data: { label: 'EDITED' },
    });
    h.event({ type: 'ready', frame: h.session.frame, slotId: 'headline', requestId: 'edited' });
    h.advance();
    expect(h.session.slots.headline!.settled?.data).toEqual({ label: 'EDITED', color: '#123456' });
    def.states[0]!.dataDefaults = { bad: Infinity };
    expect(transitionLogicErrors(def).join(' ')).toMatch(/defaults.*JSON-safe/);
  });
});
