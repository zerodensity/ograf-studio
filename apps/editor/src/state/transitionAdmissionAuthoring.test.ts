import { describe, expect, it } from 'vitest';
import {
  TRANSITION_LOGIC_VERSION,
  type TransitionLogicDefinition,
  type TransitionLogicSlot,
} from '@ograf-editor/scene-model';
import {
  setLayerAdmission,
  setLayerUpdateMode,
  setTemplateDataDefaults,
  layerRemovalBlocker,
  removeLayer,
} from './transitionChoreography';
function definition(): TransitionLogicDefinition {
  return {
    version: 4,
    id: 'author-admission',
    name: 'Author admission',
    defaultTransitionId: 'fade',
    slots: [
      { id: 'headline', name: 'Headline', order: 0 },
      { id: 'header', name: 'Header', order: 1, parentSlotId: 'headline' },
      { id: 'alert', name: 'Breaking', order: 2 },
    ],
    states: [{ id: 'source', name: 'Source', slotId: 'header', templateId: 'source' }],
    transitions: [
      {
        id: 'fade',
        name: 'Fade',
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
describe('choosing how a lane changes its content', () => {
  it('upgrades a set only when a lane goes in place, and leaves the source alone', () => {
    const before = definition();
    const after = setLayerUpdateMode(before, 'header', 'in-place');
    expect(after.version).toBe(TRANSITION_LOGIC_VERSION);
    expect(after.slots.find((slot) => slot.id === 'header')?.updateMode).toBe('in-place');
    expect(after.slots.find((slot) => slot.id === 'headline')?.updateMode).toBeUndefined();
    expect(before.version).toBe(4);
    expect(before.slots.find((slot) => slot.id === 'header')?.updateMode).toBeUndefined();
    expect(setLayerUpdateMode(before, 'header', 'transition').version).toBe(4);
  });

  it('removes the field for the default, so a default lane reads as it always did', () => {
    const inPlace = setLayerUpdateMode(definition(), 'header', 'in-place');
    const back = setLayerUpdateMode(inPlace, 'header', 'transition');
    expect(back.slots.find((slot) => slot.id === 'header')).not.toHaveProperty('updateMode');
  });

  it('refuses a lane that no longer exists', () => {
    expect(() => setLayerUpdateMode(definition(), 'gone', 'in-place')).toThrow('removed');
  });
});

describe('Take conditions and editorial preset authoring', () => {
  it('upgrades legacy authoring only when adding an admission guard or preset', () => {
    const before = definition();
    before.version = 3;
    expect(setLayerAdmission(before, 'header', { requireOnSlotIds: ['headline'] }).version).toBe(
      TRANSITION_LOGIC_VERSION,
    );
    expect(setTemplateDataDefaults(before, 'source', { label: 'SOURCE' }).version).toBe(
      TRANSITION_LOGIC_VERSION,
    );
    expect(setLayerAdmission(before, 'header', {}).version).toBe(3);
    expect(setTemplateDataDefaults(before, 'source', {}).version).toBe(3);
    expect(before.version).toBe(3);
  });
  it('copies guards, preserves Take-out-with and leaves all unrelated authoring untouched', () => {
    const before = definition(),
      snapshot = structuredClone(before);
    const input = { requireOnSlotIds: ['headline'], blockWhileActiveSlotIds: ['alert'] };
    const result = setLayerAdmission(before, 'header', input);
    input.requireOnSlotIds.length = 0;
    expect(before).toEqual(snapshot);
    expect(result.slots[1]).toEqual({
      ...before.slots[1],
      admission: { requireOnSlotIds: ['headline'], blockWhileActiveSlotIds: ['alert'] },
    });
    expect(result.states).toEqual(before.states);
    expect(result.transitions).toEqual(before.transitions);
    expect(result.sharedInstances).toEqual(before.sharedInstances);
  });
  it('removes an empty guard without altering the independent lifecycle dependency', () => {
    const before = setLayerAdmission(definition(), 'header', { requireOnSlotIds: ['headline'] });
    const cleared = setLayerAdmission(before, 'header', {
      requireOnSlotIds: [],
      blockWhileActiveSlotIds: [],
    });
    expect(cleared.slots[1]!.admission).toBeUndefined();
    expect(cleared.slots[1]!.parentSlotId).toBe('headline');
  });
  it('rejects invalid lane references and contradictory/cyclic requirements without mutating input', () => {
    for (const input of [
      { requireOnSlotIds: ['missing'] },
      { requireOnSlotIds: ['header'] },
      { requireOnSlotIds: ['headline'], blockWhileActiveSlotIds: ['headline'] },
    ])
      expect(() => setLayerAdmission(definition(), 'header', input)).toThrow(/admission/);
    const before = setLayerAdmission(definition(), 'header', { requireOnSlotIds: ['headline'] });
    expect(() => setLayerAdmission(before, 'headline', { requireOnSlotIds: ['header'] })).toThrow(
      /cyclic/,
    );
    expect(before.slots[0]!.admission).toBeUndefined();
  });
  it('rejects unsupported raw JSON guard members instead of silently clearing conditions', () => {
    const raw = JSON.parse('{"unexpected":["headline"]}') as TransitionLogicSlot['admission'];
    expect(() => setLayerAdmission(definition(), 'header', raw)).toThrow(/admission/);
  });
  it('blocks lane removal while a Take condition refers to it', () => {
    const before = definition();
    delete before.slots[1]!.parentSlotId;
    const guarded = setLayerAdmission(before, 'header', {
      requireOnSlotIds: ['headline'],
      blockWhileActiveSlotIds: ['alert'],
    });
    for (const id of ['headline', 'alert']) {
      expect(layerRemovalBlocker(guarded, id)).toMatch(/Take conditions/);
      expect(() => removeLayer(guarded, id)).toThrow(/Take conditions/);
    }
    const cleared = setLayerAdmission(guarded, 'header', null);
    expect(layerRemovalBlocker(cleared, 'alert')).toBeUndefined();
    expect(removeLayer(cleared, 'alert').slots.some((s) => s.id === 'alert')).toBe(false);
  });
  it('stores deep-independent state defaults and clears them without cloning templates', () => {
    const before = definition(),
      defaults = { label: 'DEVELOPING', color: '#d49b22', visible: false, rows: [{ title: 'A' }] };
    const next = setTemplateDataDefaults(before, 'source', defaults);
    defaults.rows[0]!.title = 'mutated';
    expect(next.states[0]!.dataDefaults).toEqual({
      label: 'DEVELOPING',
      color: '#d49b22',
      visible: false,
      rows: [{ title: 'A' }],
    });
    expect(before.states[0]!.dataDefaults).toBeUndefined();
    expect(next.states[0]!.templateId).toBe('source');
    expect(setTemplateDataDefaults(next, 'source', {}).states[0]!.dataDefaults).toBeUndefined();
  });
  it('rejects unsafe/non-object preset JSON with useful errors', () => {
    for (const value of [{ value: Infinity }, { value: undefined }, JSON.parse('[1,2]')])
      expect(() => setTemplateDataDefaults(definition(), 'source', value)).toThrow(/defaults|JSON/);
  });
});
