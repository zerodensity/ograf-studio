import { describe, expect, it } from 'vitest';
import {
  createLayerOfKind,
  createProject,
  createAsset,
  createDefaultTransform,
  createLayerKeyframe,
  createAnimationTracksFromLegacyLayer,
} from '@ograf-editor/scene-model';
import { describeProjectChange } from './historyLabels';

describe('history labels', () => {
  it('does not traverse shared resource payloads while labeling a local move', () => {
    const before = createProject();
    const composition = before.compositions[0]!;
    let reads = 0;
    const resource = createAsset({
      name: 'Large image',
      kind: 'image',
      mimeType: 'image/png',
      dataUri: `data:image/png;base64,${'A'.repeat(1024 * 1024)}`,
    });
    composition.assets.push(
      new Proxy(resource, {
        get(target, property, receiver) {
          reads++;
          return Reflect.get(target, property, receiver);
        },
      }),
    );
    const layer = createLayerOfKind('rectangle');
    layer.keyframes = [createLayerKeyframe(0, createDefaultTransform({ x: 100, y: 200 }))];
    layer.animationTracks = createAnimationTracksFromLegacyLayer(layer);
    composition.layers.push(layer);
    const changed = {
      ...layer,
      keyframes: layer.keyframes.map((key) => ({
        ...key,
        transform: { ...key.transform, x: key.transform.x + 40 },
      })),
      animationTracks: {
        ...layer.animationTracks,
        x: layer.animationTracks.x!.map((key) => ({ ...key, value: key.value + 40 })),
      },
    };
    const after = { ...before, compositions: [{ ...composition, layers: [changed] }] };
    expect(describeProjectChange(before, after)).toBe('Move “Rectangle”');
    expect(reads).toBe(0);
  });

  it('still detects changes in deep-cloned remote projects after shared-reference optimizations', () => {
    const before = createProject();
    const layer = createLayerOfKind('text');
    before.compositions[0]!.layers.push(layer);
    const remote = structuredClone(before);
    const element = remote.compositions[0]!.layers[0]!.element;
    if (element.type !== 'text') throw new Error('Expected text.');
    element.content = 'Remote change';
    expect(describeProjectChange(before, remote)).toBe('Edit “Text” properties');
    expect(describeProjectChange(before, structuredClone(before))).toBe('Edit project');
  });
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
