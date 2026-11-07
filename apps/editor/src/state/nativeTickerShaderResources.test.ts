import { beforeEach, describe, expect, it } from 'vitest';
import {
  addEffect,
  createLayerOfKind,
  createProject,
  createShaderPaint,
  createTextElement,
} from '@ograf-editor/scene-model';
import {
  collectShaderResources,
  resolveShaderResource,
  shaderResourceTarget,
} from './shaderResources';
import { encodeShaderResourceDrag, shaderPaintFromResourceDrag } from './shaderDrag';
import { useProjectStore } from './projectStore';

function fixture() {
  const project = createProject();
  const composition = project.compositions[0]!;
  const ticker = createLayerOfKind('ticker');
  const graphic = createLayerOfKind('rectangle');
  addEffect(graphic, 'shader', {
    shader: createShaderPaint({ name: 'Item polish' }),
    blendMode: 'normal',
  });
  if (ticker.element.type !== 'ticker') throw new Error('Expected ticker.');
  ticker.element.items = [
    {
      id: 'headline',
      width: 640,
      element: createTextElement({
        content: 'NEWS',
        fill: createShaderPaint({ name: 'Item fill' }),
        strokePaint: createShaderPaint({ name: 'Item outline' }),
      }),
      effects: graphic.effects,
    },
  ];
  ticker.element.background = createShaderPaint({ name: 'Ticker backdrop' });
  composition.layers = [ticker];
  return { project, ticker, composition };
}

describe('native ticker shader resources', () => {
  beforeEach(() => useProjectStore.getState().newProject());

  it('lists background, item fill/outline and item effects with independent identities', () => {
    const { project } = fixture();
    const resources = collectShaderResources(project);
    expect(resources.map((resource) => resource.label).sort()).toEqual([
      'Item fill',
      'Item outline',
      'Item polish',
      'Ticker backdrop',
    ]);
    expect(new Set(resources.map((resource) => resource.key)).size).toBe(4);
    for (const resource of resources)
      expect(resolveShaderResource(project, shaderResourceTarget(resource)).paint).toBe(
        resource.paint,
      );
  });

  it('copies nested shaders through the standard Resources drag reference', () => {
    const { project } = fixture();
    const resource = collectShaderResources(project).find((entry) => entry.label === 'Item fill')!;
    const copied = shaderPaintFromResourceDrag(
      project,
      encodeShaderResourceDrag(project.id, resource),
    );
    expect(copied).toEqual(resource.paint);
    expect(copied).not.toBe(resource.paint);
    expect(shaderResourceTarget(resource)).toMatchObject({ itemId: 'headline', slot: 'fill' });
  });

  it('edits and removes only the selected nested usage', () => {
    const { project } = fixture();
    useProjectStore.getState().loadProject(project);
    const resource = collectShaderResources(useProjectStore.getState().project).find(
      (entry) => entry.label === 'Item fill',
    )!;
    useProjectStore.getState().updateShaderResource(resource, { name: 'Edited ticker fill' });
    expect(
      collectShaderResources(useProjectStore.getState().project).map((entry) => entry.label),
    ).toContain('Edited ticker fill');
    expect(
      collectShaderResources(useProjectStore.getState().project).map((entry) => entry.label),
    ).toContain('Item outline');
    useProjectStore.getState().removeShaderResource(resource);
    expect(
      collectShaderResources(useProjectStore.getState().project)
        .map((entry) => entry.label)
        .sort(),
    ).toEqual(['Item outline', 'Item polish', 'Ticker backdrop']);
  });

  it('edits and removes a ticker item effect and background without touching the parent', () => {
    const { project } = fixture();
    useProjectStore.getState().loadProject(project);
    for (const label of ['Item polish', 'Ticker backdrop']) {
      const resource = collectShaderResources(useProjectStore.getState().project).find(
        (entry) => entry.label === label,
      )!;
      useProjectStore.getState().updateShaderResource(resource, { speed: 0.5 });
      expect(resolveShaderResource(useProjectStore.getState().project, resource).paint.speed).toBe(
        0.5,
      );
      useProjectStore.getState().removeShaderResource(resource);
    }
    expect(
      collectShaderResources(useProjectStore.getState().project)
        .map((entry) => entry.label)
        .sort(),
    ).toEqual(['Item fill', 'Item outline']);
  });
});
