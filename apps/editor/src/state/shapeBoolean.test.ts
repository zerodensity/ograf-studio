import { describe, expect, it, vi } from 'vitest';
import { createProject } from '@ograf-editor/scene-model';
import { useProjectStore } from './projectStore';
import { buildExportArtifacts } from './exportPackage';
import { combineShapePaths } from '../canvas/shapeBoolean';
vi.stubGlobal('window', {
  clearTimeout: (timer: ReturnType<typeof setTimeout> | undefined) => clearTimeout(timer),
});
const history = await import('./historyStore');
describe('shape boolean integration', () => {
  it('creates one exportable new result while preserving its sources and undoing in one step', () => {
    useProjectStore.getState().loadProject(createProject());
    const a = useProjectStore.getState().addLayer('rectangle', { x: 0, y: 0 });
    const b = useProjectStore.getState().addLayer('ellipse', { x: 100, y: 100 });
    const composition = useProjectStore.getState().project.compositions[0]!;
    const source = composition.layers.filter((layer) => [a, b].includes(layer.id));
    const result = combineShapePaths(source, 0, 'subtract');
    let id = '';
    history.runDiscreteHistoryStep(() => {
      id = useProjectStore.getState().addDrawnPath(result);
      useProjectStore
        .getState()
        .updateLayerElement(id, { fill: result.fill, strokeColor: 'transparent', strokeWidth: 0 });
      useProjectStore.getState().renameLayer(id, 'Shape subtract');
      for (const layer of source)
        if (layer.isVisible) useProjectStore.getState().toggleLayerVisibility(layer.id);
    }, 'Shape subtract');
    const project = useProjectStore.getState().project;
    expect(project.compositions[0]!.layers).toHaveLength(3);
    expect(
      project.compositions[0]!.layers.filter((layer) => [a, b].includes(layer.id)).every(
        (layer) => !layer.isVisible,
      ),
    ).toBe(true);
    expect(buildExportArtifacts(project, project.compositions[0]!).valid).toBe(true);
    history.undo();
    const undone = useProjectStore.getState().project.compositions[0]!;
    expect(undone.layers.map((layer) => layer.id)).toEqual([a, b]);
    expect(undone.layers.every((layer) => layer.isVisible)).toBe(true);
    history.redo();
    expect(useProjectStore.getState().project.compositions[0]!.layers.at(-1)?.id).toBe(id);
  });
});
