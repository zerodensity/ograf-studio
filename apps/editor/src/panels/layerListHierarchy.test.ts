import { describe, expect, it } from 'vitest';
import {
  canAssignLayerParent,
  layerDropIntent,
  layerIndentDepth,
  reorderLayerDisplayOrder,
  type LayerRelationship,
} from './layerListHierarchy';

const hierarchy: LayerRelationship[] = [
  { id: 'root', parentId: null },
  { id: 'child', parentId: 'root' },
  { id: 'grandchild', parentId: 'child' },
  { id: 'sibling', parentId: null },
];

describe('Layers hierarchy presentation', () => {
  it('derives indentation from the complete parent chain', () => {
    expect(layerIndentDepth(hierarchy, 'root')).toBe(0);
    expect(layerIndentDepth(hierarchy, 'child')).toBe(1);
    expect(layerIndentDepth(hierarchy, 'grandchild')).toBe(2);
  });

  it('classifies row edges as reorder zones and its centre as parenting', () => {
    expect(layerDropIntent(101, 100, 40)).toBe('before');
    expect(layerDropIntent(120, 100, 40)).toBe('parent');
    expect(layerDropIntent(139, 100, 40)).toBe('after');
  });

  it('reorders explicitly before or after without changing other rows', () => {
    const order = ['front', 'middle', 'back'];
    expect(reorderLayerDisplayOrder(order, 'back', 'front', 'before')).toEqual([
      'back',
      'front',
      'middle',
    ]);
    expect(reorderLayerDisplayOrder(order, 'front', 'back', 'after')).toEqual([
      'middle',
      'back',
      'front',
    ]);
  });

  it('rejects self-parenting, descendant cycles, and already-cyclic targets', () => {
    expect(canAssignLayerParent(hierarchy, 'sibling', 'root')).toBe(true);
    expect(canAssignLayerParent(hierarchy, 'root', 'root')).toBe(false);
    expect(canAssignLayerParent(hierarchy, 'root', 'grandchild')).toBe(false);
    expect(
      canAssignLayerParent(
        [
          { id: 'a', parentId: 'b' },
          { id: 'b', parentId: 'a' },
          { id: 'c', parentId: null },
        ],
        'c',
        'a',
      ),
    ).toBe(false);
  });
});
