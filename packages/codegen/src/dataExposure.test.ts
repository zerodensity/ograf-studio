import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import {
  createAsset,
  createDefaultTransform,
  createFieldDefinition,
  createLayerOfKind,
  createLayerKeyframe,
  createLayerPropertyKeyframe,
  createLayerVisualRule,
  createProject,
  getElementShaderPaint,
  syncCompositionShaderParameterFields,
  type TransitionLogicDefinition,
} from '@ograf-editor/scene-model';
import { validateManifest } from '@ograf-editor/validation';
import { compileDescriptor } from './compileDescriptor';
import { compileDataSchema } from './compileDataSchema';
import { buildExportArtifactsWithRuntime } from './buildExportArtifacts';
import { buildCoordinatedExportArtifactsWithRuntime } from './buildCoordinatedExportArtifacts';

function shaderProject(name = 'Exposure shader') {
  const project = createProject({ name });
  const composition = project.compositions[0]!;
  const layer = createLayerOfKind('rectangle');
  layer.keyframes = [createLayerKeyframe(0, createDefaultTransform())];
  if (layer.element.type !== 'rectangle') throw new Error('Expected rectangle');
  const shaderLayer = createLayerOfKind('shader');
  layer.element.fill = structuredClone(getElementShaderPaint(shaderLayer.element)!);
  const shader = getElementShaderPaint(layer.element)!;
  shader.fragmentSource = `#pragma ograf gain slider min(0) max(10) step(0.1)
const float gain = 2.0;
#pragma ograf offset vector2 min(-1) max(1)
const vec2 offset = vec2(0.25, 0.75);
#pragma ograf tint color
const vec3 tint = vec3(0.2, 0.4, 0.6);
void mainImage(out vec4 color, in vec2 p) { color = vec4(tint * gain + vec3(offset, 0.0), 1.0); }`;
  composition.layers = [layer];
  syncCompositionShaderParameterFields(composition);
  const field = (name: string) =>
    composition.dataFields.find((entry) => entry.generatedShaderParameter?.name === name)!;
  field('gain').key = 'gain';
  field('offset').key = 'offset';
  field('tint').key = 'tint';
  field('gain').exposeToOgraf = false;
  field('gain').required = true;
  field('offset').properties.find((property) => property.key === 'x')!.exposeToOgraf = false;
  layer.animationTracks['fill.parameters.gain'] = [
    createLayerPropertyKeyframe(0, 2),
    createLayerPropertyKeyframe(12, 4),
  ];
  layer.visualRules = [
    createLayerVisualRule({
      trigger: 'play',
      name: 'Set internal gain',
      actions: [{ type: 'set-data', fieldId: field('gain').id, mode: 'set', value: 3 }],
    }),
  ];
  return { project, composition, layer, field };
}

function coordinated(hiddenFirst = true) {
  const hidden = shaderProject('Hidden gain');
  const exposed = shaderProject('Public gain');
  exposed.field('gain').exposeToOgraf = true;
  exposed.field('offset').properties.forEach((field) => (field.exposeToOgraf = true));
  const definition: TransitionLogicDefinition = {
    version: 4,
    id: 'exposure-logic',
    name: 'Exposure',
    slots: [{ id: 'main', name: 'Main', order: 0 }],
    states: (hiddenFirst ? ['hidden', 'public'] : ['public', 'hidden']).map((id) => ({
      id,
      name: id,
      slotId: 'main',
      templateId: id,
      dataDefaults: { gain: id === 'hidden' ? 7 : 6 },
    })),
    transitions: [
      {
        id: 'cut',
        name: 'Cut',
        durationFrames: 0,
        outgoingFrames: 0,
        incomingStartFrame: 0,
        incomingFrames: 0,
        sharedFrames: 0,
        easing: 'linear',
      },
    ],
    routes: [],
    defaultTransitionId: 'cut',
    sharedInstances: [],
    initialSharedValues: [],
  };
  return {
    id: 'exposure-set',
    name: 'Exposure set',
    definition,
    templates: [
      { id: 'hidden', name: 'Hidden', project: hidden.project },
      { id: 'public', name: 'Public', project: exposed.project },
    ],
    componentAssets: [],
  };
}

/** ograf-form's validator visits every conditional branch and requires an explicit type. */
function expectTypedFormSchemas(schema: unknown): void {
  if (!schema || typeof schema !== 'object') return;
  const node = schema as Record<string, unknown>;
  expect(typeof node.type, JSON.stringify(node)).toBe('string');
  for (const child of Object.values((node.properties ?? {}) as Record<string, unknown>))
    expectTypedFormSchemas(child);
  if (node.items) expectTypedFormSchemas(node.items);
  for (const key of ['if', 'then', 'else']) if (node[key]) expectTypedFormSchemas(node[key]);
  for (const key of ['allOf', 'anyOf', 'oneOf']) {
    if (node[key]) expect((node[key] as unknown[]).length).toBeGreaterThan(0);
    for (const child of (node[key] ?? []) as unknown[]) expectTypedFormSchemas(child);
  }
}

describe('public OGraf field exposure compilation', () => {
  it('omits hidden generated parameters and nested axes from schema, defaults and required', () => {
    const { composition } = shaderProject();
    const schema = compileDataSchema(composition);
    expect(schema.properties).not.toHaveProperty('gain');
    expect(schema.required).not.toContain('gain');
    expect(schema.properties.offset).toMatchObject({
      default: { y: 0.75 },
      required: ['y'],
      properties: { y: { type: 'number' } },
    });
    expect(schema.properties.offset!.properties).not.toHaveProperty('x');
    expect(schema.properties.tint).toMatchObject({ default: '#336699' });
  });

  it('keeps internal defaults, ownership, bindings, animation and Rules intact', () => {
    const { composition, layer, field } = shaderProject();
    const before = structuredClone(composition);
    const descriptor = compileDescriptor(composition);
    expect(descriptor.dataDefaults).toMatchObject({ gain: 2, offset: { x: 0.25, y: 0.75 } });
    expect(descriptor.dataExposure).toMatchObject({ gain: { exposed: false } });
    expect(descriptor.sourceDataFields?.find((entry) => entry.key === 'gain')).toMatchObject({
      exposeToOgraf: false,
      generatedShaderParameter: { name: 'gain', layerId: layer.id },
    });
    expect(descriptor.layers[0]!.bindings).toContainEqual({
      dataKey: 'gain',
      targetProperty: 'fill.parameters.gain',
    });
    expect(descriptor.layers[0]!.animationTracks['fill.parameters.gain']).toEqual(
      layer.animationTracks['fill.parameters.gain'],
    );
    expect(descriptor.layers[0]!.visualRules![0]!.actions[0]).toMatchObject({
      type: 'set-data',
      fieldId: field('gain').id,
      dataKey: 'gain',
      value: 3,
    });
    expect(composition).toEqual(before);
  });

  it('retains hidden object and array descendants internally without publishing their defaults', () => {
    const { composition } = shaderProject();
    composition.dataFields.push(
      createFieldDefinition('array', {
        key: 'rows',
        required: true,
        items: createFieldDefinition('object', {
          properties: [
            createFieldDefinition('text', { key: 'title', defaultValue: '', required: true }),
            createFieldDefinition('number', {
              key: 'gain',
              defaultValue: 5,
              exposeToOgraf: false,
              required: true,
            }),
          ],
        }),
        defaultValue: [{ title: 'A', gain: 8 }],
      }),
    );
    const schema = compileDataSchema(composition);
    expect(schema.properties.rows).toMatchObject({
      default: [{ title: 'A' }],
      items: { required: ['title'] },
    });
    expect(schema.properties.rows!.items!.properties).not.toHaveProperty('gain');
    expect(compileDescriptor(composition).dataDefaults!.rows).toEqual([{ title: 'A', gain: 8 }]);
    composition.dataFields.at(-1)!.items!.exposeToOgraf = false;
    expect(compileDataSchema(composition).properties).not.toHaveProperty('rows');
  });

  it('keeps legacy all-public descriptors free of exposure metadata', () => {
    const { composition, field } = shaderProject();
    delete field('gain').exposeToOgraf;
    delete field('offset').properties[0]!.exposeToOgraf;
    const descriptor = compileDescriptor(composition);
    expect(descriptor.dataExposure).toBeUndefined();
    expect(descriptor.dataDefaults).toBeUndefined();
    expect(descriptor.sourceDataFields).toBeUndefined();
    expect(compileDataSchema(composition).properties).toHaveProperty('gain');
  });

  it('builds a valid standalone package and preserves private resource defaults for recovery', () => {
    const { project, composition } = shaderProject();
    const asset = createAsset({
      name: 'Private texture',
      kind: 'image',
      mimeType: 'image/svg+xml',
      dataUri: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
      packagePath: 'texture.svg',
    });
    composition.assets.push(asset);
    composition.dataFields.push(
      createFieldDefinition('image-url', {
        key: 'internalImage',
        exposeToOgraf: false,
        defaultValue: `asset:${asset.id}`,
      }),
    );
    const result = buildExportArtifactsWithRuntime(project, composition, 'class GraphicElement {}');
    expect(result.projectErrors).toEqual([]);
    expect(result.manifestErrors).toEqual([]);
    expect(validateManifest(result.manifest).errors).toEqual([]);
    expect((result.manifest.schema as { properties: object }).properties).not.toHaveProperty(
      'gain',
    );
    expect(
      result.descriptor!.sourceDataFields!.find((entry) => entry.key === 'internalImage')!
        .defaultValue,
    ).toBe('texture.svg');
    expect(result.descriptor!.dataDefaults!.internalImage).toBe('texture.svg');
    expect(result.mainJs).toContain('resolveExternalData(data, current)');
    expect(result.mainJs).toContain('this.filterPublicData(data, current)');
  });

  it('keeps Off-lane operator examples empty when every field is internal', () => {
    const input = coordinated();
    input.definition.slots.unshift({ id: 'parent', name: 'Parent', order: -1 });
    input.definition.slots.find((slot) => slot.id === 'main')!.admission = {
      requireOnSlotIds: ['parent'],
    };
    for (const template of input.templates)
      for (const field of template.project.compositions[0]!.dataFields) field.exposeToOgraf = false;
    const result = buildCoordinatedExportArtifactsWithRuntime(
      input,
      'class CoordinatedGraphicElement {}',
    );
    expect(result.projectErrors).toEqual([]);
    expect(result.manifestErrors).toEqual([]);
    expect(result.valid).toBe(true);
    expectTypedFormSchemas(result.manifest.schema);
    for (const action of result.manifest.customActions ?? []) expectTypedFormSchemas(action.schema);
    const patch = result.manifest.customActions!.find(
      (action) => action.id === 'transition.patch',
    )!;
    const validatePatch = new Ajv2020({ strict: false, allErrors: true }).compile(patch.schema!);
    expect(validatePatch({ slotId: 'parent', stateId: '', data: {} })).toBe(true);
    expect(validatePatch({ slotId: 'parent', stateId: 'hidden', data: {} })).toBe(false);
    expect(validatePatch({ slotId: 'main', stateId: 'hidden', data: {} })).toBe(true);
    expect(validatePatch({ slotId: 'main', stateId: 'hidden', data: { gain: 7 } })).toBe(false);
    expect(result.transitionDescriptor!.dataDefaults!.slots.main).toMatchObject({
      stateId: null,
      data: { gain: 7 },
    });
    const schema = result.manifest.schema as { default: { slots: { main: { data: unknown } } } };
    expect(schema.default.slots.main.data).toEqual({});
    const readme = String(result.resources.find((resource) => resource.path === 'README.md')!.data);
    const examples = [...readme.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) =>
      JSON.parse(match[1]!),
    );
    expect(examples[0].slots.main.data).toEqual({});
    expect(examples[1].payload.data).toEqual({});
  });

  it.each([true, false])(
    'uses selected-state public schemas without leaking defaults (hiddenFirst=%s)',
    (hiddenFirst) => {
      const result = buildCoordinatedExportArtifactsWithRuntime(
        coordinated(hiddenFirst),
        'class CoordinatedGraphicElement {}',
      );
      expect(result.projectErrors).toEqual([]);
      expect(result.manifestErrors).toEqual([]);
      expect(result.valid).toBe(true);
      const schema = result.manifest.schema as Record<string, unknown>;
      expectTypedFormSchemas(schema);
      expectTypedFormSchemas(
        result.manifest.customActions!.find((action) => action.id === 'transition.take')!.schema,
      );
      const slots = (
        schema.properties as { slots: { properties: Record<string, Record<string, unknown>> } }
      ).slots;
      const lane = slots.properties.main!;
      const baseData = (lane.properties as { data: { properties: object } }).data;
      expect(baseData.properties).not.toHaveProperty('gain');
      expect(baseData.properties).not.toHaveProperty('offset');
      const branches = lane.allOf as Array<{
        if: { properties: { stateId: { const: string } } };
        then: { properties: { data: { properties: object; required: string[]; default: object } } };
      }>;
      const privateBranch = branches.find(
        (branch) => branch.if.properties.stateId.const === 'hidden',
      )!.then.properties.data;
      const publicBranch = branches.find(
        (branch) => branch.if.properties.stateId.const === 'public',
      )!.then.properties.data;
      expect(privateBranch.properties).not.toHaveProperty('gain');
      expect(privateBranch.default).not.toHaveProperty('gain');
      expect(privateBranch.required).not.toContain('gain');
      expect(publicBranch.properties).toHaveProperty('gain');
      expect(publicBranch.default).toMatchObject({ gain: 6 });
      const validate = new Ajv2020({ strict: false, allErrors: true }).compile(schema);
      expect(
        validate({
          slots: { main: { stateId: 'hidden', data: { offset: { y: 0.5 }, tint: '#336699' } } },
        }),
        JSON.stringify(validate.errors),
      ).toBe(true);
      expect(
        validate({
          slots: {
            main: { stateId: 'hidden', data: { gain: 99, offset: { y: 0.5 }, tint: '#336699' } },
          },
        }),
      ).toBe(false);
      expect(
        validate({
          slots: {
            main: {
              stateId: 'public',
              data: { gain: 6, offset: { x: 0.5, y: 0.5 }, tint: '#336699' },
            },
          },
        }),
        JSON.stringify(validate.errors),
      ).toBe(true);
      expect(
        result.transitionDescriptor!.templates.find((entry) => entry.id === 'hidden')!.descriptor
          .dataDefaults!.gain,
      ).toBe(2);
      expect(result.mainJs).toContain('this.filterPublicTemplateData(templateId, data, current)');
      const readme = String(
        result.resources.find((resource) => resource.path === 'README.md')!.data,
      );
      const example = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(readme)![1]!);
      if (hiddenFirst) expect(example.slots.main.data).not.toHaveProperty('gain');
      else expect(example.slots.main.data).toMatchObject({ gain: 6 });
    },
  );
});
