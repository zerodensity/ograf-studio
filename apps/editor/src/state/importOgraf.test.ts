import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  createCustomActionDefinition,
  createFieldDefinition,
  createLayerKeyframe,
  createLayerOfKind,
  createProject,
  defaultTransformFor,
} from '@ograf-editor/scene-model';
import { assembleManifest, compileDescriptor, generateMainJs } from '@ograf-editor/codegen';
import { OGRAF_MANIFEST_SCHEMA_URL, type OGrafManifest } from '@ograf-editor/ograf-types';
import { importOgrafData } from './importOgraf';

async function packageBytes(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [path, contents] of Object.entries(files)) zip.file(path, contents);
  return zip.generateAsync({ type: 'uint8array' });
}

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
  it('reconstructs editable layers, lifecycle, schema, actions, and embedded image data', async () => {
    const { project, composition } = editableFixture();
    const descriptor = compileDescriptor(composition);
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
      'source.ogeproj': JSON.stringify(project),
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
