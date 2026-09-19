import { describe, expect, it } from 'vitest';
import {
  buildComponentDefinition,
  createLayerOfKind,
  createProject,
  createShaderPaint,
  createShaderResource,
  getElementShaderPaint,
  syncShaderParameterFields,
} from '@ograf-editor/scene-model';
import {
  collectShaderResources,
  isStoredShaderResourceTarget,
  type ShaderUsageTarget,
} from './shaderResources';

import {
  encodeShaderResourceDrag,
  shaderPaintFromResourceDrag,
  SHADER_RESOURCE_MIME,
} from './shaderDrag';

function inlineShaderResources(project: Parameters<typeof collectShaderResources>[0]) {
  return collectShaderResources(project).filter(
    (resource): resource is Extract<typeof resource, ShaderUsageTarget> =>
      !isStoredShaderResourceTarget(resource),
  );
}

function fixture() {
  const project = createProject();
  const composition = project.compositions[0]!;
  const layer = createLayerOfKind('text');
  if (layer.element.type !== 'text') throw new Error('Expected text.');
  layer.element.fill = createShaderPaint({
    name: 'Fill shader',
    speed: 0.75,
    resolutionScale: 0.5,
    parameters: { waveFrequency: 3, backgroundColor: [0.1, 0.2, 0.3] },
  });
  layer.element.strokePaint = createShaderPaint({
    name: 'Outline shader',
    parameters: { waveFrequency: 9 },
  });
  layer.isLocked = true;
  composition.layers = [layer];
  syncShaderParameterFields(composition, layer);
  composition.components = [buildComponentDefinition(composition, [layer.id], 'Saved title')];
  return project;
}

describe('shader resource drag references', () => {
  it('copies current library shader settings into a new object without linking or mutating the library', () => {
    const project = fixture();
    const stored = createShaderResource({
      paint: createShaderPaint({
        name: 'Library shader',
        speed: 0.5,
        resolutionScale: 0.75,
        parameters: { waveFrequency: 3, backgroundColor: [0.1, 0.2, 0.3] },
      }),
    });
    project.shaders.push(stored);
    const library = collectShaderResources(project)[0]!;
    expect(isStoredShaderResourceTarget(library)).toBe(true);
    const payload = encodeShaderResourceDrag(project.id, library);
    expect(JSON.parse(payload)).toEqual({ projectId: project.id, target: { shaderId: stored.id } });
    expect(payload).not.toContain('fragmentSource');
    stored.paint.parameters.waveFrequency = 5;
    const before = JSON.stringify(project.shaders);
    const paint = shaderPaintFromResourceDrag(project, payload);
    expect(paint).toMatchObject({
      name: 'Library shader',
      speed: 0.5,
      resolutionScale: 0.75,
      parameters: { waveFrequency: 5 },
    });
    (paint.parameters.backgroundColor as number[])[0] = 0.9;
    const target = createLayerOfKind('text');
    if (target.element.type !== 'text') throw new Error('Expected text');
    target.element.strokePaint = paint;
    const composition = project.compositions[0]!;
    composition.layers.push(target);
    syncShaderParameterFields(composition, target);
    expect(target.bindings.length).toBeGreaterThan(0);
    expect(
      target.bindings.every((binding) => {
        const owner = composition.dataFields.find(
          (field) => field.id === binding.fieldId,
        )?.generatedShaderParameter;
        return owner?.layerId === target.id && owner.paintSlot === 'stroke';
      }),
    ).toBe(true);
    expect(JSON.stringify(project.shaders)).toBe(before);
    project.shaders = [];
    expect(getElementShaderPaint(target.element, 'stroke')?.name).toBe('Library shader');
    expect(() => shaderPaintFromResourceDrag(project, payload)).toThrow(
      /project shader resource no longer exists/,
    );
  });

  it('encodes only canonical identity and clones all current paint settings from a locked source', () => {
    const project = fixture();
    const source = inlineShaderResources(project)[0]!;
    const payload = encodeShaderResourceDrag(project.id, source);
    expect(SHADER_RESOURCE_MIME).toBe('application/x-ograf-shader-resource');
    expect(JSON.parse(payload)).toEqual({
      projectId: project.id,
      target: { compositionId: source.compositionId, layerId: source.layerId, slot: 'fill' },
    });
    expect(payload).not.toContain('fragmentSource');
    source.paint.parameters.waveFrequency = 4;
    const paint = shaderPaintFromResourceDrag(project, payload);
    expect(paint).toEqual(source.paint);
    expect(paint).toMatchObject({
      name: 'Fill shader',
      speed: 0.75,
      resolutionScale: 0.5,
      parameters: { waveFrequency: 4 },
    });
    expect(paint).not.toBe(source.paint);
    expect(paint.parameters).not.toBe(source.paint.parameters);
    (paint.parameters.backgroundColor as number[])[0] = 0.9;
    expect(source.paint.parameters.backgroundColor).toEqual([0.1, 0.2, 0.3]);
  });

  it('distinguishes saved-component outline copies and lets the target create its own fields', () => {
    const project = fixture();
    const usage = inlineShaderResources(project).find(
      (item) => item.componentId && item.slot === 'stroke',
    )!;
    const paint = shaderPaintFromResourceDrag(project, encodeShaderResourceDrag(project.id, usage));
    expect(paint.name).toBe('Outline shader');
    const composition = project.compositions[0]!;
    const target = createLayerOfKind('rectangle');
    if (target.element.type !== 'rectangle') throw new Error('Expected rectangle.');
    target.element.fill = paint;
    composition.layers.push(target);
    syncShaderParameterFields(composition, target);
    expect(getElementShaderPaint(target.element)?.parameters.waveFrequency).toBe(9);
    expect(
      target.bindings.every(
        (binding) =>
          composition.dataFields.find((field) => field.id === binding.fieldId)
            ?.generatedShaderParameter?.layerId === target.id,
      ),
    ).toBe(true);
    expect(target.bindings.map((binding) => binding.fieldId)).not.toEqual(
      composition.layers[0]!.bindings.map((binding) => binding.fieldId),
    );
  });

  it('rejects wrong projects, removed sources, removed components and no-longer-shader paints', () => {
    const project = fixture();
    const resources = inlineShaderResources(project);
    const live = resources[0]!;
    const payload = encodeShaderResourceDrag(project.id, live);
    expect(() => shaderPaintFromResourceDrag(createProject(), payload)).toThrow(
      /different project/,
    );
    const component = resources.find((item) => item.componentId)!;
    const componentPayload = encodeShaderResourceDrag(project.id, component);
    project.compositions[0]!.components = [];
    expect(() => shaderPaintFromResourceDrag(project, componentPayload)).toThrow(
      /component no longer exists/,
    );
    const layer = project.compositions[0]!.layers[0]!;
    if (layer.element.type !== 'text') throw new Error('Expected text.');
    layer.element.fill = '#ffffff';
    expect(() => shaderPaintFromResourceDrag(project, payload)).toThrow(/no longer uses a shader/);
    project.compositions[0]!.layers = [];
    expect(() => shaderPaintFromResourceDrag(project, payload)).toThrow(/object no longer exists/);
  });

  it.each([
    '',
    'not json',
    'null',
    '[]',
    '{}',
    JSON.stringify({
      projectId: 'p',
      target: { compositionId: 'c', layerId: 'l', slot: 'background' },
    }),
    JSON.stringify({
      projectId: 'p',
      target: { compositionId: 'c', layerId: 'l', slot: 'fill', fragmentSource: 'injected' },
    }),
    JSON.stringify({
      projectId: 'p',
      target: { compositionId: 'c', layerId: 'l', slot: 'fill', componentId: null },
    }),
    JSON.stringify({
      projectId: 'p',
      target: { compositionId: 'c', layerId: 'l'.repeat(257), slot: 'fill' },
    }),
    JSON.stringify({ projectId: ' ', target: { compositionId: 'c', layerId: 'l', slot: 'fill' } }),
    JSON.stringify({ projectId: 'p', target: { shaderId: '' } }),
    JSON.stringify({ projectId: 'p', target: { shaderId: 's'.repeat(257) } }),
    JSON.stringify({ projectId: 'p', target: { shaderId: 42 } }),
    JSON.stringify({ projectId: 'p', target: { shaderId: 's', slot: 'fill' } }),
    JSON.stringify({ projectId: 'p', target: { shaderId: 's', compositionId: 'c', layerId: 'l' } }),
    JSON.stringify({ projectId: 'p', target: { shaderId: 's', fragmentSource: 'injected' } }),
    ' '.repeat(4097),
  ])('rejects malformed or unbounded reference %s', (payload) => {
    expect(() => shaderPaintFromResourceDrag(fixture(), payload)).toThrow();
  });
});
