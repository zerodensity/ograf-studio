import { describe, expect, it } from 'vitest';
import {
  buildComponentDefinition,
  createFieldDefinition,
  createLayerKeyframe,
  createProject,
  createTextLayer,
  instantiateComponentDefinition,
  createLayerOfKind,
  syncCompositionShaderParameterFields,
  createShaderPaint,
} from './index';

describe('reusable components', () => {
  it('preserves returned shader field identities and user labels through component reconciliation', () => {
    const composition = createProject().compositions[0]!;
    const layer = createLayerOfKind('text');
    if (layer.element.type !== 'text') throw new Error('Expected text.');
    layer.element.fill = createShaderPaint();
    layer.element.strokePaint = createShaderPaint();
    composition.layers = [layer];
    syncCompositionShaderParameterFields(composition);
    composition.dataFields[0]!.key = 'custom_frequency';
    composition.dataFields[0]!.label = 'Frequency';
    const definition = buildComponentDefinition(composition, [layer.id], 'Shader component');
    const before = structuredClone(definition);
    const instance = instantiateComponentDefinition(composition, definition);
    expect(instance.dataFields).toHaveLength(6);
    const expectedFields = structuredClone(instance.dataFields);
    composition.layers.push(...instance.layers);
    composition.dataFields.push(...instance.dataFields);
    syncCompositionShaderParameterFields(composition);
    for (const original of definition.dataFields) {
      const id = instance.fieldIds[original.id]!;
      const field = composition.dataFields.find((candidate) => candidate.id === id);
      expect(field).toEqual(expectedFields.find((candidate) => candidate.id === id));
      expect(field?.generatedShaderParameter?.layerId).toBe(instance.layerIds[layer.id]);
    }
    expect(instance.layers[0]!.bindings.map((binding) => binding.fieldId)).toEqual(
      Object.values(instance.fieldIds),
    );
    expect(
      composition.dataFields.find(
        (field) => field.id === instance.fieldIds[definition.dataFields[0]!.id],
      ),
    ).toMatchObject({ key: 'custom_frequency_2', label: 'Frequency' });
    expect(definition).toEqual(before);
  });
  it('snapshots selected layers and instantiates independent grouped OGraf layers and fields', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const field = createFieldDefinition('text', { key: 'headline', label: 'Headline' });
    const parent = createTextLayer();
    const child = createTextLayer();
    parent.name = 'Background label';
    child.name = 'Headline';
    parent.keyframes = [
      createLayerKeyframe(0, {
        x: 100,
        y: 50,
        width: 400,
        height: 80,
        rotation: 0,
        opacity: 1,
        transformOriginX: 0.5,
        transformOriginY: 0.5,
      }),
    ];
    child.keyframes = [
      createLayerKeyframe(0, {
        x: 120,
        y: 60,
        width: 360,
        height: 60,
        rotation: 0,
        opacity: 1,
        transformOriginX: 0.5,
        transformOriginY: 0.5,
      }),
    ];
    child.parentId = parent.id;
    child.bindings = [{ fieldId: field.id, targetProperty: 'content' }];
    composition.dataFields.push(field);
    composition.layers.push(parent, child);

    const definition = buildComponentDefinition(
      composition,
      [parent.id, child.id],
      'Headline block',
      'component-headline',
    );
    composition.components.push(definition);
    const instance = instantiateComponentDefinition(composition, definition, { x: 80, y: 25 });

    expect(instance.layers).toHaveLength(2);
    expect(new Set(instance.layers.map((layer) => layer.groupId))).toEqual(
      new Set([instance.groupId]),
    );
    expect(instance.layers[1]!.parentId).toBe(instance.layers[0]!.id);
    expect(instance.layers[1]!.bindings[0]!.fieldId).toBe(instance.dataFields[0]!.id);
    expect(instance.dataFields[0]!.key).toBe('headline_2');
    expect(instance.layers[0]!.id).not.toBe(parent.id);
    expect(instance.layers[0]!.keyframes[0]!.transform.x).toBe(
      parent.keyframes[0]!.transform.x + 80,
    );
    expect(definition.layers[0]!.keyframes[0]!.transform.x).toBe(parent.keyframes[0]!.transform.x);
  });

  it('detaches snapshot parents outside the selected component', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const parent = createTextLayer();
    const child = createTextLayer();
    child.parentId = parent.id;
    composition.layers.push(parent, child);
    const definition = buildComponentDefinition(composition, [child.id], 'Child');
    expect(definition.layers[0]!.parentId).toBeNull();
  });

  it('regenerates every nested data-schema node ID for each instance', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const field = createFieldDefinition('object', {
      key: 'story',
      properties: [
        createFieldDefinition('text', { key: 'headline' }),
        createFieldDefinition('array', {
          key: 'items',
          items: createFieldDefinition('object', {
            key: 'item',
            properties: [createFieldDefinition('text', { key: 'label' })],
          }),
        }),
      ],
    });
    const layer = createTextLayer();
    layer.bindings = [{ fieldId: field.id, targetProperty: 'content', sourcePath: ['headline'] }];
    composition.dataFields.push(field);
    composition.layers.push(layer);
    const definition = buildComponentDefinition(composition, [layer.id], 'Nested field');

    const first = instantiateComponentDefinition(composition, definition);
    const second = instantiateComponentDefinition(composition, definition);
    const ids = (root: typeof field) => {
      const result: string[] = [];
      const visit = (node: typeof field) => {
        result.push(node.id);
        node.properties.forEach(visit);
        if (node.items) visit(node.items);
      };
      visit(root);
      return result;
    };

    expect(
      new Set([...ids(field), ...ids(first.dataFields[0]!), ...ids(second.dataFields[0]!)]).size,
    ).toBe(ids(field).length * 3);
  });
});
