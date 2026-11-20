import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  createAsset,
  createFieldDefinition,
  createImageLayer,
  createLayerKeyframe,
  createLayerVisualRule,
  createProject,
  defaultTransformFor,
  type TransitionLogicDefinition,
} from '@ograf-editor/scene-model';
import type { CompiledTransitionLogicDescriptor } from '@ograf-editor/ograf-types';
import {
  buildCoordinatedExportArtifactsWithRuntime,
  type CoordinatedExportInput,
} from './buildCoordinatedExportArtifacts';
import { EXPORTED_RESOURCE_URLS_KEY } from './buildExportArtifacts';
function fixture() {
  const project = createProject({ name: 'Header variants' }),
    composition = project.compositions[0]!;
  composition.dataFields = [
    createFieldDefinition('text', { key: 'label', defaultValue: 'SOURCE' }),
    createFieldDefinition('boolean', { key: 'visible', defaultValue: true }),
    createFieldDefinition('number', { key: 'count', defaultValue: 1 }),
    createFieldDefinition('color', { key: 'color', defaultValue: '#2676ef' }),
  ];
  const definition: TransitionLogicDefinition = {
    version: 4,
    id: 'preset-logic',
    name: 'Preset logic',
    defaultTransitionId: 'fade',
    slots: [{ id: 'header', name: 'Header', order: 0 }],
    states: [
      {
        id: 'developing',
        name: 'Developing',
        slotId: 'header',
        templateId: 'header',
        dataDefaults: { label: 'DEVELOPING', visible: false, color: '#d49b22' },
      },
      {
        id: 'breaking',
        name: 'Breaking',
        slotId: 'header',
        templateId: 'header',
        dataDefaults: { label: 'BREAKING', color: '#be1622' },
      },
    ],
    transitions: [
      {
        id: 'fade',
        name: 'Fade',
        durationFrames: 0,
        outgoingFrames: 0,
        incomingStartFrame: 0,
        incomingFrames: 0,
        sharedFrames: 0,
        easing: 'linear',
      },
    ],
    routes: [],
    sharedInstances: [],
    initialSharedValues: [],
  };
  const input: CoordinatedExportInput = {
    id: 'preset-set',
    name: 'Preset set',
    definition,
    templates: [{ id: 'header', name: 'Header', project }],
    componentAssets: [],
  };
  return { input, composition };
}
function evaluate(mainJs: string, url: string) {
  return new Function(
    mainJs
      .replaceAll('import.meta.url', JSON.stringify(url))
      .replace('export default ExportedCoordinatedGraphic;', 'return ExportedCoordinatedGraphic;'),
  )() as { transitionDescriptor: CompiledTransitionLogicDescriptor };
}
afterEach(() => vi.unstubAllGlobals());
describe('coordinated named-state preset export', () => {
  it('shares binary media while retaining state-only and Rules-only images and real public paths', () => {
    const { input, composition } = fixture();
    const secondProject = createProject({ name: 'Second' });
    const second = secondProject.compositions[0]!;
    const embeddedPreset = 'data:image/png;base64,Yg==';
    const embeddedRule = 'data:image/png;base64,Yw==';
    const embeddedDirect = 'data:image/png;base64,ZA==';
    for (const [index, current] of [composition, second].entries()) {
      const font = createAsset({
        id: `family-${index}`,
        name: 'Family.woff2',
        kind: 'font',
        fontFamily: 'Family',
        mimeType: 'font/woff2',
        dataUri: 'data:font/woff2;base64,d09GMg==',
        licenseText: 'Font license',
      });
      const image = createAsset({
        id: `logo-${index}`,
        name: 'Logo',
        mimeType: 'image/png',
        dataUri: 'data:image/png;base64,YQ==',
        licenseText: 'Logo license',
      });
      const explicit = createAsset({
        ...image,
        id: `explicit-${index}`,
        dataUri: 'data:image/png;base64,ZQ==',
        packagePath: 'custom/logo.png',
      });
      current.assets.push(font, image, explicit);
      current.dataFields.push(
        createFieldDefinition('image-url', { key: 'image', defaultValue: `asset:${image.id}` }),
      );
    }
    input.templates.push({ id: 'secondary', name: 'Secondary', project: secondProject });
    input.definition.slots.push({ id: 'secondary', name: 'Secondary', order: 1 });
    input.definition.states.push({
      id: 'alternate',
      name: 'Alternate',
      slotId: 'secondary',
      templateId: 'secondary',
      dataDefaults: { image: embeddedPreset },
    });
    const source = createImageLayer();
    source.keyframes = [createLayerKeyframe(0, defaultTransformFor('image'))];
    source.visualRules = [
      createLayerVisualRule({
        trigger: 'click',
        actions: [
          { type: 'property', targetProperty: 'src', value: embeddedDirect },
          {
            type: 'playout',
            operation: 'update',
            stateId: 'alternate',
            slotId: 'secondary',
            data: { image: embeddedRule },
          },
        ],
      }),
    ];
    second.layers.push(source);

    const before = structuredClone(input);
    const result = buildCoordinatedExportArtifactsWithRuntime(
      input,
      'class CoordinatedGraphicElement {}',
    );
    expect(result.errors).toEqual([]);
    expect(input).toEqual(before);
    expect(
      buildCoordinatedExportArtifactsWithRuntime(input, 'class CoordinatedGraphicElement {}'),
    ).toEqual(result);
    const paths = result.resources.map((resource) => resource.path);
    expect(paths.filter((path) => path.endsWith('.woff2'))).toEqual([
      'templates/0/assets/family-0.woff2',
    ]);
    expect(paths.filter((path) => /\/assets\/logo-\d.png$/.test(path))).toEqual([
      'templates/0/assets/logo-0.png',
    ]);
    expect(paths).toEqual(
      expect.arrayContaining([
        'templates/0/custom/logo.png',
        'templates/1/custom/logo.png',
        'templates/0/licenses/family-0-LICENSE.txt',
        'templates/1/licenses/family-1-LICENSE.txt',
        'templates/0/licenses/logo-0-LICENSE.txt',
        'templates/1/licenses/logo-1-LICENSE.txt',
      ]),
    );
    const compiled = result.transitionDescriptor!;
    const fontPath = 'templates/0/assets/family-0.woff2';
    const logoPath = 'templates/0/assets/logo-0.png';
    expect(compiled.templates.map(({ descriptor }) => descriptor.fonts![0]!.source)).toEqual([
      fontPath,
      fontPath,
    ]);
    expect(compiled.templates.map(({ dataDefaults }) => dataDefaults!.image)).toEqual([
      logoPath,
      logoPath,
    ]);
    expect(result.manifest.schema?.default).toMatchObject({
      slots: { header: { data: { image: logoPath } } },
    });
    const presetPath = compiled.definition.states.at(-1)!.dataDefaults!.image as string;
    const actions = compiled.templates[1]!.descriptor.layers[0]!.visualRules![0]!.actions;
    const [direct, scheduled] = actions;
    if (direct?.type !== 'property' || scheduled?.type !== 'playout')
      throw new Error('Expected property and playout Rules');
    const directPath = direct.value as string;
    const rulePath = scheduled.data!.image as string;
    expect(result.offlinePreviewStateSchemas!.secondary!.alternate!.default).toEqual({
      image: presetPath,
    });
    for (const [path, data] of [
      [presetPath, 'Yg=='],
      [rulePath, 'Yw=='],
      [directPath, 'ZA=='],
    ]) {
      expect(result.resources.find((resource) => resource.path === path)).toMatchObject({
        data,
        base64: true,
        mimeType: 'image/png',
      });
    }
    for (const uri of [embeddedPreset, embeddedRule, embeddedDirect])
      expect(result.mainJs).not.toContain(uri);
    const moduleUrl = 'blob:https://renderer.example/coordinated';
    const blobUrls = Object.fromEntries(
      paths.map((path, index) => [path, `blob:https://renderer.example/${index}`]),
    );
    vi.stubGlobal(EXPORTED_RESOURCE_URLS_KEY, { [moduleUrl]: blobUrls });
    const resolved = evaluate(result.mainJs, moduleUrl).transitionDescriptor;
    expect(resolved.templates[1]!.descriptor.fonts![0]!.source).toBe(blobUrls[fontPath]);
    expect(resolved.templates[1]!.descriptor.layers[0]!.visualRules![0]!.actions[0]).toMatchObject({
      value: blobUrls[directPath],
    });
    expect(resolved.definition.states.at(-1)!.dataDefaults!.image).toBe(blobUrls[presetPath]);
    const hosted = evaluate(result.mainJs, 'https://renderer.example/main.js').transitionDescriptor;
    expect(hosted.templates[1]!.descriptor.fonts![0]!.source).toBe(
      `https://renderer.example/${fontPath}`,
    );
    expect(hosted.templates[1]!.descriptor.layers[0]!.visualRules![0]!.actions[0]).toMatchObject({
      value: `https://renderer.example/${directPath}`,
    });
  });

  it('rejects nested preset schema violations rather than accepting merely valid JSON', () => {
    const { input, composition } = fixture();
    composition.dataFields.push(
      createFieldDefinition('object', {
        key: 'details',
        properties: [createFieldDefinition('integer', { key: 'score', defaultValue: 1 })],
        defaultValue: { score: 1 },
      }),
    );
    input.definition.states[0]!.dataDefaults = { details: { score: 'invalid' } };
    const result = buildCoordinatedExportArtifactsWithRuntime(
      input,
      'class CoordinatedGraphicElement {}',
    );
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/preset.*score.*integer/);
  });
  it('does not overwrite existing bytes when a late preset resource collides with an asset path', () => {
    const { input, composition } = fixture();
    composition.assets.push(
      createAsset({
        id: 'embedded-0',
        name: 'Existing asset',
        mimeType: 'image/png',
        dataUri: 'data:image/png;base64,YQ==',
      }),
    );
    composition.dataFields.push(
      createFieldDefinition('image-url', { key: 'image', defaultValue: '' }),
    );
    input.definition.states[1]!.dataDefaults!.image = 'data:image/png;base64,Yg==';
    const result = buildCoordinatedExportArtifactsWithRuntime(
      input,
      'class CoordinatedGraphicElement {}',
    );
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/preset.*resources disagree/);
    expect(
      result.resources.find((resource) => resource.path === 'templates/0/assets/embedded-0.png')!
        .data,
    ).toBe('YQ==');
  });
  it('preserves per-state defaults, leaves the shared template intact, and publishes the initial preset to GDD', () => {
    const { input } = fixture(),
      before = structuredClone(input);
    const result = buildCoordinatedExportArtifactsWithRuntime(
      input,
      'class CoordinatedGraphicElement {}',
    );
    expect(result.errors).toEqual([]);
    expect(result.transitionDescriptor!.templates[0]!.dataDefaults!.label).toBe('SOURCE');
    expect(result.transitionDescriptor!.definition.states[1]!.dataDefaults!.label).toBe('BREAKING');
    expect(result.transitionDescriptor!.dataDefaults!.slots.header!.data).toEqual({
      label: 'DEVELOPING',
      visible: false,
      count: 1,
      color: '#d49b22',
    });
    const schema = result.manifest.schema as { default: { slots: { header: { data: unknown } } } };
    expect(schema.default.slots.header.data).toEqual(
      result.transitionDescriptor!.dataDefaults!.slots.header!.data,
    );
    expect(input).toEqual(before);
  });
  it('uses state presets in README Take examples instead of overwriting them with template defaults', () => {
    const { input } = fixture();
    const result = buildCoordinatedExportArtifactsWithRuntime(
      input,
      'class CoordinatedGraphicElement {}',
    );
    const readme = result.resources.find((r) => r.path === 'README.md')!.data;
    const examples = [...readme.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) =>
      JSON.parse(match[1]!),
    );
    const take = examples.find((example) => example.id === 'transition.take');
    expect(take.payload.data).toMatchObject({
      label: 'DEVELOPING',
      visible: false,
      color: '#d49b22',
    });
  });
  it('packages and resolves state-only image defaults for every variant without rewriting ordinary text', () => {
    const { input, composition } = fixture();
    const asset = createAsset({
      id: 'logo',
      name: 'Logo',
      mimeType: 'image/svg+xml',
      dataUri:
        'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E',
      packagePath: 'images/logo.svg',
    });
    composition.assets.push(asset);
    composition.dataFields.push(
      createFieldDefinition('image-url', { key: 'image', defaultValue: '' }),
    );
    for (const state of input.definition.states)
      state.dataDefaults = { ...state.dataDefaults, image: 'asset:logo' };
    input.definition.states[1]!.dataDefaults!.label = 'templates/0/images/logo.svg';
    const result = buildCoordinatedExportArtifactsWithRuntime(
      input,
      'class CoordinatedGraphicElement {}',
    );
    expect(result.errors).toEqual([]);
    for (const state of result.transitionDescriptor!.definition.states)
      expect(state.dataDefaults!.image).toBe('templates/0/images/logo.svg');
    const Graphic = evaluate(result.mainJs, 'https://renderer.example/graphic/main.js');
    for (const state of Graphic.transitionDescriptor.definition.states)
      expect(state.dataDefaults!.image).toBe(
        'https://renderer.example/graphic/templates/0/images/logo.svg',
      );
    expect(Graphic.transitionDescriptor.definition.states[1]!.dataDefaults!.label).toBe(
      'templates/0/images/logo.svg',
    );
  });
  it('packages a state-only embedded image and supports blob resource maps', () => {
    const { input, composition } = fixture();
    composition.dataFields.push(
      createFieldDefinition('image-url', { key: 'image', defaultValue: '' }),
    );
    input.definition.states[1]!.dataDefaults!.image = 'data:image/png;base64,YQ==';
    const result = buildCoordinatedExportArtifactsWithRuntime(
      input,
      'class CoordinatedGraphicElement {}',
    );
    expect(result.errors).toEqual([]);
    const path = result.transitionDescriptor!.definition.states[1]!.dataDefaults!.image as string;
    expect(path).toMatch(/^templates\/0\/assets\//);
    expect(result.resources.find((r) => r.path === path)).toMatchObject({
      data: 'YQ==',
      base64: true,
      mimeType: 'image/png',
    });
    const url = 'blob:https://renderer.example/preset';
    vi.stubGlobal(EXPORTED_RESOURCE_URLS_KEY, {
      [url]: { [path]: 'blob:https://renderer.example/image' },
    });
    expect(
      evaluate(result.mainJs, url).transitionDescriptor.definition.states[1]!.dataDefaults!.image,
    ).toBe('blob:https://renderer.example/image');
  });
  it.each([{ visible: 'not boolean' }, { count: 'not number' }, { typo: 'unknown field' }])(
    'rejects schema-invalid defaults %j',
    (defaults) => {
      const { input } = fixture();
      input.definition.states[0]!.dataDefaults = defaults;
      const result = buildCoordinatedExportArtifactsWithRuntime(
        input,
        'class CoordinatedGraphicElement {}',
      );
      expect(result.valid).toBe(false);
      expect(result.errors.join(' ')).toMatch(/preset|defaults/i);
    },
  );
  it('rejects unknown asset references and declares internet access for HTTP image presets', () => {
    const { input, composition } = fixture();
    composition.dataFields.push(
      createFieldDefinition('image-url', { key: 'image', defaultValue: '' }),
    );
    input.definition.states[1]!.dataDefaults!.image = 'asset:missing';
    let result = buildCoordinatedExportArtifactsWithRuntime(
      input,
      'class CoordinatedGraphicElement {}',
    );
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/unknown asset/);
    input.definition.states[1]!.dataDefaults!.image = 'https://images.example/logo.png';
    result = buildCoordinatedExportArtifactsWithRuntime(
      input,
      'class CoordinatedGraphicElement {}',
    );
    expect(result.valid, result.errors.join(' ')).toBe(true);
    expect(result.manifest.renderRequirements![0]!.accessToPublicInternet).toEqual({ exact: true });
  });
});
