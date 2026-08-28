import { beforeEach, describe, expect, it } from 'vitest';
import { useSelectionStore } from './selectionStore';

describe('layer selection', () => {
  beforeEach(() => useSelectionStore.getState().select(null));

  it('uses plain selection as a single primary layer', () => {
    useSelectionStore.getState().select('lower-third-bg');
    useSelectionStore.getState().select('lower-third-text');

    expect(useSelectionStore.getState().selectedLayerIds).toEqual(['lower-third-text']);
    expect(useSelectionStore.getState().selectedLayerId).toBe('lower-third-text');
  });

  it('toggles layers into and out of an additive selection', () => {
    useSelectionStore.getState().select('lower-third-bg');
    useSelectionStore.getState().toggleLayerSelection('lower-third-text');
    expect(useSelectionStore.getState().selectedLayerIds).toEqual([
      'lower-third-bg',
      'lower-third-text',
    ]);
    expect(useSelectionStore.getState().selectedLayerId).toBe('lower-third-text');

    useSelectionStore.getState().toggleLayerSelection('lower-third-text');
    expect(useSelectionStore.getState().selectedLayerIds).toEqual(['lower-third-bg']);
    expect(useSelectionStore.getState().selectedLayerId).toBe('lower-third-bg');
  });

  it('toggles every persistent-group member as one additive selection', () => {
    useSelectionStore.getState().select('outside');
    useSelectionStore.getState().toggleManyLayerSelection(['panel', 'headline']);
    expect(useSelectionStore.getState().selectedLayerIds).toEqual(['outside', 'panel', 'headline']);
    expect(useSelectionStore.getState().selectedLayerId).toBe('headline');

    useSelectionStore.getState().toggleManyLayerSelection(['panel', 'headline']);
    expect(useSelectionStore.getState().selectedLayerIds).toEqual(['outside']);
    expect(useSelectionStore.getState().selectedLayerId).toBe('outside');
  });

  it('returns to a single selection when a keyframe is selected', () => {
    useSelectionStore.getState().select('background');
    useSelectionStore.getState().toggleLayerSelection('headline');
    useSelectionStore.getState().selectLayerKeyframe('headline', 'headline-key-2');

    expect(useSelectionStore.getState().selectedLayerIds).toEqual(['headline']);
    expect(useSelectionStore.getState().selectedLayerKeyframeId).toBe('headline-key-2');
    expect(useSelectionStore.getState().selectedLayerKeyframes).toEqual([
      { layerId: 'headline', keyframeId: 'headline-key-2', property: null },
    ]);
  });

  it('keeps multiple keyframes with a distinct primary key', () => {
    const first = { layerId: 'headline', keyframeId: 'key-1', property: 'x' as const };
    const second = { layerId: 'headline', keyframeId: 'key-2', property: 'x' as const };

    useSelectionStore.getState().selectLayerKeyframes([first, second, second], first);

    expect(useSelectionStore.getState().selectedLayerKeyframes).toEqual([first, second]);
    expect(useSelectionStore.getState().selectedLayerKeyframeId).toBe('key-1');
    expect(useSelectionStore.getState().selectedLayerProperty).toBe('x');
  });

  it('selects a pasted set with the final layer as Inspector primary', () => {
    useSelectionStore.getState().selectMany(['background-copy', 'text-copy', 'text-copy']);

    expect(useSelectionStore.getState().selectedLayerIds).toEqual(['background-copy', 'text-copy']);
    expect(useSelectionStore.getState().selectedLayerId).toBe('text-copy');
  });
});
