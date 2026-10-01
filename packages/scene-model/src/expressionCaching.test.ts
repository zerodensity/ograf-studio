import { describe, expect, it, vi } from 'vitest';
import { createDefaultTransform } from './factory';
import {
  resolveExpressionTransforms,
  type ExpressionLayerState,
  type ExpressionDiagnostic,
} from './expressionTransforms';

describe('active expression compilation', () => {
  it('retains an active working set larger than the shared cache across fresh frame states', () => {
    const layers: ExpressionLayerState[] = Array.from({ length: 300 }, (_, index) => ({
      id: `cache-layer-${index}`,
      expressions: { x: `${100000 + index} + frame` },
      transform: createDefaultTransform(),
    }));
    const compile = vi.spyOn(globalThis, 'Function');
    try {
      resolveExpressionTransforms(layers, { frame: 0 });
      expect(compile).toHaveBeenCalledTimes(300);
      compile.mockClear();
      const nextFrame = layers.map((layer) => ({ ...layer, transform: { ...layer.transform } }));
      const poses = resolveExpressionTransforms(nextFrame, { frame: 1 });
      expect(poses.get('cache-layer-299')!.x).toBe(100300);
      expect(compile).not.toHaveBeenCalled();

      layers[0]!.expressions!.x = 'frame + 900001';
      expect(resolveExpressionTransforms(layers, { frame: 2 }).get(layers[0]!.id)!.x).toBe(900003);
      expect(compile).toHaveBeenCalledTimes(1);
      compile.mockClear();
      layers[0]!.expressions = { x: 'frame + 900002' };
      expect(resolveExpressionTransforms(layers, { frame: 3 }).get(layers[0]!.id)!.x).toBe(900005);
      expect(compile).toHaveBeenCalledTimes(1);
    } finally {
      compile.mockRestore();
    }
  });

  it('retains syntax failures until the property source changes', () => {
    const layer: ExpressionLayerState = {
      id: 'invalid-cached-layer',
      expressions: { x: 'const invalidCachedSyntax = ;', y: 'frame + 910001' },
      transform: createDefaultTransform({ x: 27 }),
    };
    const compile = vi.spyOn(globalThis, 'Function');
    try {
      expect(resolveExpressionTransforms([layer], { frame: 0 }).get(layer.id)!.x).toBe(27);
      expect(compile).toHaveBeenCalled();
      compile.mockClear();
      for (let frame = 1; frame <= 10; frame++) {
        const diagnostics: ExpressionDiagnostic[] = [];
        const pose = resolveExpressionTransforms([layer], { frame }, diagnostics).get(layer.id)!;
        expect(pose.x).toBe(27);
        expect(pose.y).toBe(frame + 910001);
        expect(diagnostics).toHaveLength(1);
      }
      expect(compile).not.toHaveBeenCalled();
      layer.expressions!.x = 'frame + 910002';
      expect(resolveExpressionTransforms([layer], { frame: 11 }).get(layer.id)!.x).toBe(910013);
      expect(compile).toHaveBeenCalledTimes(1);
    } finally {
      compile.mockRestore();
    }
  });
});
