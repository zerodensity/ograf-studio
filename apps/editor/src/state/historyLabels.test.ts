import { describe, expect, it } from 'vitest';
import { createLayerOfKind, createProject } from '@ograf-editor/scene-model';
import { describeProjectChange } from './historyLabels';

describe('history labels', () => {
  it('describes layer creation and property edits', () => {
    const before = createProject();
    const afterAdd = structuredClone(before);
    const layer = createLayerOfKind('rectangle');
    layer.name = 'Score plate';
    afterAdd.compositions[0]!.layers.push(layer);
    expect(describeProjectChange(before, afterAdd)).toBe('Add “Score plate”');

    const afterEdit = structuredClone(afterAdd);
    const edited = afterEdit.compositions[0]!.layers[0]!;
    if (edited.element.type !== 'rectangle') throw new Error('Expected rectangle layer.');
    edited.element.fill = '#00ff00';
    expect(describeProjectChange(afterAdd, afterEdit)).toBe('Edit “Score plate” properties');
  });

  it('describes canvas and timeline edits', () => {
    const before = createProject();
    const afterLayout = structuredClone(before);
    afterLayout.compositions[0]!.layout.showCenterMarker = true;
    expect(describeProjectChange(before, afterLayout)).toBe('Change canvas layout');

    const afterTimeline = structuredClone(before);
    afterTimeline.compositions[0]!.transitions[0]!.durationFrames += 2;
    expect(describeProjectChange(before, afterTimeline)).toBe('Edit lifecycle timeline');
  });
});
