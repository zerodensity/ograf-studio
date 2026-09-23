import { getElementShaderPaint } from '@ograf-editor/scene-model';
import { describe, expect, it } from 'vitest';
import { createProject, DEFAULT_SHADER_FRAGMENT_SOURCE } from '@ograf-editor/scene-model';
import { AuthoringSession } from './session';

describe('shader authoring', () => {
  it('authors shader property and loop keys through shared numeric operations and rejects stale targets atomically', () => {
    const session = new AuthoringSession(createProject(), 'shader-keys');
    const created = session.apply({
      expectedRevision: 0,
      operations: [
        {
          type: 'add_layer',
          kind: 'text',
          element: { fill: { type: 'shader' }, strokePaint: { type: 'shader' } },
        },
      ],
    });
    const layer = created.project.compositions[0]!.layers[0]!;
    expect(layer.animationTracks['fill.parameters.waveFrequency']).toBeUndefined();
    const keyed = session.apply({
      expectedRevision: 1,
      operations: [
        {
          type: 'set_property_track',
          layerId: layer.id,
          property: 'fill.parameters.waveFrequency',
          keys: [
            { frame: 0, value: 2 },
            { frame: 12, value: 6, easing: 'quad-in' },
          ],
        },
        { type: 'set_layer_loop', layerId: layer.id, durationFrames: 10 },
        {
          type: 'set_loop_property_track',
          layerId: layer.id,
          property: 'strokePaint.parameters.backgroundColor.r',
          keys: [
            { frame: 0, value: 0 },
            { frame: 10, value: 1 },
          ],
        },
      ],
    });
    expect(keyed.validation.errors).toEqual([]);
    const updated = keyed.project.compositions[0]!.layers[0]!;
    expect(updated.animationTracks['fill.parameters.waveFrequency']).toHaveLength(2);
    expect(updated.loop?.tracks['strokePaint.parameters.backgroundColor.r']).toHaveLength(2);
    expect(() =>
      session.apply({
        expectedRevision: 2,
        operations: [
          {
            type: 'set_property_key',
            layerId: layer.id,
            property: 'fill.parameters.waveFrequency.x',
            frame: 5,
            value: 2,
          },
        ],
      }),
    ).toThrow(/not exposed/);
    expect(() =>
      session.apply({
        expectedRevision: 2,
        operations: [
          {
            type: 'set_property_key',
            layerId: layer.id,
            property: 'fill.parameters.waveFrequency',
            frame: 5,
            value: 100,
          },
        ],
      }),
    ).toThrow(/outside its declared range/);
    expect(session.revision).toBe(2);
    expect(session.undo(2).project).toEqual(created.project);
  });
  it('updates and clears a native text shader outline independently from its shader fill', () => {
    const session = new AuthoringSession(createProject(), 'shader-outline');
    const added = session.apply({
      expectedRevision: 0,
      operations: [
        {
          type: 'add_layer',
          kind: 'text',
          element: {
            content: 'Native text',
            strokeWidth: 5,
            fill: { type: 'shader', parameters: { waveFrequency: 2 } },
            strokePaint: { type: 'shader', parameters: { waveFrequency: 9 } },
          },
        },
      ],
    });
    expect(added.validation.errors).toEqual([]);
    const layer = added.project.compositions[0]!.layers[0]!;
    const fillIds = added.project.compositions[0]!.dataFields.filter(
      (field) => field.generatedShaderParameter?.paintSlot === 'fill',
    ).map((field) => field.id);
    const updated = session.apply({
      expectedRevision: 1,
      operations: [
        {
          type: 'update_element',
          layerId: layer.id,
          patch: {
            content: 'Edited text',
            strokePaint: { type: 'shader', parameters: { waveFrequency: 11 } },
          },
        },
      ],
    });
    expect(
      getElementShaderPaint(updated.project.compositions[0]!.layers[0]!.element)?.parameters
        .waveFrequency,
    ).toBe(2);
    expect(
      getElementShaderPaint(updated.project.compositions[0]!.layers[0]!.element, 'stroke')
        ?.parameters.waveFrequency,
    ).toBe(11);
    const cleared = session.apply({
      expectedRevision: 2,
      operations: [{ type: 'update_element', layerId: layer.id, patch: { strokePaint: null } }],
    });
    expect(cleared.project.compositions[0]!.layers[0]!.element).toMatchObject({
      type: 'text',
      content: 'Edited text',
      strokeWidth: 5,
    });
    expect(cleared.project.compositions[0]!.layers[0]!.element).not.toHaveProperty('strokePaint');
    expect(cleared.project.compositions[0]!.dataFields.map((field) => field.id)).toEqual(fillIds);
    expect(() =>
      session.apply({
        expectedRevision: 3,
        operations: [
          { type: 'add_layer', kind: 'rectangle', element: { strokePaint: { type: 'shader' } } },
        ],
      }),
    ).toThrow(/only on text/);
  });
  it('authors shader fills through ordinary objects and restores original media without leaving fields', () => {
    const session = new AuthoringSession(createProject(), 'shader-fill');
    const added = session.apply({
      expectedRevision: 0,
      operations: [{ type: 'add_layer', kind: 'image', element: { fill: { type: 'shader' } } }],
    });
    const layer = added.project.compositions[0]!.layers[0]!;
    expect(layer.element.type).toBe('image');
    expect(
      layer.bindings.every((binding) => binding.targetProperty.startsWith('fill.parameters.')),
    ).toBe(true);
    const changed = session.apply({
      expectedRevision: 1,
      operations: [
        {
          type: 'update_element',
          layerId: layer.id,
          patch: { fill: { type: 'shader', parameters: { waveFrequency: 3 } } },
        },
      ],
    });
    expect(
      getElementShaderPaint(changed.project.compositions[0]!.layers[0]!.element)?.parameters
        .waveFrequency,
    ).toBe(3);
    const original = session.apply({
      expectedRevision: 2,
      operations: [{ type: 'update_element', layerId: layer.id, patch: { fill: null } }],
    });
    expect(original.project.compositions[0]!.layers[0]!.element).toEqual({
      type: 'image',
      src: null,
    });
    expect(original.project.compositions[0]!.layers[0]!.bindings).toEqual([]);
    expect(original.project.compositions[0]!.dataFields).toEqual([]);
  });
  it('accepts generated field default edits and rejects schema removal or mistyped parameter values', () => {
    const session = new AuthoringSession(createProject(), 'shader-data');
    const added = session.apply({
      expectedRevision: 0,
      operations: [{ type: 'add_layer', kind: 'shader' }],
    });
    const composition = added.project.compositions[0]!;
    const field = composition.dataFields.find(
      (entry) => entry.generatedShaderParameter?.name === 'waveFrequency',
    )!;
    const layer = composition.layers[0]!;
    const edited = session.apply({
      expectedRevision: 1,
      operations: [{ type: 'update_data_field', fieldId: field.id, defaultValue: 5 }],
    });
    expect(getElementShaderPaint(edited.project.compositions[0]!.layers[0]!.element)).toMatchObject(
      {
        parameters: { waveFrequency: 5 },
      },
    );
    expect(() =>
      session.apply({
        expectedRevision: 2,
        operations: [{ type: 'remove_data_field', fieldId: field.id, force: true }],
      }),
    ).toThrow(/#pragma ograf/);
    expect(() =>
      session.apply({
        expectedRevision: 2,
        operations: [{ type: 'update_data_field', fieldId: field.id, fieldType: 'text' }],
      }),
    ).toThrow(/#pragma ograf/);
    expect(() =>
      session.apply({
        expectedRevision: 2,
        operations: [
          {
            type: 'update_element',
            layerId: layer.id,
            patch: { parameters: { waveFrequency: '5' } },
          },
        ],
      }),
    ).toThrow(/finite.*number/);
    expect(() =>
      session.apply({
        expectedRevision: 2,
        operations: [
          { type: 'update_element', layerId: layer.id, patch: { parameters: { typo: 5 } } },
        ],
      }),
    ).toThrow(/Unknown shader parameter/);
    expect(session.revision).toBe(2);
  });

  it('automatically exposes marked source parameters and keeps cloned/deleted layers independent', () => {
    const fragmentSource = `#pragma ograf amount slider min(0) max(2) step(0.1)
const float amount = 0.5;
#pragma ograf offset vector2 min(-1) max(1)
const vec2 offset = vec2(0.0);
void mainImage(out vec4 c, in vec2 p) { c = vec4(amount + offset.x); }`;
    const session = new AuthoringSession(createProject(), 'source-fields');
    const added = session.apply({
      expectedRevision: 0,
      operations: [
        {
          type: 'add_layer',
          kind: 'shader',
          element: { fragmentSource },
        },
      ],
    });
    const layer = added.project.compositions[0]!.layers[0]!;
    expect(added.validation.errors).toEqual([]);
    expect(added.project.compositions[0]!.dataFields).toHaveLength(2);
    const edited = session.apply({
      expectedRevision: 1,
      operations: [
        {
          type: 'update_element',
          layerId: layer.id,
          patch: { parameters: { amount: 1.5 } },
        },
      ],
    });
    expect(getElementShaderPaint(edited.project.compositions[0]!.layers[0]!.element)).toMatchObject(
      {
        parameters: { amount: 1.5, offset: [0, 0] },
      },
    );
    expect(edited.project.compositions[0]!.dataFields[0]!.defaultValue).toBe(1.5);
    const copied = session.apply({
      expectedRevision: 2,
      operations: [
        {
          type: 'duplicate_group',
          source: { layerIds: [layer.id] },
          count: 1,
        },
      ],
    });
    expect(copied.validation.errors).toEqual([]);
    expect(copied.project.compositions[0]!.dataFields).toHaveLength(4);
    const remaining = session.apply({
      expectedRevision: 3,
      operations: [{ type: 'remove_layer', layerId: layer.id }],
    });
    expect(remaining.project.compositions[0]!.dataFields).toHaveLength(2);
    expect(session.undo(4).project).toEqual(copied.project);
  });

  it('adds and edits shader source with undo and atomic rejection of unsupported inputs', () => {
    const session = new AuthoringSession(createProject(), 'shader-test');
    const added = session.apply({
      expectedRevision: 0,
      operations: [{ type: 'add_layer', kind: 'shader' }],
    });
    const layer = added.project.compositions[0]!.layers[0]!;
    const fragmentSource = `// Authored source\n${DEFAULT_SHADER_FRAGMENT_SOURCE}`;
    const edited = session.apply({
      expectedRevision: 1,
      operations: [
        {
          type: 'update_element',
          layerId: layer.id,
          patch: { fragmentSource, speed: 2, resolutionScale: 0.5 },
        },
      ],
    });
    expect(edited.validation.valid).toBe(true);
    expect(getElementShaderPaint(edited.project.compositions[0]!.layers[0]!.element)).toEqual({
      type: 'shader',
      fragmentSource,
      speed: 2,
      resolutionScale: 0.5,
      parameters: expect.objectContaining({ waveFrequency: 8 }),
    });
    expect(() =>
      session.apply({
        expectedRevision: 2,
        operations: [
          { type: 'rename_layer', layerId: layer.id, name: 'Must roll back' },
          {
            type: 'update_element',
            layerId: layer.id,
            patch: { fragmentSource: `${fragmentSource}\nfloat x = iChannel1;` },
          },
        ],
      }),
    ).toThrow(/Unsupported shader inputs/);
    expect(session.revision).toBe(2);
    expect(session.snapshot().project).toEqual(edited.project);
    expect(session.undo(2).project).toEqual(added.project);
  });

  it('rejects malformed parameters at creation before changing the session', () => {
    const session = new AuthoringSession(createProject(), 'shader-invalid');
    expect(() =>
      session.apply({
        expectedRevision: 0,
        operations: [{ type: 'add_layer', kind: 'shader', element: { resolutionScale: 0 } }],
      }),
    ).toThrow(/resolutionScale/);
    expect(session.revision).toBe(0);
  });

  it('authors one portable iChannel0 image through the shader element contract', () => {
    const session = new AuthoringSession(createProject(), 'shader-image');
    const result = session.apply({
      expectedRevision: 0,
      operations: [
        {
          type: 'add_layer',
          kind: 'shader',
          element: {
            fragmentSource:
              'void mainImage(out vec4 c, in vec2 p) { c = texture(iChannel0, p / iResolution.xy); }',
            inputImage: {
              source: 'data:image/jpeg;base64,/9j/2Q==',
              name: 'plate.jpg',
              wrap: 'clamp',
              filter: 'linear',
            },
          },
        },
      ],
    });
    expect(result.validation.valid).toBe(true);
    expect(
      getElementShaderPaint(result.project.compositions[0]!.layers[0]!.element)?.inputImage,
    ).toMatchObject({ name: 'plate.jpg', wrap: 'clamp', filter: 'linear' });
  });
});
