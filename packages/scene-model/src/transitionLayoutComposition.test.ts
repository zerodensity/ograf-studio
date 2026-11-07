import { describe, expect, it } from 'vitest';
import {
  transitionLogicErrors,
  type TransitionLogicDefinition,
  type TransitionLogicEvent,
} from './transitionLogic';
import {
  createTransitionLogicSession,
  reduceTransitionLogic,
  replayTransitionLogic,
  sampleTransitionLogic,
} from './transitionLogicPlanner';

function definition(): TransitionLogicDefinition {
  const slots = ['headline', 'subline', 'header', 'ticker'];
  return {
    version: 3,
    id: 'layout-composition',
    name: 'Combined reservations',
    slots: slots.map((id, order) => ({ id, name: id, order })),
    states: slots.map((id) => ({ id, name: id, slotId: id, templateId: id })),
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
    defaultTransitionId: 'fade',
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
      { instanceId: 'panel', sourceLayerId: 'glass', property: 'y', value: 700 },
      { instanceId: 'panel', sourceLayerId: 'glass', property: 'height', value: 200 },
    ],
    layoutRules: [
      {
        id: 'second-line-room',
        name: 'Second line',
        slotId: 'headline',
        whenSlotId: 'subline',
        sharedOffsets: [
          { instanceId: 'panel', sourceLayerId: 'glass', property: 'y', value: -30 },
          { instanceId: 'panel', sourceLayerId: 'glass', property: 'height', value: 30 },
        ],
      },
      {
        id: 'header-room',
        name: 'Header',
        slotId: 'headline',
        whenSlotId: 'header',
        sharedOffsets: [
          { instanceId: 'panel', sourceLayerId: 'glass', property: 'y', value: -20 },
          { instanceId: 'panel', sourceLayerId: 'glass', property: 'height', value: 20 },
        ],
      },
      {
        id: 'ticker-room',
        name: 'Ticker',
        slotId: 'headline',
        whenSlotId: 'ticker',
        sharedOffsets: [
          { instanceId: 'panel', sourceLayerId: 'glass', property: 'y', value: -60 },
          { instanceId: 'panel', sourceLayerId: 'glass', property: 'height', value: -60 },
        ],
      },
    ],
  };
}

describe('additive shared layout reservations', () => {
  it('composes independently timed lanes and releases only the lane that leaves, including seek and save/reopen', () => {
    const def = definition();
    expect(transitionLogicErrors(def)).toEqual([]);
    let session = createTransitionLogicSession(def);
    const log: TransitionLogicEvent[] = [];
    const event = (input: TransitionLogicEvent) => {
      log.push(input);
      session = reduceTransitionLogic(def, session, input).session;
    };
    const take = (slotId: string, frame: number, on = true) => {
      const requestId = `${slotId}-${frame}`;
      event({ type: 'request', frame, slotId, stateId: on ? slotId : null, requestId });
      if (on) event({ type: 'ready', frame, slotId, requestId });
    };
    const geometry = (frame: number) =>
      Object.fromEntries(
        sampleTransitionLogic(def, session, frame).sharedValues.map((entry) => [
          entry.property,
          entry.value,
        ]),
      );
    take('headline', 0);
    take('subline', 10);
    take('header', 15);
    take('ticker', 20);
    expect(geometry(25)).toEqual({ y: 620, height: 220 });
    event({ type: 'advance', frame: 30 });
    expect(geometry(30)).toEqual({ y: 590, height: 190 });
    take('subline', 30, false);
    event({ type: 'advance', frame: 40 });
    expect(geometry(40)).toEqual({ y: 620, height: 160 });
    take('ticker', 40, false);
    event({ type: 'advance', frame: 50 });
    expect(geometry(50)).toEqual({ y: 680, height: 220 });
    take('header', 50, false);
    event({ type: 'advance', frame: 60 });
    expect(geometry(60)).toEqual({ y: 700, height: 200 });
    const restored = JSON.parse(JSON.stringify(def)) as TransitionLogicDefinition;
    for (const frame of [25, 30, 35, 40, 45, 50, 55, 60]) {
      const replay = replayTransitionLogic(restored, log, frame);
      const sample = sampleTransitionLogic(restored, replay, frame);
      expect(
        sample.sharedValues.every(
          (value) => typeof value.value === 'number' && Number.isFinite(value.value),
        ),
      ).toBe(true);
      if (frame === 60) expect(replay).toEqual(session);
    }
    expect(restored.layoutRules?.map((rule) => rule.id)).toEqual([
      'second-line-room',
      'header-room',
      'ticker-room',
    ]);
  });

  it('rejects combined negative dimensions even when every reservation is safe alone or positives might mask it', () => {
    const def = definition();
    def.layoutRules![0]!.sharedOffsets[1]!.value = -90;
    def.layoutRules![1]!.sharedOffsets[1]!.value = 500;
    def.layoutRules![2]!.sharedOffsets[1]!.value = -120;
    expect(transitionLogicErrors(def).join(' ')).toContain(
      'Combined shared layout offsets can produce a negative',
    );
    def.states[0]!.sharedValues = [{ ...def.initialSharedValues[1]!, value: 150 }];
    def.layoutRules![2]!.sharedOffsets[1]!.value = -70;
    expect(transitionLogicErrors(def).join(' ')).toContain('negative shared dimension');
  });

  it('rejects aggregate overflow across independently safe position reservations', () => {
    const def = definition();
    def.layoutRules![0]!.sharedOffsets[0]!.value = Number.MAX_VALUE;
    def.layoutRules![1]!.sharedOffsets[0]!.value = Number.MAX_VALUE;
    expect(transitionLogicErrors(def).join(' ')).toContain('non-finite shared value');
  });

  it('keeps duplicate entries in a single reservation and conflicting lane ownership invalid', () => {
    const duplicate = definition();
    duplicate.layoutRules![0]!.sharedOffsets.push({
      ...duplicate.layoutRules![0]!.sharedOffsets[0]!,
    });
    expect(transitionLogicErrors(duplicate).join(' ')).toContain('repeats a shared property');
    const wrongOwner = definition();
    wrongOwner.layoutRules![1]!.slotId = 'ticker';
    expect(transitionLogicErrors(wrongOwner).join(' ')).toContain('conflicting slot owners');
  });
});
