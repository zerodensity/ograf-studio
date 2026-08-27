import { describe, expect, it } from 'vitest';
import { createLayerOfKind, createProject } from '@ograf-editor/scene-model';
import { isPersistentGroupSelection, selectionIdsForLayer } from './groupSelection';

describe('persistent group selection', () => {
  it('expands a member to the complete group and distinguishes transient multi-selection', () => {
    const composition = createProject().compositions[0]!;
    const first = createLayerOfKind('rectangle');
    const second = createLayerOfKind('text');
    const outside = createLayerOfKind('ellipse');
    first.groupId = 'group-lower-third';
    second.groupId = 'group-lower-third';
    composition.layers.push(first, second, outside);

    expect(selectionIdsForLayer(composition, first.id)).toEqual([first.id, second.id]);
    expect(selectionIdsForLayer(composition, outside.id)).toEqual([outside.id]);
    expect(isPersistentGroupSelection(composition, [first.id, second.id])).toBe(true);
    expect(isPersistentGroupSelection(composition, [first.id, outside.id])).toBe(false);
    expect(isPersistentGroupSelection(composition, [first.id])).toBe(false);
  });
});
