import { describe, expect, it } from 'vitest';
import {
  createProject,
  createTickerLayer,
  createTickerElement,
  createTextElement,
  createLayerKeyframe,
  createDefaultTransform,
  createFieldDefinition,
} from '@ograf-editor/scene-model';
import { validateProject } from './validateProject';

describe('ticker nested content validation', () => {
  function fixture() {
    const project = createProject();
    const layer = createTickerLayer();
    layer.keyframes = [createLayerKeyframe(0, createDefaultTransform())];
    project.compositions[0]!.layers.push(layer);
    return { project, layer };
  }

  it('accepts prepared text and rejects missing nested binding targets', () => {
    const { project, layer } = fixture();
    expect(validateProject(project).errors).toEqual([]);
    layer.bindings.push({ fieldId: 'missing', targetProperty: 'items.no-item.content' });
    expect(validateProject(project).errors.join()).toContain('missing item property');
  });

  it('reports malformed item sequences and effects without crashing', () => {
    for (const element of [
      { type: 'image-sequence', frames: null, fps: 0, loop: true },
      { type: 'text', content: 12, runs: null },
      { type: 'image', src: {} },
      { type: 'ticker', items: [] },
    ]) {
      const { project, layer } = fixture();
      layer.element = {
        ...createTickerElement(),
        items: [{ id: 'bad', width: 100, element }],
      } as never;
      expect(validateProject(project).valid).toBe(false);
    }
    const { project, layer } = fixture();
    layer.element = {
      ...createTickerElement(),
      items: [{ id: 'bad', width: 100, element: createTextElement(), effects: 'invalid' }],
    } as never;
    expect(validateProject(project).errors.join()).toContain('effects must be an object');
  });

  it('rejects invalid child shaders and nested effects', () => {
    const { project, layer } = fixture();
    layer.element = createTickerElement({
      items: [
        {
          id: 'shader-text',
          width: 500,
          element: createTextElement({
            fill: {
              type: 'shader',
              fragmentSource: 'no mainImage here',
              parameters: {},
              speed: 1,
              resolutionScale: 1,
            },
          }),
          effects: {
            blur: 0,
            dropShadowEnabled: false,
            dropShadowColor: '#000000',
            dropShadowOpacity: 1,
            dropShadowOffsetX: 0,
            dropShadowOffsetY: 0,
            dropShadowBlur: 0,
            stack: 'bad' as never,
          },
        },
      ],
    });
    const errors = validateProject(project).errors.join();
    expect(errors).toContain('mainImage');
    expect(errors).toContain('Effects stack must be an array');
  });

  it('accepts full native ticker feeds without requiring a runtime collection', () => {
    for (const asJson of [false, true]) {
      const { project, layer } = fixture();
      const items = [{ id: 'news', width: 240, element: createTextElement() }];
      const field = asJson
        ? createFieldDefinition('textarea', {
            id: 'feed',
            key: 'feed',
            defaultValue: JSON.stringify(items),
          })
        : createFieldDefinition('array', {
            id: 'feed',
            key: 'feed',
            defaultValue: items as never,
            items: createFieldDefinition('object'),
          });
      project.compositions[0]!.dataFields.push(field);
      layer.bindings.push({ fieldId: 'feed', targetProperty: 'items' });
      expect(validateProject(project).errors).toEqual([]);
      field.defaultValue = (
        asJson ? JSON.stringify([{ ...items[0], width: 0 }]) : [{ ...items[0], width: 0 }]
      ) as never;
      expect(validateProject(project).errors.join()).toContain('item feed default');
    }
  });

  it('accepts item width and optional height bindings while rejecting invalid item IDs', () => {
    const { project, layer } = fixture();
    const id = layer.element.type === 'ticker' ? layer.element.items[0]!.id : '';
    project.compositions[0]!.dataFields.push(
      createFieldDefinition('number', { id: 'size', key: 'size', defaultValue: 200 }),
    );
    layer.bindings.push(
      { fieldId: 'size', targetProperty: `items.${id}.width` },
      { fieldId: 'size', targetProperty: `items.${id}.height` },
    );
    expect(validateProject(project).errors).toEqual([]);
    layer.bindings.push({ fieldId: 'size', targetProperty: 'items.missing.height' });
    expect(validateProject(project).errors.join()).toContain('missing item property');
  });
});
