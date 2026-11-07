import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createAsset,
  createCustomActionDefinition,
  createFieldDefinition,
  createImageLayer,
  createLayerKeyframe,
  createLayerLoopClip,
  createLayerOfKind,
  createMediaPaint,
  createLayerVisualRule,
  createMediaCue,
  applyElementDataValue,
  compositionWithShaderParameterFields,
  getElementShaderPaint,
  valueAtSourcePath,
  clockTimerActionId,
  defaultTransformFor,
  normalizeClockTimerSettings,
  type ComponentDefinition,
  type Composition,
  type LayerVisualRule,
  type Project,
  type TransitionLogicDefinition,
} from '@ograf-editor/scene-model';
import type { CompiledTransitionLogicDescriptor } from '@ograf-editor/ograf-types';
import {
  buildCoordinatedExportArtifactsWithRuntime,
  type CoordinatedExportInput,
} from './buildCoordinatedExportArtifacts';
import { EXPORTED_RESOURCE_URLS_KEY, validatePackageLayout } from './buildExportArtifacts';
import { BUILT_IN_EXPORT_PROFILES } from './exportProfiles';
import {
  STUDIO_RUNTIME_LICENSE_PATH,
  STUDIO_RUNTIME_LICENSE_TEXT,
  STUDIO_RUNTIME_NOTICE,
} from './runtimeLicenses';

const runtime = readFileSync(
  new URL('../../ograf-runtime/dist/graphic-runtime.js', import.meta.url),
  'utf8',
);
const runtimeStub = 'class CoordinatedGraphicElement {}';
const schema = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`../../../fixtures/ograf-schema/${name}`, import.meta.url), 'utf8'),
  );
const ajv = new Ajv2020({ strict: false, allErrors: true });
const schemaBase = 'https://ograf.ebu.io/v1/specification/json-schemas';
for (const [file, path] of [
  ['number', 'lib/constraints/number'],
  ['boolean', 'lib/constraints/boolean'],
  ['gdd-basic-types', 'gdd/basic-types'],
  ['gdd-types', 'gdd/gdd-types'],
  ['gdd-object', 'gdd/object'],
  ['action', 'lib/action'],
])
  ajv.addSchema(schema(`${file}.json`), `${schemaBase}/${path}.json`);
const validateOfficialManifest = ajv.compile(schema('graphics-schema.json'));

// Integration fixtures live in the editor, whose TypeScript settings differ from codegen's.
// Load them through Vitest without bringing the entire editor into codegen's rootDir.
interface NewsSet {
  id: string;
  name: string;
  transitionLogic?: TransitionLogicDefinition;
  templates: Array<{ id: string; name: string; project: Project }>;
}
let createTransitionLogicNewsExample: (referenceTime: number) => NewsSet;
let componentLibraryFromTemplates: (set: NewsSet) => ComponentDefinition[];
let resolveProjectSetTemplate: (set: NewsSet, templateId: string) => Project;
beforeAll(async () => {
  const load = (path: string) => import(/* @vite-ignore */ new URL(path, import.meta.url).href);
  ({ createTransitionLogicNewsExample } = await load(
    '../../../apps/editor/src/examples/transitionLogicNews.ts',
  ));
  ({ componentLibraryFromTemplates } = await load(
    '../../../apps/editor/src/state/componentSetLibrary.ts',
  ));
  ({ resolveProjectSetTemplate } = await load('../../../apps/editor/src/state/projectSet.ts'));
});

function newsInput(): CoordinatedExportInput {
  const set = createTransitionLogicNewsExample(1_700_000_000_000);
  return {
    id: set.id,
    name: set.name,
    definition: set.transitionLogic!,
    templates: set.templates.map((template) => ({
      id: template.id,
      name: template.name,
      project: resolveProjectSetTemplate(set, template.id),
    })),
    componentAssets: componentLibraryFromTemplates(set),
  };
}

function firstComposition(input: CoordinatedExportInput): Composition {
  const project = input.templates[0]!.project;
  return project.compositions.find((composition) => composition.id === project.mainCompositionId)!;
}

function resourcesInput() {
  const input = newsInput();
  const composition = firstComposition(input);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><title>News ö</title></svg>';
  const asset = createAsset({
    id: 'network-logo',
    name: 'Network logo',
    mimeType: 'image/svg+xml',
    dataUri: `data:image/svg+xml,${encodeURIComponent(svg)}`,
    packagePath: 'images/logo.svg',
  });
  composition.assets.push(asset);
  const image = createImageLayer();
  image.keyframes = [createLayerKeyframe(0, defaultTransformFor('image'))];
  if (image.element.type !== 'image') throw new Error('Expected image');
  image.element.src = `asset:${asset.id}`;
  const field = createFieldDefinition('array', {
    key: 'items',
    items: createFieldDefinition('object', {
      properties: [
        createFieldDefinition('image-url', { key: 'icon', defaultValue: `asset:${asset.id}` }),
        createFieldDefinition('text', { key: 'caption', defaultValue: 'images/logo.svg' }),
      ],
    }),
    defaultValue: [{ icon: `asset:${asset.id}`, caption: 'images/logo.svg' }],
  });
  composition.dataFields.push(field);
  composition.layers.push(image);
  return { input, svg, path: 'templates/0/images/logo.svg' };
}

function evaluateResourceWrapper(mainJs: string, moduleUrl: string) {
  return new Function(
    mainJs
      .replaceAll('import.meta.url', JSON.stringify(moduleUrl))
      .replace('export default ExportedCoordinatedGraphic;', 'return ExportedCoordinatedGraphic;'),
  )() as {
    new (): { resolveTemplateData(templateId: string, data: unknown): unknown };
    transitionDescriptor: CompiledTransitionLogicDescriptor;
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('coordinated news export', () => {
  it('declares root controls and live textures in ordinary coordinated HTML exports', () => {
    const input = newsInput();
    const composition = firstComposition(input);
    const layer = createLayerOfKind('rectangle');
    if (!('fill' in layer.element)) throw new Error('Expected fill');
    layer.element.fill = createMediaPaint({ source: { kind: 'live', tag: 'TextureInput1' } });
    composition.layers.push(layer);
    const result = buildCoordinatedExportArtifactsWithRuntime(input, runtimeStub);
    expect(result.nodosInputContract).toMatchObject({
      inputs: [
        { name: 'slots', type: 'nos.Dict' },
        { name: 'TextureInput1', type: 'nos.sys.vulkan.Texture' },
      ],
    });
  });
  it('includes one unmodified Studio runtime license for the entire multi-template package', () => {
    const result = buildCoordinatedExportArtifactsWithRuntime(newsInput(), runtimeStub);
    expect(result.valid, result.errors.join('\n')).toBe(true);
    const licenses = result.resources.filter(
      (resource) => resource.path === STUDIO_RUNTIME_LICENSE_PATH,
    );
    expect(licenses).toEqual([
      {
        path: STUDIO_RUNTIME_LICENSE_PATH,
        data: STUDIO_RUNTIME_LICENSE_TEXT,
        base64: false,
        mimeType: 'text/plain',
      },
    ]);
    expect(result.mainJs.startsWith(STUDIO_RUNTIME_NOTICE)).toBe(true);
    expect(validatePackageLayout(result)).toEqual([]);
  });

  it.each([
    'LICENSES/ograf-studio-agpl-3.0.txt',
    'licenses/OGRAF-STUDIO-AGPL-3.0.txt/image.png',
    'LICENSES',
  ])('rejects a resource colliding with the reserved Studio license path: %s', (path) => {
    const result = buildCoordinatedExportArtifactsWithRuntime(newsInput(), runtimeStub);
    result.resources.push({ path, data: 'unrelated', base64: false });
    expect(validatePackageLayout(result).join('\n')).toContain(
      'conflicts with the Studio runtime license path',
    );
  });
  it('exports realtime keyboard Rules without rejecting their trigger or losing its configuration', () => {
    const input = newsInput();
    const composition = input.templates[0]!.project.compositions[0]!;
    const owner = createLayerOfKind('rectangle');
    owner.name = 'Keyboard commands';
    owner.keyframes = [createLayerKeyframe(0, defaultTransformFor('rectangle'))];
    owner.visualRules = [
      createLayerVisualRule({
        trigger: 'key-up',
        keyboard: { key: 'Escape', shift: true },
        delayFrames: 5,
        actions: [{ type: 'toggle-visibility', targetLayerId: owner.id, transitionFrames: 4 }],
      }),
    ];
    composition.layers.push(owner);
    const result = buildCoordinatedExportArtifactsWithRuntime(input, runtimeStub);
    expect(result.valid, result.errors.join('\n')).toBe(true);
    expect(
      result.transitionDescriptor!.templates[0]!.descriptor.layers.find(
        (layer) => layer.id === owner.id,
      )?.visualRules?.[0],
    ).toMatchObject({
      trigger: 'key-up',
      keyboard: { key: 'Escape', shift: true },
      delayFrames: 5,
      actions: [{ type: 'toggle-visibility', targetLayerId: owner.id, transitionFrames: 4 }],
    });
  });
  it('preserves a cross-lane takeover policy in compiled output and rejects missing lanes', () => {
    const input = newsInput();
    const incoming = input.definition.states.find((state) => state.id === 'breaking')!;
    incoming.takeOutSlotIds = ['ticker'];
    const before = structuredClone(input);
    const result = buildCoordinatedExportArtifactsWithRuntime(input, runtimeStub);
    expect(result.valid, result.errors.join('\n')).toBe(true);
    expect(
      result.transitionDescriptor!.definition.states.find((state) => state.id === 'breaking'),
    ).toMatchObject({ takeOutSlotIds: ['ticker'] });
    expect(result.mainJs).toContain('takeOutSlotIds');
    expect(input).toEqual(before);

    incoming.takeOutSlotIds = ['missing-lane'];
    expect(() => buildCoordinatedExportArtifactsWithRuntime(input, runtimeStub)).toThrow(
      /missing-lane/,
    );
  });

  it.each(BUILT_IN_EXPORT_PROFILES)(
    'compiles the news example with the actual runtime for $name',
    (profile) => {
      const input = newsInput();
      const before = structuredClone(input);
      const artifacts = buildCoordinatedExportArtifactsWithRuntime(input, runtime, profile);
      expect(artifacts.errors).toEqual([]);
      expect(artifacts.valid).toBe(true);
      expect(
        validateOfficialManifest(artifacts.manifest),
        JSON.stringify(validateOfficialManifest.errors),
      ).toBe(true);
      expect(validatePackageLayout(artifacts)).toEqual([]);
      expect(artifacts.mainJs.startsWith(`${STUDIO_RUNTIME_NOTICE}\n${runtime}`)).toBe(true);
      expect(artifacts.mainJs).toContain(
        'class ExportedCoordinatedGraphic extends CoordinatedGraphicElement',
      );
      expect(artifacts.manifest).toMatchObject({
        id: `${input.id}${profile.graphicIdSuffix}`,
        supportsRealTime: profile.mode !== 'non-realtime',
        supportsNonRealTime: profile.mode !== 'realtime',
        main: 'main.js',
        stepCount: 1,
      });
      expect(artifacts.transitionDescriptor).toMatchObject({
        id: artifacts.manifest.id,
        width: 1920,
        height: 1080,
        frameRate: 50,
      });
      expect(input).toEqual(before);
    },
  );

  it('preserves all state mappings, shared sources, exposed data, shader, and rolling clock', () => {
    const input = newsInput();
    const result = buildCoordinatedExportArtifactsWithRuntime(input, runtime);
    const descriptor = result.transitionDescriptor!;
    expect(descriptor.definition).toEqual(input.definition);
    expect(descriptor.templates.map((template) => template.id)).toEqual(
      input.templates.map((template) => template.id),
    );
    expect(descriptor.sharedInstances).toHaveLength(3);
    const sharedLayers = descriptor.sharedInstances.flatMap(
      (instance) => instance.descriptor.layers,
    );
    expect(sharedLayers.find((layer) => layer.id === 'news-glass')?.element).toMatchObject({
      fill: { type: 'shader' },
    });
    expect(sharedLayers.find((layer) => layer.id === 'news-clock')?.element).toMatchObject({
      clock: { timeZone: 'UTC', format: 'hh:mm:ss' },
      textAnimation: { type: 'roll-up' },
    });
    for (const template of descriptor.templates.filter(
      (item) => item.id !== 'news-template-ticker',
    )) {
      expect(template.sharedLayers).toHaveLength(6);
      expect(template.sharedDataBindings).toHaveLength(3);
      expect(template.dataDefaults?.headline).toBe('WORLD LEADERS AGREE ON CLIMATE FRAMEWORK');
    }
    expect(
      descriptor.templates.find((item) => item.id === 'news-template-ticker')?.sharedLayers,
    ).toEqual([]);
    expect(result.manifest.customActions?.map((action) => action.id)).toEqual([
      'transition.patch',
      'transition.take',
      'transition.out',
      'transition.clear',
    ]);
    const guide = result.resources.find((resource) => resource.path === 'README.md')!.data;
    for (const state of input.definition.states) expect(guide).toContain(JSON.stringify(state.id));
    expect(guide).toContain('goToTime');
    expect(guide).toContain('setActionsSchedule');
    expect(result.manifest.renderRequirements?.[0]?.accessToPublicInternet).toEqual({
      exact: false,
    });
  });

  it('builds offline per-state forms from public fields and named-state presets only', () => {
    const input = newsInput();
    input.definition.version = 4;
    const first = input.definition.states.find(
      (state) => state.templateId === input.templates[0]!.id,
    )!;
    const second = input.definition.states.find(
      (state) => state.templateId === input.templates[1]!.id,
    )!;
    firstComposition(input).dataFields.push(
      createFieldDefinition('text', {
        key: 'internal_only',
        defaultValue: 'private',
        exposeToOgraf: false,
      }),
      createFieldDefinition('text', { key: 'first_only', defaultValue: 'First default' }),
    );
    const other = input.templates[1]!.project.compositions.find(
      (composition) => composition.id === input.templates[1]!.project.mainCompositionId,
    )!;
    other.dataFields.push(
      createFieldDefinition('text', { key: 'second_only', defaultValue: 'Second default' }),
    );
    first.dataDefaults = { ...first.dataDefaults, first_only: 'First preset' };
    const result = buildCoordinatedExportArtifactsWithRuntime(input, runtimeStub);
    expect(result.valid, result.errors.join('\n')).toBe(true);
    const a = result.offlinePreviewStateSchemas![first.slotId]![first.id]! as {
      properties: Record<string, unknown>;
      default: Record<string, unknown>;
    };
    const b = result.offlinePreviewStateSchemas![second.slotId]![second.id]! as {
      properties: Record<string, unknown>;
    };
    expect(a.properties).toHaveProperty('first_only');
    expect(a.properties).not.toHaveProperty('internal_only');
    expect(a.default).toMatchObject({ first_only: 'First preset' });
    expect(a.default).not.toHaveProperty('internal_only');
    expect(b.properties).toHaveProperty('second_only');
    expect(b.properties).not.toHaveProperty('first_only');
    expect(validateOfficialManifest(result.manifest)).toBe(true);
  });

  it('produces repeatable artifacts from the same resolved snapshot', () => {
    const input = newsInput();
    expect(buildCoordinatedExportArtifactsWithRuntime(input, runtimeStub)).toEqual(
      buildCoordinatedExportArtifactsWithRuntime(input, runtimeStub),
    );
  });

  it('publishes sparse in-place data patches with valid lane defaults and no field-default overwrite', () => {
    const input = newsInput();
    const field = firstComposition(input).dataFields[0]!;
    field.required = true;
    const result = buildCoordinatedExportArtifactsWithRuntime(input, runtimeStub);
    expect(result.valid, result.errors.join('\n')).toBe(true);
    expect(
      validateOfficialManifest(result.manifest),
      JSON.stringify(validateOfficialManifest.errors),
    ).toBe(true);
    const action = result.manifest.customActions!.find((item) => item.id === 'transition.patch')!;
    const schema = action.schema as {
      properties: { slotId: { default: string }; stateId: { default: string } };
      allOf: Array<{
        if: { properties: { slotId: { const: string } } };
        then: {
          allOf: Array<{
            if: { properties: { stateId: { const: string } } };
            then: {
              properties: {
                data: {
                  required?: string[];
                  default: unknown;
                  properties: Record<string, { default?: unknown }>;
                };
              };
            };
          }>;
        };
      }>;
    };
    const check = ajv.compile(action.schema!);
    expect(
      check({
        slotId: schema.properties.slotId.default,
        stateId: schema.properties.stateId.default,
        data: {},
      }),
    ).toBe(true);
    const state = input.definition.states.find(
      (state) => state.templateId === input.templates[0]!.id,
    )!;
    expect(check({ slotId: state.slotId, stateId: state.id, data: {} })).toBe(true);
    expect(
      check({ slotId: state.slotId, stateId: state.id, data: { [field.key]: 'Patched only' } }),
    ).toBe(true);
    expect(check({ slotId: state.slotId, stateId: state.id, data: { [field.key]: 123 } })).toBe(
      false,
    );
    const otherLaneState = input.definition.states.find((other) => other.slotId !== state.slotId)!;
    expect(check({ slotId: state.slotId, stateId: otherLaneState.id, data: {} })).toBe(false);
    const branch = schema.allOf
      .find((entry) => entry.if.properties.slotId.const === state.slotId)!
      .then.allOf.find((entry) => entry.if.properties.stateId.const === state.id)!.then.properties
      .data;
    expect(branch.required).toBeUndefined();
    expect(branch.default).toEqual({});
    expect(
      Object.values(branch.properties).every((property) => !Object.hasOwn(property, 'default')),
    ).toBe(true);
    expect(result.manifest.actionDurations).toContainEqual({
      type: 'customAction',
      customActionId: 'transition.patch',
      duration: 0,
    });
  });

  it('keeps placement binding overrides in one retained source without leaking profiles', () => {
    const input = newsInput();
    const source = input.componentAssets.find((asset) => asset.id === 'news-brand-asset')!;
    const tile = source.layers.find((layer) => layer.id === 'news-brand-tile')!;
    const canonical = createFieldDefinition('color', {
      id: 'canonical-accent',
      key: 'canonicalAccent',
      defaultValue: '#112233',
    });
    source.dataFields.push(canonical);
    tile.bindings = [{ fieldId: canonical.id, targetProperty: 'fill' }];
    const placements = input.templates.flatMap((template) => {
      const composition = template.project.compositions.find(
        (candidate) => candidate.id === template.project.mainCompositionId,
      )!;
      const layer = composition.layers.find(
        (candidate) => candidate.componentLink?.sourceLayerId === tile.id,
      );
      return layer ? [{ template, composition, layer }] : [];
    });
    expect(placements).toHaveLength(3);
    const first = placements[0]!;
    const second = placements[1]!;
    const third = placements[2]!;
    const nested = createFieldDefinition('object', {
      id: 'placement-palette',
      key: 'paletteA',
      defaultValue: { tone: 'warm' },
      properties: [
        createFieldDefinition('text', { id: 'placement-tone', key: 'tone', defaultValue: 'warm' }),
      ],
    });
    const alternate = createFieldDefinition('text', {
      id: 'alternate-palette',
      key: 'paletteB',
      defaultValue: 'cool',
    });
    first.composition.dataFields.push(nested);
    first.layer.bindings = [
      {
        fieldId: nested.id,
        targetProperty: 'fill',
        sourcePath: ['tone'],
        valueMap: { warm: '#ff0000' },
      },
    ];
    second.composition.dataFields.push(alternate);
    second.layer.bindings = [
      { fieldId: alternate.id, targetProperty: 'fill', valueMap: { cool: '#00ff00' } },
    ];
    // Intentional instance override: no binding, so the authored component fill is restored.
    third.layer.bindings = [];
    const before = structuredClone(input);
    const result = buildCoordinatedExportArtifactsWithRuntime(input, runtimeStub);
    expect(result.valid, result.errors.join('\n')).toBe(true);
    const descriptor = result.transitionDescriptor!;
    const shared = descriptor.sharedInstances.find(
      (item) => item.id === 'news-brand-asset-on-air',
    )!;
    expect(descriptor.sharedInstances).toHaveLength(3);
    expect(shared.descriptor.layers).toHaveLength(source.layers.length);
    const compiled = shared.descriptor.layers.find((layer) => layer.id === tile.id)!;
    expect(compiled.bindings).toHaveLength(2);
    expect(
      compiled.bindings.every((binding) => binding.dataKey.startsWith('__ograf_shared_binding_')),
    ).toBe(true);
    expect(Object.keys(shared.dataDefaults!)).toEqual(['canonicalAccent']);
    expect(JSON.stringify(result.manifest.schema)).not.toContain('__ograf_shared_binding_');
    const resolve = (id: string) => {
      const template = descriptor.templates.find((candidate) => candidate.id === id)!;
      const fields = template.sharedDataBindings.find(
        (item) => item.instanceId === shared.id,
      )!.fields;
      const data = { ...shared.dataDefaults };
      for (const [from, to] of Object.entries(fields))
        if (Object.hasOwn(template.dataDefaults!, to)) data[from] = template.dataDefaults![to];
      const element = compiled.bindings.reduce((element, binding) => {
        const value = valueAtSourcePath(data[binding.dataKey], binding.sourcePath);
        return value === undefined
          ? element
          : applyElementDataValue(
              element,
              binding.targetProperty,
              binding.valueMap?.[String(value)] ?? value,
            );
      }, compiled.element);
      return { element, data };
    };
    expect(resolve(first.template.id).element).toMatchObject({ fill: '#ff0000' });
    expect(resolve(second.template.id).element).toMatchObject({ fill: '#00ff00' });
    expect(resolve(third.template.id).element).toMatchObject({ fill: '#b91635' });
    expect(
      Object.keys(resolve(third.template.id).data).some((key) =>
        key.startsWith('__ograf_shared_binding_'),
      ),
    ).toBe(false);
    expect(input).toEqual(before);
    expect(buildCoordinatedExportArtifactsWithRuntime(input, runtimeStub)).toEqual(result);
  });

  it('retains shader parameter instance bindings without creating public transport controls', () => {
    const input = newsInput();
    const panelLayers = [
      ...input.componentAssets.flatMap((asset) => asset.layers),
      ...input.templates.flatMap((template) =>
        template.project.compositions.flatMap((item) => item.layers),
      ),
    ].filter(
      (layer) => layer.id === 'news-glass' || layer.componentLink?.sourceLayerId === 'news-glass',
    );
    for (const layer of panelLayers) {
      const paint = getElementShaderPaint(layer.element)!;
      paint.fragmentSource = `#pragma ograf tint color\nconst vec3 tint = vec3(0.1, 0.2, 0.3);\n${paint.fragmentSource}`;
    }
    const composition = compositionWithShaderParameterFields(firstComposition(input));
    const project = input.templates[0]!.project;
    project.compositions = project.compositions.map((candidate) =>
      candidate.id === composition.id ? composition : candidate,
    );
    const panel = composition.layers.find(
      (layer) => layer.componentLink?.sourceLayerId === 'news-glass',
    )!;
    const binding = panel.bindings.find((candidate) =>
      candidate.targetProperty.startsWith('fill.parameters.'),
    )!;
    expect(binding).toBeDefined();
    const field = composition.dataFields.find((candidate) => candidate.id === binding.fieldId)!;
    const custom = {
      ...structuredClone(field),
      id: 'custom-shader-field',
      key: 'customShaderControl',
    };
    delete custom.generatedShaderParameter;
    composition.dataFields.push(custom);
    binding.fieldId = custom.id;
    const before = structuredClone(input);
    const result = buildCoordinatedExportArtifactsWithRuntime(input, runtimeStub);
    expect(result.valid, result.errors.join('\n')).toBe(true);
    const shared = result.transitionDescriptor!.sharedInstances.find(
      (item) => item.id === 'news-panel-asset-on-air',
    )!;
    const compiled = shared.descriptor.layers.find((layer) => layer.id === 'news-glass')!;
    expect(
      compiled.bindings.some(
        (candidate) =>
          candidate.targetProperty === binding.targetProperty &&
          candidate.dataKey.startsWith('__ograf_shared_binding_'),
      ),
    ).toBe(true);
    const template = result.transitionDescriptor!.templates[0]!;
    expect(
      Object.values(
        template.sharedDataBindings.find((item) => item.instanceId === shared.id)!.fields,
      ),
    ).toContain(custom.key);
    expect(JSON.stringify(result.manifest.schema)).not.toContain('__ograf_shared_binding_');
    expect(compiled.element).toMatchObject({ fill: { type: 'shader' } });
    expect(input).toEqual(before);
  });

  it('excludes unreferenced templates from resources and restrictions', () => {
    const input = newsInput();
    const unused = structuredClone(input.templates[0]!);
    unused.id = 'unused';
    unused.project.compositions[0]!.layers.push(createLayerOfKind('audio'));
    input.templates.push(unused);
    const result = buildCoordinatedExportArtifactsWithRuntime(input, runtimeStub);
    expect(result.errors).toEqual([]);
    expect(result.transitionDescriptor!.templates).toHaveLength(4);
  });

  it.each([
    [
      'media cue',
      (composition: Composition) => composition.mediaCues.push(createMediaCue()),
      'Media cues',
    ],
    [
      'audio layer',
      (composition: Composition) => composition.layers.push(createLayerOfKind('audio')),
      'audio playout',
    ],
    [
      'unassigned chart',
      (composition: Composition) => composition.layers.push(createLayerOfKind('chart')),
      'pinned chart renderer',
    ],
  ] as const)('blocks unsupported %s with an actionable error', (_name, modify, message) => {
    const input = newsInput();
    modify(firstComposition(input));
    const result = buildCoordinatedExportArtifactsWithRuntime(input, runtimeStub);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain(message);
  });

  it('blocks inconsistent template output size and frame rate', () => {
    const input = newsInput();
    input.templates[1]!.project.compositions[0]!.width = 1280;
    input.templates[1]!.project.compositions[0]!.frameRate = 25;
    const result = buildCoordinatedExportArtifactsWithRuntime(input, runtimeStub);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('same output size');
  });

  it('rejects missing references and duplicate identities before compiling', () => {
    const input = newsInput();
    input.definition.states[0]!.templateId = 'missing';
    expect(() => buildCoordinatedExportArtifactsWithRuntime(input, runtimeStub)).toThrow(
      /missing/i,
    );
    input.definition.states[0]!.templateId = input.templates[0]!.id;
    input.templates.push(structuredClone(input.templates[0]!));
    expect(() => buildCoordinatedExportArtifactsWithRuntime(input, runtimeStub)).toThrow(
      'Template IDs must be unique',
    );
  });

  it.each([
    ['delayed data rule', { delayFrames: 5 }, 'delay applies only to event triggers'],
    ['custom action', { actions: [{ type: 'custom-action', actionId: 'missing' }] }, 'missing'],
  ] satisfies Array<[string, Partial<LayerVisualRule>, string]>)(
    'blocks unsupported %s rules',
    (_name, overrides, message) => {
      const input = newsInput();
      const composition = firstComposition(input);
      composition.layers.at(-1)!.visualRules = [
        {
          id: 'unsupported',
          name: 'Unsupported',
          enabled: true,
          fieldId: composition.dataFields[0]!.id,
          sourcePath: [],
          operator: 'not-empty',
          actions: [{ type: 'property', targetProperty: 'opacity', value: 0.5 }],
          ...overrides,
        },
      ];
      const result = buildCoordinatedExportArtifactsWithRuntime(input, runtimeStub);
      expect(result.valid).toBe(false);
      expect(result.errors.join('\n')).toContain(message);
    },
  );

  it('coordinates template actions, local data writes, animated Rules and custom-action Text FX', () => {
    const input = newsInput();
    const composition = firstComposition(input);
    composition.customActions.push(
      createCustomActionDefinition({
        id: 'show-ad-definition',
        actionId: 'show-ad',
        name: 'Show advertising',
      }),
    );
    const field = createFieldDefinition('boolean', { key: 'advertising', defaultValue: false });
    composition.dataFields.push(field);
    const text = createLayerOfKind('text');
    text.keyframes = [createLayerKeyframe(0, defaultTransformFor('text'))];
    if (text.element.type !== 'text') throw new Error('Expected text');
    text.element.textAnimation = {
      type: 'fade',
      split: 'grapheme',
      durationFrames: 10,
      cursor: 'none',
      cursorBlinkFrames: 10,
      replayOnUpdate: false,
      customActionId: 'show-ad',
    };
    text.visualRules = [
      {
        id: 'ad-trigger',
        name: 'Show advertising',
        enabled: true,
        trigger: 'custom-action',
        eventId: 'show-ad',
        fieldId: '',
        sourcePath: [],
        operator: 'not-empty',
        actions: [
          { type: 'set-data', fieldId: field.id, mode: 'set', value: true },
          { type: 'property', targetProperty: 'opacity', value: 0.5, transitionFrames: 10 },
        ],
      },
    ];
    composition.layers.push(text);
    const result = buildCoordinatedExportArtifactsWithRuntime(input, runtimeStub);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.transitionDescriptor!.templates[0]!.descriptor.customActions).toContainEqual(
      expect.objectContaining({ id: 'show-ad', name: 'Show advertising' }),
    );
    expect(result.manifest.customActions).toContainEqual(
      expect.objectContaining({
        id: 'template.action',
        schema: expect.objectContaining({ required: ['slotId', 'actionId'] }),
      }),
    );
    expect(
      validateOfficialManifest(result.manifest),
      JSON.stringify(validateOfficialManifest.errors),
    ).toBe(true);
    const guide = result.resources.find((resource) => resource.path === 'README.md')!.data;
    expect(guide).toContain('template.action');
    expect(guide).toContain('animated rule properties run on the shared frame clock');
  });

  it('advertises executable timer commands with lane-specific defaults and standard OGraf schemas', () => {
    const input = newsInput();
    const addTimer = (
      composition: Composition,
      id: string,
      clock: Parameters<typeof normalizeClockTimerSettings>[0],
      isGuide = false,
    ) => {
      const layer = createLayerOfKind('text');
      layer.id = id;
      layer.name = id;
      layer.isGuide = isGuide;
      layer.keyframes = [createLayerKeyframe(0, defaultTransformFor('text'))];
      if (layer.element.type !== 'text') throw new Error('Expected text');
      layer.element.clock = normalizeClockTimerSettings(clock);
      composition.layers.push(layer);
    };
    const composition = firstComposition(input);
    addTimer(composition, 'program:elapsed', { mode: 'count-up', autoStart: false });
    addTimer(composition, 'manual-feed', { mode: 'count-down', source: 'manual' });
    addTimer(composition, 'wall-clock', { mode: 'clock' });
    addTimer(composition, 'guide-timer', { mode: 'count-up' }, true);
    const ticker = input.templates.find((template) => template.id === 'news-template-ticker')!;
    addTimer(ticker.project.compositions[0]!, 'ticker-remaining', { mode: 'count-down' });

    const before = structuredClone(input);
    const result = buildCoordinatedExportArtifactsWithRuntime(input, runtimeStub);
    expect(result.errors).toEqual([]);
    expect(
      validateOfficialManifest(result.manifest),
      JSON.stringify(validateOfficialManifest.errors),
    ).toBe(true);
    const action = result.manifest.customActions!.find(
      (action) => action.id === 'template.action',
    )!;
    const control = action.schema as {
      properties: { slotId: { default: string }; actionId: { default: string } };
      allOf: Array<{
        if: { properties: { slotId: { const: string } } };
        then: {
          properties: {
            actionId: {
              enum: string[];
              default: string;
              gddOptions: { labels: Record<string, string> };
            };
          };
        };
      }>;
    };
    const lowerThird = control.allOf.find(
      (entry) => entry.if.properties.slotId.const === 'lower-third',
    )!.then.properties.actionId;
    const tickerActions = control.allOf.find(
      (entry) => entry.if.properties.slotId.const === 'ticker',
    )!.then.properties.actionId;
    const validateAction = ajv.compile(action.schema!);
    for (const command of ['start', 'pause', 'reset', 'restart'] as const) {
      const id = clockTimerActionId('program:elapsed', command);
      expect(lowerThird.enum).toContain(id);
      expect(lowerThird.gddOptions.labels[id]).toBe(
        `Correspondent / program:elapsed: ${command[0]!.toUpperCase()}${command.slice(1)}`,
      );
      expect(tickerActions.enum).not.toContain(id);
      expect(validateAction({ slotId: 'lower-third', actionId: id })).toBe(true);
      expect(validateAction({ slotId: 'ticker', actionId: id })).toBe(false);
      expect(tickerActions.enum).toContain(clockTimerActionId('ticker-remaining', command));
    }
    expect(
      validateAction({
        slotId: control.properties.slotId.default,
        actionId: control.properties.actionId.default,
      }),
    ).toBe(true);
    for (const command of ['reset', 'restart'] as const) {
      const id = clockTimerActionId('manual-feed', command);
      expect(lowerThird.enum).toContain(id);
      expect(validateAction({ slotId: 'lower-third', actionId: id })).toBe(true);
      expect(tickerActions.enum).not.toContain(id);
    }
    for (const command of ['start', 'pause'] as const)
      expect(lowerThird.enum).not.toContain(clockTimerActionId('manual-feed', command));
    expect(lowerThird.enum.join(' ')).not.toMatch(/wall-clock|guide-timer/);
    const guide = result.resources.find((resource) => resource.path === 'README.md')!.data;
    expect(guide).toContain('Reset returns to the initial value and stops');
    expect(guide).toContain(
      'Manual count-up/count-down timers expose Reset and Restart to rearm alarms without changing the bound value',
    );
    expect(guide).not.toContain('timer start/pause/reset actions remain unavailable');
    expect(input).toEqual(before);
  });

  it('keeps public proxy timer IDs while resolving executable settings from the retained shared source', () => {
    const input = newsInput();
    const source = input.componentAssets
      .find((asset) => asset.id === 'news-clock-asset')!
      .layers.find((layer) => layer.id === 'news-clock')!;
    if (source.element.type !== 'text') throw new Error('Expected text');
    source.element.clock = normalizeClockTimerSettings({ mode: 'count-up', autoStart: false });
    const result = buildCoordinatedExportArtifactsWithRuntime(input, runtimeStub);
    expect(result.errors).toEqual([]);
    const action = result.manifest.customActions!.find(
      (action) => action.id === 'template.action',
    )!;
    const schemaText = JSON.stringify(action.schema);
    for (const command of ['start', 'pause', 'reset', 'restart'] as const) {
      expect(schemaText).toContain(clockTimerActionId('name-news-clock', command));
      expect(schemaText).toContain(clockTimerActionId('headline-news-clock', command));
      expect(schemaText).not.toContain(`"${clockTimerActionId('news-clock', command)}"`);
      expect(schemaText).not.toContain(
        clockTimerActionId(JSON.stringify(['news-clock-asset-on-air', 'news-clock']), command),
      );
    }
  });

  it('keeps a qualified shared fallback when one state lacks a timer proxy and another preserves its alias', () => {
    const input = newsInput();
    const source = input.componentAssets
      .find((asset) => asset.id === 'news-clock-asset')!
      .layers.find((layer) => layer.id === 'news-clock')!;
    if (source.element.type !== 'text') throw new Error('Expected text');
    source.element.clock = normalizeClockTimerSettings({ mode: 'count-up', autoStart: false });
    firstComposition(input).layers = firstComposition(input).layers.filter(
      (layer) => layer.componentLink?.sourceLayerId !== 'news-clock',
    );
    const result = buildCoordinatedExportArtifactsWithRuntime(input, runtimeStub);
    expect(result.errors).toEqual([]);
    const action = result.manifest.customActions!.find(
      (action) => action.id === 'template.action',
    )!;
    const validateAction = ajv.compile(action.schema!);
    for (const command of ['start', 'pause', 'reset', 'restart'] as const) {
      expect(
        validateAction({
          slotId: 'lower-third',
          actionId: clockTimerActionId(
            JSON.stringify(['news-clock-asset-on-air', 'news-clock']),
            command,
          ),
        }),
      ).toBe(true);
      expect(
        validateAction({
          slotId: 'lower-third',
          actionId: clockTimerActionId('headline-news-clock', command),
        }),
      ).toBe(true);
      expect(
        validateAction({
          slotId: 'lower-third',
          actionId: clockTimerActionId('name-news-clock', command),
        }),
      ).toBe(false);
    }
  });

  it('exposes source timer actions without timer proxies when another shared link activates the instance', () => {
    const input = newsInput();
    const source = input.componentAssets
      .find((asset) => asset.id === 'news-clock-asset')!
      .layers.find((layer) => layer.id === 'news-clock')!;
    if (source.element.type !== 'text') throw new Error('Expected text');
    source.element.clock = normalizeClockTimerSettings({ mode: 'count-down', autoStart: false });
    for (const template of input.templates)
      for (const composition of template.project.compositions)
        composition.layers = composition.layers.filter(
          (layer) => layer.componentLink?.sourceLayerId !== 'news-clock',
        );
    const result = buildCoordinatedExportArtifactsWithRuntime(input, runtimeStub);
    expect(result.errors).toEqual([]);
    const action = result.manifest.customActions!.find(
      (action) => action.id === 'template.action',
    )!;
    const validateAction = ajv.compile(action.schema!);
    for (const command of ['start', 'pause', 'reset', 'restart'] as const) {
      const actionId = clockTimerActionId(
        JSON.stringify(['news-clock-asset-on-air', 'news-clock']),
        command,
      );
      expect(validateAction({ slotId: 'lower-third', actionId })).toBe(true);
      expect(validateAction({ slotId: 'ticker', actionId })).toBe(false);
    }
  });

  it('omits slot-scoped source timers with no shared-layer or data relation to any template', () => {
    const input = newsInput();
    const source = input.componentAssets
      .find((asset) => asset.id === 'news-clock-asset')!
      .layers.find((layer) => layer.id === 'news-clock')!;
    if (source.element.type !== 'text') throw new Error('Expected text');
    source.element.clock = normalizeClockTimerSettings({ mode: 'count-up', autoStart: false });
    for (const template of input.templates)
      for (const composition of template.project.compositions)
        composition.layers = composition.layers.filter(
          (layer) => layer.componentLink?.componentId !== 'news-clock-asset',
        );
    const result = buildCoordinatedExportArtifactsWithRuntime(input, runtimeStub);
    expect(result.errors).toEqual([]);
    expect(result.manifest.customActions!.some((action) => action.id === 'template.action')).toBe(
      false,
    );
  });

  it('gives retained timers from two instances of one source distinct qualified action IDs', () => {
    const input = newsInput();
    const source = input.componentAssets
      .find((asset) => asset.id === 'news-clock-asset')!
      .layers.find((layer) => layer.id === 'news-clock')!;
    if (source.element.type !== 'text') throw new Error('Expected text');
    source.element.clock = normalizeClockTimerSettings({ mode: 'count-up', autoStart: false });
    for (const template of input.templates)
      for (const composition of template.project.compositions)
        composition.layers = composition.layers.filter(
          (layer) => layer.componentLink?.sourceLayerId !== 'news-clock',
        );
    input.definition.sharedInstances.push({
      ...structuredClone(
        input.definition.sharedInstances.find(
          (instance) => instance.id === 'news-clock-asset-on-air',
        )!,
      ),
      id: 'second-clock',
      name: 'Second timer',
      continuityKey: 'second-clock-continuity',
    });
    for (const template of input.templates)
      for (const composition of template.project.compositions) {
        const firstLabel = composition.layers.find(
          (layer) => layer.componentLink?.componentId === 'news-clock-asset',
        );
        if (!firstLabel) continue;
        const secondLabel = structuredClone(firstLabel);
        secondLabel.id = `${firstLabel.id}-second`;
        secondLabel.groupId = `${firstLabel.groupId}-second`;
        secondLabel.componentLink!.instanceId = 'second-clock';
        if (secondLabel.componentLink!.baseline) {
          secondLabel.componentLink!.baseline.id = secondLabel.id;
          secondLabel.componentLink!.baseline.groupId = secondLabel.groupId;
        }
        composition.layers.push(secondLabel);
      }
    const result = buildCoordinatedExportArtifactsWithRuntime(input, runtimeStub);
    expect(result.errors).toEqual([]);
    const action = result.manifest.customActions!.find(
      (action) => action.id === 'template.action',
    )!;
    const validateAction = ajv.compile(action.schema!);
    for (const command of ['start', 'pause', 'reset', 'restart'] as const) {
      for (const instanceId of ['news-clock-asset-on-air', 'second-clock'])
        expect(
          validateAction({
            slotId: 'lower-third',
            actionId: clockTimerActionId(JSON.stringify([instanceId, 'news-clock']), command),
          }),
        ).toBe(true);
      expect(
        validateAction({
          slotId: 'lower-third',
          actionId: clockTimerActionId('news-clock', command),
        }),
      ).toBe(false);
    }
  });

  it('keeps collection prototype timer IDs as executable targets for all live rows', () => {
    const input = newsInput();
    const composition = firstComposition(input);
    const layer = createLayerOfKind('text');
    layer.id = 'row-timer';
    layer.groupId = 'timer-item';
    layer.keyframes = [createLayerKeyframe(0, defaultTransformFor('text'))];
    if (layer.element.type !== 'text') throw new Error('Expected text');
    layer.element.clock = normalizeClockTimerSettings({ mode: 'count-up', autoStart: false });
    const field = createFieldDefinition('array', {
      key: 'timers',
      constraints: { minItems: 0, maxItems: 3 },
      items: createFieldDefinition('object', { key: 'item', properties: [] }),
      defaultValue: [{}, {}],
    });
    composition.layers.push(layer);
    composition.dataFields.push(field);
    composition.runtimeCollections.push({
      id: 'timer-collection',
      name: 'Timers',
      fieldId: field.id,
      prototypeLayerIds: [layer.id],
      offsetPerItem: { x: 0, y: 72 },
      capacity: 3,
      overflow: 'truncate',
    });
    const result = buildCoordinatedExportArtifactsWithRuntime(input, runtimeStub);
    expect(result.errors).toEqual([]);
    expect(
      result.transitionDescriptor!.templates[0]!.descriptor.layers.some(
        (entry) => entry.id === layer.id,
      ),
    ).toBe(false);
    const action = result.manifest.customActions!.find(
      (action) => action.id === 'template.action',
    )!;
    const validateAction = ajv.compile(action.schema!);
    for (const command of ['start', 'pause', 'reset', 'restart'] as const)
      expect(
        validateAction({ slotId: 'lower-third', actionId: clockTimerActionId(layer.id, command) }),
      ).toBe(true);
  });

  it('keeps pointer-triggered rules available in coordinated output', () => {
    const input = newsInput();
    firstComposition(input).layers.at(-1)!.visualRules = [
      {
        id: 'pointer',
        name: 'Pointer rule',
        enabled: true,
        trigger: 'click',
        fieldId: '',
        sourcePath: [],
        operator: 'not-empty',
        actions: [{ type: 'property', targetProperty: 'opacity', value: 0.5 }],
      },
    ];
    const result = buildCoordinatedExportArtifactsWithRuntime(input, runtimeStub);
    expect(result.valid, result.errors.join('\n')).toBe(true);
  });

  it('keeps static data rules available', () => {
    const input = newsInput();
    const composition = firstComposition(input);
    composition.layers.at(-1)!.visualRules = [
      {
        id: 'static',
        name: 'Static data rule',
        enabled: true,
        fieldId: composition.dataFields[0]!.id,
        sourcePath: [],
        operator: 'not-empty',
        actions: [{ type: 'property', targetProperty: 'opacity', value: 0.5 }],
      },
    ];
    expect(buildCoordinatedExportArtifactsWithRuntime(input, runtimeStub).errors).toEqual([]);
  });

  it('rejects loops triggered at an unsupported later step', () => {
    const input = newsInput();
    const composition = firstComposition(input);
    composition.layers.at(-1)!.loop = createLayerLoopClip({
      activation: { type: 'step', stepKeyframeId: composition.keyframes.at(-1)!.id },
    });
    const result = buildCoordinatedExportArtifactsWithRuntime(input, runtimeStub);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('loops must activate at the first on-air step');
  });

  it('rejects incompatible public field types within one slot', () => {
    const input = newsInput();
    const field = input.templates[1]!.project.compositions[0]!.dataFields[0]!;
    field.type = 'number';
    field.defaultValue = 12;
    const result = buildCoordinatedExportArtifactsWithRuntime(input, runtimeStub);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('incompatible data field types');
  });

  it('requires a common render mode unless an output profile explicitly supplies it', () => {
    const input = newsInput();
    input.templates[0]!.project.supportsNonRealTime = false;
    input.templates[1]!.project.supportsRealTime = false;
    const result = buildCoordinatedExportArtifactsWithRuntime(input, runtimeStub);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('no common render mode');
    expect(
      buildCoordinatedExportArtifactsWithRuntime(input, runtimeStub, BUILT_IN_EXPORT_PROFILES[0])
        .errors,
    ).toEqual([]);
  });

  it('blocks conflicting fonts with the same family, style, and weight', () => {
    const input = newsInput();
    input.templates.slice(0, 2).forEach((template, index) =>
      template.project.compositions[0]!.assets.push(
        createAsset({
          kind: 'font',
          name: 'News.woff2',
          fontFamily: 'News',
          mimeType: 'font/woff2',
          dataUri: `data:font/woff2;base64,${index ? 'AAAB' : 'AAAA'}`,
        }),
      ),
    );
    const result = buildCoordinatedExportArtifactsWithRuntime(input, runtimeStub);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('conflicts with the same family/style/weight');
  });
});

describe('coordinated package resources', () => {
  it('packages exact image bytes and nested image defaults with template namespaces', () => {
    const { input, svg, path } = resourcesInput();
    const result = buildCoordinatedExportArtifactsWithRuntime(input, runtimeStub);
    expect(result.errors).toEqual([]);
    expect(result.resources).toContainEqual({
      path,
      data: svg,
      mimeType: 'image/svg+xml',
      base64: false,
    });
    expect(result.transitionDescriptor!.templates[0]!.dataDefaults?.items).toEqual([
      { icon: path, caption: 'images/logo.svg' },
    ]);
  });

  it('resolves descriptor and nested operator data against main.js without changing text', () => {
    const { input, path } = resourcesInput();
    const result = buildCoordinatedExportArtifactsWithRuntime(input, runtimeStub);
    const Graphic = evaluateResourceWrapper(
      result.mainJs,
      'https://renderer.example/package/main.js',
    );
    const expected = [{ icon: `https://renderer.example/package/${path}`, caption: path }];
    const data = { items: [{ icon: path, caption: path }] };
    expect(new Graphic().resolveTemplateData(input.templates[0]!.id, data)).toEqual({
      items: expected,
    });
    expect(data.items[0]!.icon).toBe(path);
    expect(Graphic.transitionDescriptor.templates[0]!.dataDefaults?.items).toEqual([
      { icon: `https://renderer.example/package/${path}`, caption: 'images/logo.svg' },
    ]);
    expect(
      Graphic.transitionDescriptor.templates[0]!.descriptor.layers.at(-1)!.element,
    ).toMatchObject({ src: `https://renderer.example/package/${path}` });
  });

  it('uses exact blob resource maps and refuses missing bytes', () => {
    const { input, path } = resourcesInput();
    const result = buildCoordinatedExportArtifactsWithRuntime(input, runtimeStub);
    const url = 'blob:https://renderer.example/package';
    expect(() => evaluateResourceWrapper(result.mainJs, url)).toThrow(
      'Packaged resource is unavailable',
    );
    vi.stubGlobal(EXPORTED_RESOURCE_URLS_KEY, {
      [url]: { [path]: 'blob:https://renderer.example/logo' },
    });
    const Graphic = evaluateResourceWrapper(result.mainJs, url);
    expect(Graphic.transitionDescriptor.templates[0]!.dataDefaults?.items).toEqual([
      { icon: 'blob:https://renderer.example/logo', caption: 'images/logo.svg' },
    ]);
  });

  it('packages image value maps even when the unbound image source is empty', () => {
    const { input, path } = resourcesInput();
    const composition = firstComposition(input);
    const image = composition.layers.at(-1)!;
    if (image.element.type !== 'image') throw new Error('Expected image');
    image.element.src = '';
    const field = createFieldDefinition('select', {
      key: 'network',
      options: [{ value: 'northline', label: 'Northline' }],
      defaultValue: 'northline',
    });
    composition.dataFields.push(field);
    image.bindings = [
      { fieldId: field.id, targetProperty: 'src', valueMap: { northline: 'asset:network-logo' } },
    ];
    const result = buildCoordinatedExportArtifactsWithRuntime(input, runtimeStub);
    expect(result.errors).toEqual([]);
    expect(
      result.transitionDescriptor!.templates[0]!.descriptor.layers.at(-1)!.bindings?.[0]?.valueMap,
    ).toEqual({ northline: path });
    const Graphic = evaluateResourceWrapper(
      result.mainJs,
      'https://renderer.example/package/main.js',
    );
    expect(
      Graphic.transitionDescriptor.templates[0]!.descriptor.layers.at(-1)!.bindings?.[0]?.valueMap,
    ).toEqual({ northline: `https://renderer.example/package/${path}` });
  });

  it('encodes literal archive filenames instead of interpreting query and fragment characters', () => {
    const { input } = resourcesInput();
    const asset = firstComposition(input).assets.find((item) => item.id === 'network-logo')!;
    asset.packagePath = 'images/news #1?50%.svg';
    const result = buildCoordinatedExportArtifactsWithRuntime(input, runtimeStub);
    expect(result.errors).toEqual([]);
    expect(
      result.resources.some((resource) => resource.path === 'templates/0/images/news #1?50%.svg'),
    ).toBe(true);
    const Graphic = evaluateResourceWrapper(
      result.mainJs,
      'https://renderer.example/package/main.js',
    );
    expect(
      Graphic.transitionDescriptor.templates[0]!.descriptor.layers.at(-1)!.element,
    ).toMatchObject({
      src: 'https://renderer.example/package/templates/0/images/news%20%231%3F50%25.svg',
    });
  });

  it.each(['images/missing.png', 'blob:https://editor.example/stale', 'file:///C:/logo.png'])(
    'blocks unpackaged source %s',
    (source) => {
      const input = newsInput();
      const image = createImageLayer();
      if (image.element.type !== 'image') throw new Error('Expected image');
      image.element.src = source;
      firstComposition(input).layers.push(image);
      const result = buildCoordinatedExportArtifactsWithRuntime(input, runtimeStub);
      expect(result.valid).toBe(false);
      expect(result.errors.join('\n')).toContain('not packaged or an absolute HTTP(S)/data URL');
    },
  );

  it('declares external image requirements', () => {
    const input = newsInput();
    firstComposition(input).dataFields.push(
      createFieldDefinition('image-url', {
        key: 'photo',
        defaultValue: 'https://example.com/photo.png',
      }),
    );
    const result = buildCoordinatedExportArtifactsWithRuntime(input, runtimeStub);
    expect(result.errors).toEqual([]);
    expect(result.manifest.renderRequirements?.[0]?.accessToPublicInternet).toEqual({
      exact: true,
    });
  });
});
