import { describe, expect, it } from 'vitest';
import {
  buildComponentDefinition,
  createFieldDefinition,
  createLayerKeyframe,
  createProject,
  createTextLayer,
  instantiateComponentDefinition,
} from './index';

describe('reusable components', () => {
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
