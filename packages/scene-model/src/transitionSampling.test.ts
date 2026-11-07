import { describe, expect, it } from 'vitest';
import { type TransitionLogicDefinition, transitionLogicErrors } from './transitionLogic';
import {
  createTransitionLogicSession,
  prepareTransitionLogicDefinition,
  reduceTransitionLogic,
  sampleTransitionLogic,
} from './transitionLogicPlanner';

function definition(authored = false): TransitionLogicDefinition {
  return {
    version: 3,
    id: 'sampling',
    name: 'Sampling',
    slots: [{ id: 'main', name: 'Main', order: 0 }],
    states: [
      {
        id: 'title',
        name: 'Title',
        slotId: 'main',
        templateId: 'title',
        sharedValues: [
          { instanceId: 'panel', sourceLayerId: 'glass', property: 'y', value: 200 },
          { instanceId: 'panel', sourceLayerId: 'glass', property: 'opacity', value: 1 },
        ],
      },
      {
        id: 'next',
        name: 'Next',
        slotId: 'main',
        templateId: 'next',
        sharedValues: [
          { instanceId: 'panel', sourceLayerId: 'glass', property: 'y', value: 300 },
          { instanceId: 'panel', sourceLayerId: 'glass', property: 'opacity', value: 0.2 },
        ],
      },
    ],
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
        ...(authored ? { contentMotion: 'authored' } : {}),
      },
    ],
    routes: [],
    defaultTransitionId: 'fade',
    sharedInstances: [
      {
        id: 'panel',
        name: 'Panel',
        componentAssetId: 'asset',
        continuityKey: 'panel',
        slotId: 'main',
      },
    ],
    initialSharedValues: [
      { instanceId: 'panel', sourceLayerId: 'glass', property: 'y', value: 100 },
      { instanceId: 'panel', sourceLayerId: 'glass', property: 'opacity', value: 0 },
    ],
  };
}

function harness(authored = false) {
  const def = prepareTransitionLogicDefinition(definition(authored));
  let session = createTransitionLogicSession(def),
    serial = 0;
  const event = (input: Parameters<typeof reduceTransitionLogic>[2]) => {
    session = reduceTransitionLogic(def, session, input).session;
  };
  const take = (stateId: string | null) => {
    const requestId = `request-${++serial}`;
    event({
      type: 'request',
      frame: session.frame,
      slotId: 'main',
      stateId,
      requestId,
      data: { nested: { values: ['safe'] } },
    });
    if (stateId) event({ type: 'ready', frame: session.frame, slotId: 'main', requestId });
  };
  return {
    def,
    event,
    take,
    get session() {
      return session;
    },
  };
}

describe('isolated transition samples', () => {
  it('keeps input and definition isolated from output mutations before, during and after completion', () => {
    const h = harness();
    h.take('title');
    const original = structuredClone(h.session);
    for (const frame of [0, 0.99, 5, 9.99, 10, 100]) {
      const sample = sampleTransitionLogic(h.def, h.session, frame);
      const expected = structuredClone(sample);
      for (const slot of sample.slots) {
        for (const selection of [slot.desired, slot.settled, slot.outgoing, slot.incoming])
          if (selection) (selection.data.nested as { values: string[] }).values.push('changed');
        for (const value of slot.sharedValues) value.value = -999;
      }
      for (const value of sample.sharedValues) value.value = -111;
      expect(h.session).toEqual(original);
      expect(sampleTransitionLogic(h.def, h.session, frame)).toEqual(expected);
    }
    expect(h.def.initialSharedValues[0]!.value).toBe(100);
  });

  it('samples completion and ready queued replacements exactly as explicit advancement', () => {
    const h = harness();
    h.take('title');
    h.take('next');
    const source = structuredClone(h.session);
    for (const frame of [0, 5.5, 10, 15.5, 20, 100]) {
      const advanced = reduceTransitionLogic(h.def, h.session, { type: 'advance', frame }).session;
      expect(sampleTransitionLogic(h.def, h.session, frame)).toEqual(
        sampleTransitionLogic(h.def, advanced, frame),
      );
      expect(h.session).toEqual(source);
    }
  });

  it('still rejects invalid, backward and mismatched-definition samples', () => {
    const h = harness();
    h.event({ type: 'advance', frame: 10 });
    expect(() => sampleTransitionLogic(h.def, h.session, 9)).toThrow('cannot move backward');
    expect(() => sampleTransitionLogic(h.def, h.session, NaN)).toThrow('finite');
    expect(() =>
      sampleTransitionLogic(h.def, { ...h.session, definitionRevision: 'wrong' }, 10),
    ).toThrow('definition changed');
  });
});

describe('authored content motion', () => {
  it('validates authored recipes and keeps entry opacity at the target pin while geometry morphs', () => {
    const h = harness(true);
    expect(transitionLogicErrors(h.def)).toEqual([]);
    h.take('title');
    for (const frame of [0, 0.99, 5, 9.99]) {
      const sample = sampleTransitionLogic(h.def, h.session, frame);
      expect(sample.sharedValues.find((value) => value.property === 'opacity')!.value).toBe(1);
      expect(sample.sharedValues.find((value) => value.property === 'y')!.value).toBeCloseTo(
        100 + frame * 10,
      );
    }
  });

  it('keeps the exit source opacity until Off, leaving legacy fades and on-air morphs unchanged', () => {
    const h = harness(true);
    h.take('title');
    h.event({ type: 'advance', frame: 10 });
    h.take('next');
    expect(
      sampleTransitionLogic(h.def, h.session, 15).sharedValues.find(
        (value) => value.property === 'opacity',
      )!.value,
    ).toBeCloseTo(0.6);
    h.event({ type: 'advance', frame: 20 });
    h.take(null);
    for (const frame of [20, 25, 29.99])
      expect(
        sampleTransitionLogic(h.def, h.session, frame).sharedValues.find(
          (value) => value.property === 'opacity',
        )!.value,
      ).toBe(0.2);
    expect(
      sampleTransitionLogic(h.def, h.session, 30).sharedValues.find(
        (value) => value.property === 'opacity',
      )!.value,
    ).toBe(0);
    const fade = harness();
    fade.take('title');
    expect(
      sampleTransitionLogic(fade.def, fade.session, 5).sharedValues.find(
        (value) => value.property === 'opacity',
      )!.value,
    ).toBe(0.5);
  });
});
