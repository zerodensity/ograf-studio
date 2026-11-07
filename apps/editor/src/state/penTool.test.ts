import { describe, expect, it, vi } from 'vitest';
import { createProject, editPathGeometry, parseEditablePath } from '@ograf-editor/scene-model';
import { validateProject } from '@ograf-editor/validation';
import { useProjectStore } from './projectStore';
import { penPath } from '../canvas/penGeometry';
import { buildExportArtifacts } from './exportPackage';
vi.stubGlobal('window', {
  clearTimeout: (timer: ReturnType<typeof setTimeout> | undefined) => clearTimeout(timer),
});
const history = await import('./historyStore');

describe('drawn path project integration', () => {
  it('survives save/load, editing, export and one-step undo/redo', () => {
    useProjectStore.getState().loadProject(createProject());
    const path = penPath(
      [
        { x: 100, y: 100, out: { x: 125, y: 100 }, in: { x: 75, y: 100 } },
        { x: 200, y: 150, out: { x: 200, y: 175 }, in: { x: 200, y: 125 } },
        { x: 120, y: 230, out: { x: 95, y: 230 }, in: { x: 145, y: 230 } },
      ],
      true,
    );
    let id = '';
    history.runDiscreteHistoryStep(() => {
      id = useProjectStore.getState().addDrawnPath(path);
    }, 'Draw path');
    const project = useProjectStore.getState().project;
    const composition = project.compositions[0]!;
    const layer = composition.layers.find((l) => l.id === id)!;
    expect(layer.element.type).toBe('path');
    if (layer.element.type !== 'path') throw new Error('Expected path');
    expect(layer.element.d).toBe(path.d);
    expect(
      layer.keyframes.every(
        (k) => k.transform.width === path.width && k.transform.height === path.height,
      ),
    ).toBe(true);
    expect(validateProject(project).errors).toEqual([]);
    expect(buildExportArtifacts(project, composition).valid).toBe(true);
    const loaded = JSON.parse(JSON.stringify(project));
    expect(loaded.compositions[0].layers.find((l: { id: string }) => l.id === id).element.d).toBe(
      path.d,
    );
    expect(
      parseEditablePath(
        editPathGeometry(path.d, {
          action: 'move',
          expectedD: path.d,
          contour: 0,
          node: 1,
          x: 30,
          y: 30,
        }),
      )[0]?.nodes[1],
    ).toMatchObject({ x: 30, y: 30 });
    history.undo();
    expect(
      useProjectStore.getState().project.compositions[0]!.layers.some((l) => l.id === id),
    ).toBe(false);
    history.redo();
    expect(
      useProjectStore.getState().project.compositions[0]!.layers.some((l) => l.id === id),
    ).toBe(true);
  });
});
