import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  createCustomActionDefinition,
  createFieldDefinition,
  createLayerKeyframe,
  createLayerOfKind,
  createProject,
  createTilingPattern,
  addTilingPatternLayer,
  defaultTransformFor,
  setTilingPattern,
  setLayerLighting,
  createLayerLoopClip,
} from '@ograf-editor/scene-model';
import { assembleManifest, compileDescriptor, generateMainJs } from '@ograf-editor/codegen';
import { OGRAF_MANIFEST_SCHEMA_URL, type OGrafManifest } from '@ograf-editor/ograf-types';
import { importOgrafData } from './importOgraf';

async function packageBytes(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [path, contents] of Object.entries(files)) zip.file(path, contents);
  return zip.generateAsync({ type: 'uint8array' });
}

it('round-trips a light controller even when no geometry instance is exported', async () => {
  const project = createProject(),
    c = project.compositions[0]!;
  const p = setTilingPattern(c, { lighting: { cycleFrames: 1200, intensity: 0.6, phase: 0.25 } });
  const layer = createLayerOfKind('rectangle');
  layer.keyframes = [createLayerKeyframe(0, defaultTransformFor('rectangle'))];
  layer.loop = createLayerLoopClip({ durationFrames: 100 });
  c.layers.push(layer);
  setLayerLighting(c, layer.id, {
    patternId: p.id,
    role: 'glow',
    phaseOffset: 0.2,
    gain: 0.7,
    cyclesPerLoop: 3,
  });
  const descriptor = compileDescriptor(c),
    manifest = assembleManifest(project, c, descriptor);
  const imported = await importOgrafData(
    'lighting.ograf.zip',
    await packageBytes({
      [`${manifest.id}.ograf.json`]: JSON.stringify(manifest),
      'main.js': generateMainJs(descriptor, ''),
    }),
  );
  const recovered = imported.project.compositions[0]!;
  expect(recovered.patterns).toEqual([p]);
  expect(recovered.layers[0]!.lighting).toEqual(layer.lighting);
  expect(recovered.layers[0]!.loop).toEqual(layer.loop);
  expect(recovered.layers[0]!.lighting).not.toHaveProperty('definition');
});

function editableFixture() {
  const project = createProject({
    name: 'Imported News Graphic',
    description: 'Round-trip fixture',
    version: '2.3.4',
    author: { name: 'Fixture Author' },
  });
  const composition = project.compositions[0]!;
  composition.width = 1280;
  composition.height = 720;
  composition.frameRate = 50;
  const text = createLayerOfKind('text');
  if (text.element.type !== 'text') throw new Error('Expected text layer.');
  text.element.content = 'Breaking News';
  text.blendMode = 'screen';
  const pose = defaultTransformFor('text');
  text.keyframes = [
    createLayerKeyframe(0, { ...pose, opacity: 0 }),
    createLayerKeyframe(12, { ...pose, opacity: 1 }),
    createLayerKeyframe(24, { ...pose, x: 600, opacity: 0 }),
  ];
  const field = createFieldDefinition('text', {
    key: 'headline',
    label: 'Headline',
    defaultValue: 'Breaking News',
    required: true,
  });
  text.bindings = [{ fieldId: field.id, targetProperty: 'content' }];

  const image = createLayerOfKind('image');
  if (image.element.type !== 'image') throw new Error('Expected image layer.');
  image.element.src =
    'data:image/svg+xml;base64,' +
    btoa(
      '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>',
    );
  const imagePose = defaultTransformFor('image');
  image.keyframes = [
    createLayerKeyframe(0, imagePose),
    createLayerKeyframe(24, { ...imagePose, rotation: 20 }),
  ];

  composition.layers = [text, image];
  composition.dataFields = [field];
  composition.customActions = [
    createCustomActionDefinition({
      actionId: 'flash',
      name: 'Flash',
      description: 'Flash the headline',
    }),
  ];
  return { project, composition };
}

describe('best-effort OGraf import', () => {
  it('restores one shared editable pattern from linked compiled instances', async () => {
    const project = createProject(),
      composition = project.compositions[0]!;
    const pattern = createTilingPattern();
    composition.patterns.push(pattern);
    addTilingPatternLayer(composition, pattern.id);
    addTilingPatternLayer(composition, pattern.id);
    const descriptor = compileDescriptor(composition),
      manifest = assembleManifest(project, composition, descriptor);
    const imported = await importOgrafData(
      'tiled.ograf.zip',
      await packageBytes({
        [`${manifest.id}.ograf.json`]: JSON.stringify(manifest),
        'main.js': generateMainJs(descriptor, ''),
      }),
    );
    expect(imported.project.compositions[0]!.patterns).toEqual([pattern]);
    for (const layer of imported.project.compositions[0]!.layers) {
      expect(layer.element).toMatchObject({ type: 'pattern', patternId: pattern.id });
      expect(layer.element).not.toHaveProperty('definition');
    }
  });
  it('round-trips gradient paths, fill-rule holes and source-only alpha masks', async () => {
    const project = createProject(),
      composition = project.compositions[0]!;
    const source = createLayerOfKind('path'),
      target = createLayerOfKind('text');
    if (source.element.type !== 'path') throw Error('Expected path');
    source.element.fill = {
      type: 'linear',
      angle: 90,
      stops: [
        { offset: 0, color: '#000', opacity: 0 },
        { offset: 1, color: '#fff', opacity: 1 },
      ],
    };
    source.element.fillRule = 'evenodd';
    source.isMaskOnly = true;
    target.mask = { sourceLayerId: source.id, mode: 'alpha', inverted: true };
    for (const layer of [source, target])
      layer.keyframes = [0, 12, 24].map((frame) =>
        createLayerKeyframe(frame, defaultTransformFor(layer.element.type)),
      );
    composition.layers = [source, target];
    const descriptor = compileDescriptor(composition),
      manifest = assembleManifest(project, composition, descriptor);
    const imported = await importOgrafData(
      'masked.ograf.zip',
      await packageBytes({
        [`${manifest.id}.ograf.json`]: JSON.stringify(manifest),
        'main.js': generateMainJs(descriptor, ''),
      }),
    );
    const layers = imported.project.compositions[0]!.layers;
    expect(layers[0]!.element).toMatchObject({
      type: 'path',
      fill: source.element.fill,
      fillRule: 'evenodd',
    });
    expect(layers[0]!.isMaskOnly).toBe(true);
    expect(layers[1]!.mask).toEqual(target.mask);
  });
  it('reconstructs editable layers, lifecycle, schema, actions, and embedded image data', async () => {
    const { project, composition } = editableFixture();
    const descriptor = compileDescriptor(composition);
    const legacyText = descriptor.layers[0]!.element as unknown as Record<string, unknown>;
    delete legacyText.strokeColor;
    delete legacyText.strokeWidth;
    delete descriptor.layers[0]!.animationTracks.strokeWidth;
    const manifest = assembleManifest(project, composition, descriptor);
    const zip = await packageBytes({
      [`${manifest.id}.ograf.json`]: JSON.stringify(manifest),
      'main.js': generateMainJs(descriptor, ''),
    });

    const imported = await importOgrafData('fixture.ograf.zip', zip);

    expect(imported.mode).toBe('compiled-descriptor');
    expect(imported.project).toMatchObject({
      id: project.id,
      name: project.name,
      description: project.description,
      version: project.version,
      author: project.author,
    });
    const result = imported.project.compositions[0]!;
    expect(result).toMatchObject({ width: 1280, height: 720, frameRate: 50 });
    expect(result.layers).toHaveLength(2);
    expect(result.layers[0]!.blendMode).toBe('screen');
    expect(result.layers[0]!.element).toMatchObject({
      type: 'text',
      strokeColor: 'transparent',
      strokeWidth: 0,
    });
    expect(result.layers[0]?.keyframes.map((key) => key.frame)).toEqual([0, 12, 24]);
    expect(result.dataFields).toHaveLength(1);
    expect(result.layers[0]?.bindings[0]?.fieldId).toBe(result.dataFields[0]?.id);
    expect(result.customActions[0]).toMatchObject({ actionId: 'flash', name: 'Flash' });
    expect(result.assets).toHaveLength(1);
    expect(result.layers[1]?.element).toMatchObject({
      type: 'image',
      src: expect.stringMatching(/^asset:/),
    });
  });

  it('round-trips recursive GDD fields and editor-generated runtime collections', async () => {
    const project = createProject({ name: 'Leaderboard' });
    const composition = project.compositions[0]!;
    const field = createFieldDefinition('array', {
      key: 'leaderboard',
      constraints: { minItems: 0, maxItems: 4 },
      items: createFieldDefinition('object', {
        key: 'item',
        properties: [createFieldDefinition('text', { key: 'name', required: true })],
        defaultValue: { name: '' },
      }),
      defaultValue: [{ name: 'Ada' }],
    });
    const plate = createLayerOfKind('rectangle');
    const label = createLayerOfKind('text');
    plate.groupId = 'row';
    label.groupId = 'row';
    label.bindings = [{ fieldId: field.id, targetProperty: 'content', sourcePath: ['name'] }];
    const pose = defaultTransformFor('text');
    plate.keyframes = [createLayerKeyframe(0, defaultTransformFor('rectangle'))];
    label.keyframes = [createLayerKeyframe(0, pose)];
    composition.layers = [plate, label];
    composition.dataFields = [field];
    composition.runtimeCollections = [
      {
        id: 'leaderboard-rows',
        name: 'Leaderboard rows',
        fieldId: field.id,
        prototypeLayerIds: [plate.id, label.id],
        offsetPerItem: { x: 0, y: 72 },
        capacity: 4,
        overflow: 'truncate',
      },
    ];
    const descriptor = compileDescriptor(composition);
    const manifest = assembleManifest(project, composition, descriptor);
    const zip = await packageBytes({
      [`${manifest.id}.ograf.json`]: JSON.stringify(manifest),
      'main.js': generateMainJs(descriptor, ''),
    });

    const imported = await importOgrafData('leaderboard.ograf.zip', zip);
    const result = imported.project.compositions[0]!;
    expect(result.dataFields[0]).toMatchObject({
      key: 'leaderboard',
      type: 'array',
      constraints: { maxItems: 4 },
      items: { type: 'object', properties: [{ key: 'name', type: 'text' }] },
    });
    expect(result.layers).toHaveLength(2);
    expect(result.layers[1]!.bindings[0]!.sourcePath).toEqual(['name']);
    expect(result.runtimeCollections[0]).toMatchObject({
      id: 'leaderboard-rows',
      prototypeLayerIds: [plate.id, label.id],
      offsetPerItem: { x: 0, y: 72 },
      capacity: 4,
      overflow: 'truncate',
    });
  });

  it('imports manifest metadata, constraints, lifecycle hints, and schema without executing opaque JS', async () => {
    const manifest: OGrafManifest = {
      $schema: OGRAF_MANIFEST_SCHEMA_URL,
      id: 'third-party',
      name: 'Third Party Graphic',
      main: 'runtime.js',
      supportsRealTime: true,
      supportsNonRealTime: false,
      stepCount: 2,
      renderRequirements: [
        {
          resolution: { width: { exact: 3840 }, height: { ideal: 2160 } },
          frameRate: { exact: 59.94 },
        },
      ],
      schema: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string', title: 'Title', default: 'Hello' },
          logo: { type: 'string', title: 'Logo URL', format: 'uri' },
          count: { type: 'integer', title: 'Count', default: 3 },
          theme: {
            type: 'string',
            title: 'Theme',
            description: 'Operator theme.',
            gddType: 'select',
            enum: ['news', 'sport'],
            gddOptions: { labels: { news: 'News', sport: 'Sport' } },
            default: 'news',
            maxLength: 12,
          },
          regions: {
            type: 'array',
            title: 'Regions',
            gddType: 'select-multiple',
            items: { type: 'string', enum: ['eu', 'na'] },
            gddOptions: { labels: { eu: 'Europe', na: 'North America' } },
            default: ['eu'],
          },
        },
      },
    };
    const zip = await packageBytes({
      'graphic.ograf.json': JSON.stringify(manifest),
      'runtime.js': 'export default class ThirdPartyGraphic extends HTMLElement {}',
    });

    const imported = await importOgrafData('third-party.ograf.zip', zip);

    expect(imported.mode).toBe('manifest-only');
    expect(imported.project.name).toBe('Third Party Graphic');
    const composition = imported.project.compositions[0]!;
    expect(composition).toMatchObject({ width: 3840, height: 2160, frameRate: 59.94 });
    expect(composition.layers).toEqual([]);
    expect(composition.keyframes.map((keyframe) => keyframe.role)).toEqual([
      'start',
      'step',
      'step',
      'end',
    ]);
    expect(composition.dataFields.map((field) => [field.key, field.type, field.required])).toEqual([
      ['title', 'text', true],
      ['logo', 'image-url', false],
      ['count', 'integer', false],
      ['theme', 'select', false],
      ['regions', 'select-multiple', false],
    ]);
    expect(composition.dataFields.find((field) => field.key === 'theme')).toMatchObject({
      description: 'Operator theme.',
      options: [
        { value: 'news', label: 'News' },
        { value: 'sport', label: 'Sport' },
      ],
      constraints: { maxLength: 12 },
    });
    expect(imported.warnings.join(' ')).toMatch(/opaque JavaScript visual layers/i);
  });

  it('prefers embedded editable source when a package includes it', async () => {
    const { project } = editableFixture();
    const manifest: OGrafManifest = {
      $schema: OGRAF_MANIFEST_SCHEMA_URL,
      id: project.id,
      name: project.name,
      main: 'main.js',
      supportsRealTime: true,
      supportsNonRealTime: true,
    };
    const zip = await packageBytes({
      'graphic.ograf.json': JSON.stringify(manifest),
      'main.js': 'export default class Graphic {}',
      'source.ogs': JSON.stringify(project),
    });

    const imported = await importOgrafData('with-source.ograf.zip', zip);

    expect(imported.mode).toBe('embedded-project');
    expect(imported.project).toEqual(project);
  });

  it('rejects ambiguous packages with multiple manifests', async () => {
    const base = {
      $schema: OGRAF_MANIFEST_SCHEMA_URL,
      id: 'one',
      name: 'One',
      main: 'main.js',
      supportsRealTime: true,
      supportsNonRealTime: false,
    };
    const zip = await packageBytes({
      'one.ograf.json': JSON.stringify(base),
      'two.ograf.json': JSON.stringify({ ...base, id: 'two', name: 'Two' }),
      'main.js': '',
    });

    await expect(importOgrafData('ambiguous.zip', zip)).rejects.toThrow(
      /multiple OGraf manifests/i,
    );
  });
});
