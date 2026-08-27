import { describe, expect, it } from 'vitest';
import {
  createDefaultTransform,
  createLayerKeyframe,
  createProject,
  createTextLayer,
} from './factory';
import { runBroadcastQa } from './broadcastQa';

describe('broadcast QA', () => {
  it('reports title-safe, minimum-size, and unpackaged-font risks at Step frames', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const layer = createTextLayer();
    if (layer.element.type !== 'text') throw new Error('Expected text layer.');
    layer.element.fontFamily = 'Missing Broadcast Font';
    layer.element.fontSize = 18;
    layer.element.minFontSize = 9;
    layer.keyframes = [
      createLayerKeyframe(0, createDefaultTransform({ x: 0, y: 0, opacity: 0 })),
      createLayerKeyframe(12, createDefaultTransform({ x: 0, y: 0, opacity: 1 })),
      createLayerKeyframe(24, createDefaultTransform({ x: 0, y: 0, opacity: 0 })),
    ];
    composition.layers.push(layer);

    const issues = runBroadcastQa(project);

    expect(issues.some((issue) => issue.category === 'safe-area')).toBe(true);
    expect(issues.some((issue) => issue.category === 'typography')).toBe(true);
    expect(issues.some((issue) => issue.category === 'resources')).toBe(true);
  });
});
