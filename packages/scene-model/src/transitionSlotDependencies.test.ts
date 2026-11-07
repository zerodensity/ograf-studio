import { describe, expect, it } from 'vitest';
import {
  transitionLogicErrors,
  type TransitionLogicDefinition,
  type TransitionLogicSession,
} from './transitionLogic';
import {
  createTransitionLogicSession,
  reduceTransitionLogic,
  sampleTransitionLogic,
} from './transitionLogicPlanner';

function definition(): TransitionLogicDefinition {
  return {
    version: 3,
    id: 'dependency-fixture',
    name: 'Dependent lower third',
    slots: [
      { id: 'headline', name: 'Headline', order: 0 },
      {
        id: 'subline',
        name: 'Second line',
        order: 1,
        parentSlotId: 'headline',
        defaultTransitionId: 'slow',
      },
      { id: 'header', name: 'Header', order: 2, parentSlotId: 'headline' },
      { id: 'ticker', name: 'Unrelated ticker', order: 3 },
    ],
    states: ['headline', 'subline', 'header', 'ticker'].map((id) => ({
      id,
      name: id,
      slotId: id,
      templateId: id,
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
    sharedInstances: [
      {
        id: 'panel',
        name: 'Panel',
        componentAssetId: 'panel-asset',
        continuityKey: 'panel',
        slotId: 'headline',
      },
    ],
    initialSharedValues: [
      { instanceId: 'panel', sourceLayerId: 'backing', property: 'height', value: 100 },
    ],
    layoutRules: [
      {
        id: 'make-room',
        name: 'Make room',
        slotId: 'headline',
        whenSlotId: 'subline',
        sharedOffsets: [
          { instanceId: 'panel', sourceLayerId: 'backing', property: 'height', value: 50 },
        ],
      },
    ],
  };
}
function harness(def = definition()) {
  let session = createTransitionLogicSession(def);
  let serial = 0;
  const event = (input: Parameters<typeof reduceTransitionLogic>[2]) => {
    session = reduceTransitionLogic(def, session, input).session;
    return session;
  };
  const request = (slotId: string, stateId: string | null, ready = true) => {
    const requestId = `request-${++serial}`;
    event({
      type: 'request',
      frame: session.frame,
      slotId,
      stateId,
      requestId,
      data: { text: slotId },
    });
    if (stateId && ready) event({ type: 'ready', frame: session.frame, slotId, requestId });
    return requestId;
  };
  const advance = (frame: number) => event({ type: 'advance', frame });
  const allOn = () => {
    for (const slot of def.slots) request(slot.id, slot.id);
    advance(30);
  };
  return {
    def,
    event,
    request,
    advance,
    allOn,
    get session() {
      return session;
    },
  };
}
const off = (session: TransitionLogicSession, id: string) => {
  const slot = session.slots[id]!;
  expect([slot.desired, slot.settled, slot.transition, slot.pending]).toEqual([
    null,
    null,
    null,
    null,
  ]);
};

describe('explicit slot lifecycle dependencies', () => {
  it('takes real dependents off, preserves unrelated slots, and returns parent alone', () => {
    const h = harness();
    h.allOn();
    h.request('headline', null);
    h.advance(60);
    for (const id of ['headline', 'subline', 'header']) off(h.session, id);
    expect(h.session.slots.ticker!.settled?.stateId).toBe('ticker');
    h.request('headline', 'headline');
    h.advance(70);
    expect(h.session.slots.headline!.settled?.stateId).toBe('headline');
    off(h.session, 'subline');
    off(h.session, 'header');
    expect(sampleTransitionLogic(h.def, h.session, 70).sharedValues[0]!.value).toBe(100);
  });
  it('preserves legacy independent behavior when no dependency is authored', () => {
    const def = definition();
    for (const slot of def.slots) delete slot.parentSlotId;
    const h = harness(def);
    h.allOn();
    h.request('headline', null);
    h.advance(60);
    expect(h.session.slots.subline!.settled?.stateId).toBe('subline');
    expect(h.session.slots.header!.settled?.stateId).toBe('header');
  });
  it('takes an optional slot out independently and restores the parent layout', () => {
    const h = harness();
    h.allOn();
    h.request('subline', null);
    h.advance(60);
    expect(h.session.slots.headline!.settled?.stateId).toBe('headline');
    expect(h.session.slots.header!.settled?.stateId).toBe('header');
    expect(sampleTransitionLogic(h.def, h.session, 60).sharedValues[0]!.value).toBe(100);
  });
  it('holds occupied parent geometry during a whole-graphic exit', () => {
    const h = harness();
    h.allOn();
    h.request('headline', null);
    expect(sampleTransitionLogic(h.def, h.session, 35).sharedValues[0]!.value).toBe(150);
    h.advance(35);
    h.request('headline', null);
    expect(sampleTransitionLogic(h.def, h.session, 35).sharedValues[0]!.value).toBe(150);
  });
  it('cascades transitively through nested dependent slots', () => {
    const def = definition();
    def.slots.find((slot) => slot.id === 'header')!.parentSlotId = 'subline';
    const h = harness(def);
    h.allOn();
    h.request('headline', null);
    h.advance(60);
    for (const id of ['headline', 'subline', 'header']) off(h.session, id);
    expect(h.session.slots.ticker!.settled?.stateId).toBe('ticker');
  });
  it('queues parent Take until the slow dependent finishes and rejects fresh dependent Takes during exit', () => {
    const h = harness();
    h.allOn();
    h.request('headline', null);
    h.request('headline', null);
    h.request('headline', 'headline');
    expect(() => h.request('header', 'header')).toThrow(/parent.*exiting/);
    h.advance(40);
    expect(h.session.slots.headline!.transition).toBeNull();
    expect(h.session.slots.headline!.pending?.selection?.stateId).toBe('headline');
    h.advance(60);
    expect(h.session.slots.headline!.transition?.startFrame).toBe(60);
    h.advance(70);
    off(h.session, 'subline');
    off(h.session, 'header');
    h.request('subline', 'subline');
    h.advance(100);
    expect(h.session.slots.subline!.settled?.stateId).toBe('subline');
  });
  it('cancels pending preparation and ignores stale ready callbacks', () => {
    const h = harness();
    h.request('headline', 'headline');
    h.advance(10);
    const stale = h.request('subline', 'subline', false);
    h.request('headline', null);
    h.event({ type: 'ready', frame: 10, slotId: 'subline', requestId: stale });
    h.advance(50);
    off(h.session, 'subline');
    off(h.session, 'headline');
  });
  it('cascades Clear immediately and tolerates repeated Out', () => {
    const h = harness();
    h.allOn();
    h.request('headline', null);
    h.request('headline', null);
    h.advance(60);
    for (const id of ['headline', 'subline', 'header']) off(h.session, id);
    h.request('headline', 'headline');
    h.request('subline', 'subline');
    h.advance(90);
    h.event({ type: 'clear', frame: 90, slotId: 'headline' });
    for (const id of ['headline', 'subline', 'header']) off(h.session, id);
    expect(h.session.slots.ticker!.settled?.stateId).toBe('ticker');
  });
  it('rejects missing, self, and cyclic dependency references', () => {
    for (const parent of ['missing', 'headline', 'subline']) {
      const def = definition();
      def.slots[0]!.parentSlotId = parent;
      expect(transitionLogicErrors(def).join(' ')).toMatch(/parent|depend/);
    }
  });
});
