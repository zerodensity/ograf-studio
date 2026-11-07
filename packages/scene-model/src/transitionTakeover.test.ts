import { describe, expect, it } from 'vitest';
import {
  transitionLogicErrors,
  type TransitionLogicDefinition,
  type TransitionLogicEffect,
  type TransitionLogicEvent,
} from './transitionLogic';
import { createTransitionLogicSession, reduceTransitionLogic } from './transitionLogicPlanner';

function definition(): TransitionLogicDefinition {
  const lanes = ['headline', 'subline', 'header', 'bug', 'ticker', 'locator', 'sidebar', 'alert'];
  return {
    version: 3,
    id: 'takeover-fixture',
    name: 'News takeover',
    slots: lanes.map((id, order) => ({
      id,
      name: id,
      order,
      ...(id === 'subline' ? { defaultTransitionId: 'slow' } : {}),
    })),
    states: lanes.map((id) => ({
      id,
      name: id,
      slotId: id,
      templateId: id,
      ...(id === 'alert' ? { takeOutSlotIds: ['headline', 'subline', 'header'] } : {}),
    })),
    transitions: [10, 30].map((duration, index) => ({
      id: index ? 'slow' : 'normal',
      name: 'Dissolve',
      durationFrames: duration,
      outgoingFrames: duration,
      incomingStartFrame: 0,
      incomingFrames: duration,
      sharedFrames: duration,
      easing: 'linear',
    })),
    defaultTransitionId: 'normal',
    routes: [],
    sharedInstances: [],
    initialSharedValues: [],
  };
}

function harness(def = definition()) {
  let session = createTransitionLogicSession(def);
  let serial = 0;
  const log: TransitionLogicEvent[] = [];
  const effects: TransitionLogicEffect[] = [];
  const event = (input: TransitionLogicEvent) => {
    const result = reduceTransitionLogic(def, session, input);
    log.push(input);
    effects.push(...result.effects);
    session = result.session;
    return result.effects;
  };
  const request = (slotId: string, stateId: string | null, ready = true) => {
    const requestId = `request-${++serial}`;
    event({ type: 'request', frame: session.frame, slotId, stateId, requestId });
    if (stateId && ready) event({ type: 'ready', frame: session.frame, slotId, requestId });
    return requestId;
  };
  const advance = (frame: number) => event({ type: 'advance', frame });
  const normalOn = () => {
    for (const slot of def.slots.filter((slot) => slot.id !== 'alert')) request(slot.id, slot.id);
    advance(30);
  };
  const off = (id: string) => {
    const slot = session.slots[id]!;
    expect([slot.desired, slot.settled, slot.transition, slot.pending, slot.takeover]).toEqual([
      null,
      null,
      null,
      null,
      undefined,
    ]);
  };
  return {
    def,
    event,
    request,
    advance,
    normalOn,
    off,
    log,
    effects,
    get session() {
      return session;
    },
  };
}

describe('one-way cross-lane takeover', () => {
  it('prepares incoming first, waits for the slowest real Out, preserves other graphics, and never restores', () => {
    const h = harness();
    h.normalOn();
    const preserved = ['bug', 'ticker', 'locator', 'sidebar'].map((id) => h.session.slots[id]);
    const requestId = h.request('alert', 'alert', false);
    for (const id of ['headline', 'subline', 'header'])
      expect(h.session.slots[id]!.settled?.stateId).toBe(id);
    expect(h.session.slots.alert!.transition).toBeNull();
    const effects = h.event({ type: 'ready', frame: 30, slotId: 'alert', requestId });
    expect(effects[0]).toMatchObject({
      type: 'takeover',
      frame: 30,
      slotId: 'alert',
      requestId,
      outSlotIds: ['headline', 'subline', 'header'],
    });
    for (const id of ['headline', 'subline', 'header'])
      expect(h.session.slots[id]!.transition).toMatchObject({ to: null, startFrame: 30 });
    h.advance(59);
    expect(h.session.slots.alert!.transition).toBeNull();
    h.advance(60);
    for (const id of ['headline', 'subline', 'header']) h.off(id);
    expect(h.session.slots.alert!.transition).toMatchObject({ startFrame: 60, endFrame: 70 });
    h.advance(70);
    expect(['bug', 'ticker', 'locator', 'sidebar'].map((id) => h.session.slots[id])).toEqual(
      preserved,
    );
    h.request('alert', null);
    h.advance(80);
    for (const id of ['headline', 'subline', 'header', 'alert']) h.off(id);
    expect(['bug', 'ticker', 'locator', 'sidebar'].map((id) => h.session.slots[id])).toEqual(
      preserved,
    );
  });

  it('does not touch working output if preparation fails or is canceled before ready', () => {
    const h = harness();
    h.normalOn();
    const previous = structuredClone(h.session.slots.headline);
    const failed = h.request('alert', 'alert', false);
    h.event({
      type: 'failed',
      frame: 30,
      slotId: 'alert',
      requestId: failed,
      message: 'Missing media',
    });
    expect(h.session.slots.headline).toEqual(previous);
    expect(h.effects.some((effect) => effect.type === 'takeover')).toBe(false);
    const canceled = h.request('alert', 'alert', false);
    h.request('alert', null);
    h.event({ type: 'ready', frame: 30, slotId: 'alert', requestId: canceled });
    h.advance(100);
    h.off('alert');
    expect(h.session.slots.headline).toEqual(previous);
  });

  it('cancels target preparation and rejects reactivation while the entry barrier is active', () => {
    const h = harness();
    h.normalOn();
    const stale = h.request('header', 'header', false);
    h.request('alert', 'alert');
    h.event({ type: 'ready', frame: 30, slotId: 'header', requestId: stale });
    expect(() => h.request('headline', 'headline')).toThrow(/takeover.*waiting/);
    h.advance(100);
    for (const id of ['headline', 'subline', 'header']) h.off(id);
    expect(h.session.slots.alert!.settled?.stateId).toBe('alert');
  });

  it('canceling the waiting entry with Out or Clear never resurrects it', () => {
    for (const clear of [false, true]) {
      const h = harness();
      h.normalOn();
      const stale = h.request('alert', 'alert');
      h.advance(35);
      if (clear) h.event({ type: 'clear', frame: 35, slotId: 'alert' });
      else h.request('alert', null);
      h.event({ type: 'ready', frame: 35, slotId: 'alert', requestId: stale });
      h.advance(100);
      for (const id of ['headline', 'subline', 'header', 'alert']) h.off(id);
      expect(
        h.effects.some((effect) => effect.type === 'started' && effect.slotId === 'alert'),
      ).toBe(false);
    }
  });

  it('repeated Takes replace waiting intent safely and same-state updates do not repeat takeover', () => {
    const h = harness();
    h.normalOn();
    h.request('alert', 'alert');
    const latest = h.request('alert', 'alert');
    h.advance(100);
    expect(h.session.slots.alert!.settled?.requestId).toBe(latest);
    h.request('headline', 'headline');
    h.advance(110);
    const before = h.effects.filter((effect) => effect.type === 'takeover').length;
    h.request('alert', 'alert');
    h.advance(120);
    expect(h.effects.filter((effect) => effect.type === 'takeover')).toHaveLength(before);
    expect(h.session.slots.headline!.settled?.stateId).toBe('headline');
  });

  it('includes parent dependents once and preserves their authored exit timing', () => {
    const def = definition();
    def.slots.find((slot) => slot.id === 'subline')!.parentSlotId = 'headline';
    def.slots.find((slot) => slot.id === 'header')!.parentSlotId = 'subline';
    const h = harness(def);
    h.normalOn();
    h.request('alert', 'alert');
    const takeover = h.effects.find((effect) => effect.type === 'takeover')!;
    expect(takeover).toMatchObject({ outSlotIds: ['headline', 'subline', 'header'] });
    expect(
      h.effects.filter((effect) => effect.type === 'started' && effect.plan.to === null),
    ).toHaveLength(3);
    h.advance(60);
    expect(h.session.slots.alert!.transition?.startFrame).toBe(60);
  });

  it('waits for its own preceding transition before beginning the barrier at the exact replay frame', () => {
    const def = definition();
    def.states.push({ id: 'standby', name: 'Standby', slotId: 'alert', templateId: 'standby' });
    const h = harness(def);
    h.normalOn();
    h.request('alert', 'standby');
    h.request('alert', 'alert');
    expect(h.effects.some((effect) => effect.type === 'takeover')).toBe(false);
    h.advance(100);
    expect(h.effects.find((effect) => effect.type === 'takeover')).toMatchObject({ frame: 40 });
    expect(
      h.effects.find((effect) => effect.type === 'started' && effect.plan.to?.stateId === 'alert'),
    ).toMatchObject({ plan: { startFrame: 70 } });
  });

  it('handles zero-duration recipes and targets already Off without a deadlock or later tick', () => {
    const def = definition();
    for (const recipe of def.transitions)
      Object.assign(recipe, {
        durationFrames: 0,
        outgoingFrames: 0,
        incomingStartFrame: 0,
        incomingFrames: 0,
        sharedFrames: 0,
      });
    for (const normalOn of [true, false]) {
      const h = harness(def);
      if (normalOn) h.normalOn();
      h.request('alert', 'alert');
      expect(h.session.slots.alert!.settled?.stateId).toBe('alert');
      for (const id of ['headline', 'subline', 'header']) h.off(id);
    }
  });

  it('releases the barrier immediately when outgoing lanes are explicitly cleared', () => {
    const h = harness();
    h.normalOn();
    h.request('alert', 'alert');
    for (const slotId of ['headline', 'subline', 'header'])
      h.event({ type: 'clear', frame: 35, slotId });
    expect(h.session.slots.alert!.transition?.startFrame).toBe(35);
  });

  it('replays JSON-roundtripped sessions and events deterministically', () => {
    const h = harness();
    h.normalOn();
    h.request('alert', 'alert');
    h.advance(60);
    h.advance(100);
    h.request('alert', null);
    h.advance(110);
    let replay = createTransitionLogicSession(h.def);
    const effects: TransitionLogicEffect[] = [];
    for (const event of h.log) {
      const result = reduceTransitionLogic(h.def, JSON.parse(JSON.stringify(replay)), event);
      replay = result.session;
      effects.push(...result.effects);
    }
    expect(replay).toEqual(h.session);
    expect(effects).toEqual(h.effects);
  });

  it('rejects missing, duplicate, self and ancestor-self takeover references', () => {
    for (const ids of [['missing'], ['headline', 'headline'], ['alert']]) {
      const def = definition();
      def.states.find((state) => state.id === 'alert')!.takeOutSlotIds = ids;
      expect(transitionLogicErrors(def).join(' ')).toMatch(/takeover/);
    }
    const ancestor = definition();
    ancestor.slots.find((slot) => slot.id === 'alert')!.parentSlotId = 'headline';
    expect(transitionLogicErrors(ancestor).join(' ')).toMatch(/own lane/);
    const cycle = definition();
    cycle.states[0]!.takeOutSlotIds = ['alert'];
    expect(transitionLogicErrors(cycle)).toEqual([]);
  });
});

describe('reciprocal cross-lane takeover', () => {
  const reciprocal = () => {
    const def = definition();
    def.states[0]!.takeOutSlotIds = ['alert'];
    return def;
  };

  it('takes Breaking out before a normal headline returns without restoring its other normal lanes', () => {
    const h = harness(reciprocal());
    h.normalOn();
    h.request('alert', 'alert');
    h.advance(70);
    const requestId = h.request('headline', 'headline', false);
    h.advance(80);
    expect(h.session.slots.alert!.settled?.stateId).toBe('alert');
    h.event({ type: 'ready', frame: 80, slotId: 'headline', requestId });
    expect(h.session.slots.alert!.transition).toMatchObject({ to: null, startFrame: 80 });
    expect(h.session.slots.headline!.transition).toBeNull();
    h.advance(90);
    expect(h.session.slots.headline!.transition).toMatchObject({ startFrame: 90, endFrame: 100 });
    h.advance(100);
    h.off('alert');
    h.off('subline');
    h.off('header');
    for (const id of ['headline', 'bug', 'ticker', 'locator', 'sidebar'])
      expect(h.session.slots[id]!.settled?.stateId).toBe(id);
    h.request('headline', null);
    h.advance(110);
    h.off('alert');
  });

  it('lets a prepared reverse replace a waiting entry without a deadlock or stale reactivation', () => {
    const h = harness(reciprocal());
    h.normalOn();
    const breaking = h.request('alert', 'alert');
    h.advance(35);
    const reverse = h.request('headline', 'headline', false);
    h.advance(60);
    expect(h.session.slots.alert!.transition).toBeNull();
    expect(h.session.slots.headline!.pending?.request.requestId).toBe(reverse);
    h.event({ type: 'ready', frame: 60, slotId: 'headline', requestId: reverse });
    expect(h.session.slots.alert!.pending).toBeNull();
    expect(h.session.slots.headline!.transition?.startFrame).toBe(60);
    h.event({ type: 'ready', frame: 60, slotId: 'alert', requestId: breaking });
    h.advance(100);
    h.off('alert');
    expect(h.session.slots.headline!.settled?.requestId).toBe(reverse);
    expect(
      h.effects.some((effect) => effect.type === 'started' && effect.plan.to?.stateId === 'alert'),
    ).toBe(false);
  });

  it('releases the old barrier when a reverse fails preparation or is canceled', () => {
    for (const failure of ['failed', 'out', 'clear'] as const) {
      const h = harness(reciprocal());
      h.normalOn();
      h.request('alert', 'alert');
      h.advance(35);
      const reverse = h.request('headline', 'headline', false);
      h.advance(60);
      if (failure === 'failed')
        h.event({
          type: 'failed',
          frame: 60,
          slotId: 'headline',
          requestId: reverse,
          message: 'Missing media',
        });
      else if (failure === 'clear') h.event({ type: 'clear', frame: 60, slotId: 'headline' });
      else h.request('headline', null);
      h.event({ type: 'ready', frame: 60, slotId: 'headline', requestId: reverse });
      h.advance(100);
      expect(h.session.slots.alert!.settled?.stateId).toBe('alert');
      h.off('headline');
    }
  });

  it('keeps Breaking on when a normal reverse fails before any destructive exit', () => {
    const h = harness(reciprocal());
    h.request('alert', 'alert');
    h.advance(10);
    const before = structuredClone(h.session.slots.alert);
    const reverse = h.request('headline', 'headline', false);
    h.event({
      type: 'failed',
      frame: 10,
      slotId: 'headline',
      requestId: reverse,
      message: 'Missing font',
    });
    expect(h.session.slots.alert).toEqual(before);
    expect(h.session.slots.headline!.desired).toBeNull();
    h.advance(100);
    h.off('headline');
  });

  it('selects the latest ready direction through rapid repeated reciprocal requests and deterministic replay', () => {
    const h = harness(reciprocal());
    h.normalOn();
    h.request('alert', 'alert');
    h.advance(35);
    h.request('headline', 'headline');
    h.request('alert', 'alert');
    h.advance(45);
    const latest = h.request('headline', 'headline');
    h.advance(200);
    h.off('alert');
    expect(h.session.slots.headline!.settled?.requestId).toBe(latest);
    let replay = createTransitionLogicSession(h.def);
    const replayEffects: TransitionLogicEffect[] = [];
    for (const event of JSON.parse(JSON.stringify(h.log)) as TransitionLogicEvent[]) {
      const result = reduceTransitionLogic(h.def, replay, event);
      replay = result.session;
      replayEffects.push(...result.effects);
    }
    expect(replay).toEqual(h.session);
    expect(replayEffects).toEqual(h.effects);
  });
});
