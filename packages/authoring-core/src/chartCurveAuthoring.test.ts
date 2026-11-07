import { describe, expect, it } from 'vitest';
import {
  createLayerOfKind,
  createProject,
  DEFAULT_CHART_ANIMATION,
} from '@ograf-editor/scene-model';
import { applyAuthoringOperations } from './operations';

describe('chart custom curve authoring', () => {
  it('authors a valid Bézier and rejects malformed curves without mutating the project', () => {
    const project = createProject();
    const layer = createLayerOfKind('chart');
    project.compositions[0]!.layers.push(layer);
    const curve = { x1: 0.2, y1: 0.1, x2: 0.8, y2: 0.9 };
    const result = applyAuthoringOperations(project, [
      {
        type: 'update_element',
        layerId: layer.id,
        patch: { animation: { ...DEFAULT_CHART_ANIMATION, curve } },
      },
    ]);
    expect(result.project.compositions[0]!.layers[0]!.element).toMatchObject({
      animation: { curve },
    });
    expect(() =>
      applyAuthoringOperations(project, [
        {
          type: 'update_element',
          layerId: layer.id,
          patch: { animation: { ...DEFAULT_CHART_ANIMATION, curve: { ...curve, x1: 2 } } },
        },
      ]),
    ).toThrow(/curve/);
    expect(project.compositions[0]!.layers[0]!.element).not.toMatchObject({ animation: { curve } });
  });
});
