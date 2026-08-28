import { describe, expect, it } from 'vitest';
import { createLayerOfKind, createProject } from '@ograf-editor/scene-model';
import { selectableLayerIds } from './selectAllLayers';

describe('select all template layers', () => {
  it('includes visible, hidden, locked, and guide layers in paint order', () => {
    const composition = createProject().compositions[0]!;
    const visible = createLayerOfKind('rectangle');
    const hidden = createLayerOfKind('text');
    const locked = createLayerOfKind('ellipse');
    const guide = createLayerOfKind('path');
    hidden.isVisible = false;
    locked.isLocked = true;
    guide.isGuide = true;
    composition.layers = [visible, hidden, locked, guide];

    expect(selectableLayerIds(composition)).toEqual([visible.id, hidden.id, locked.id, guide.id]);
  });
});
