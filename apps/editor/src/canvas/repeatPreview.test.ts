import { describe, expect, it } from 'vitest';
import {
  createLayerOfKind,
  createLayerKeyframe,
  createProject,
  defaultTransformFor,
} from '@ograf-editor/scene-model';
import { repeatPreview } from './repeatPreview';

describe('repeat ghost preview', () => {
  it('uses repeat stride and warns when copies leave title safe', () => {
    const composition = createProject().compositions[0]!;
    const layer = createLayerOfKind('rectangle');
    layer.keyframes.push(
      createLayerKeyframe(0, { ...defaultTransformFor('rectangle'), x: 300, y: 200 }),
    );
    composition.layers.push(layer);
    const preview = repeatPreview(composition, [layer.id], 3, 'horizontal', 30);
    expect(preview.boxes.map((box) => box.x)).toEqual([530, 760]);
    expect(preview.outsideTitleSafe).toBe(false);
    expect(repeatPreview(composition, [layer.id], 10, 'horizontal', 30).outsideTitleSafe).toBe(
      true,
    );
  });
});
