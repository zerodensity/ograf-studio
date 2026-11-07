import { describe, expect, it } from 'vitest';
import type { TransitionLogicDefinition } from '@ograf-editor/scene-model';
import {
  layerParentOptions,
  layerRemovalBlocker,
  removeLayer,
  setLayerParent,
} from './transitionChoreography';

function definition(): TransitionLogicDefinition {
  return {
    version: 3,
    id: 'dependency-test',
    name: 'Dependency test',
    defaultTransitionId: 'fade',
    slots: [
      { id: 'main', name: 'Main', order: 0 },
      { id: 'detail', name: 'Detail', order: 1, parentSlotId: 'main' },
      { id: 'badge', name: 'Badge', order: 2, parentSlotId: 'detail' },
      { id: 'ticker', name: 'Ticker', order: 3 },
    ],
    states: [],
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

describe('transition lane lifecycle authoring', () => {
  it('offers parents in drawing order, excluding the lane and all descendants', () => {
    const source = definition();
    expect(layerParentOptions(source, 'main').map((slot) => slot.id)).toEqual(['ticker']);
    expect(layerParentOptions(source, 'detail').map((slot) => slot.id)).toEqual(['ticker', 'main']);
    expect(layerParentOptions(source, 'badge').map((slot) => slot.id)).toEqual([
      'ticker',
      'detail',
      'main',
    ]);
  });

  it('creates one immutable model edit and removes the field when made Independent', () => {
    const source = definition();
    const linked = setLayerParent(source, 'ticker', 'main');
    expect(linked.slots.find((slot) => slot.id === 'ticker')?.parentSlotId).toBe('main');
    expect(source.slots.find((slot) => slot.id === 'ticker')).not.toHaveProperty('parentSlotId');
    expect(linked.states).toEqual(source.states);
    expect(linked.transitions).toEqual(source.transitions);
    const independent = setLayerParent(linked, 'ticker', null);
    expect(independent.slots.find((slot) => slot.id === 'ticker')).not.toHaveProperty(
      'parentSlotId',
    );
  });

  it('rejects missing, self and descendant parents through canonical validation', () => {
    for (const parent of ['missing', 'main', 'badge'])
      expect(() => setLayerParent(definition(), 'main', parent)).toThrow();
    expect(() => setLayerParent(definition(), 'missing', null)).toThrow('removed');
  });

  it('keeps parent identities until dependent lanes are explicitly unlinked', () => {
    const source = definition();
    expect(layerRemovalBlocker(source, 'main')).toContain('dependent lanes');
    expect(() => removeLayer(source, 'main')).toThrow('dependent lanes');
    const unlinked = setLayerParent(source, 'detail', null);
    expect(removeLayer(unlinked, 'main').slots.some((slot) => slot.id === 'main')).toBe(false);
    expect(unlinked.slots.find((slot) => slot.id === 'badge')?.parentSlotId).toBe('detail');
  });
});
