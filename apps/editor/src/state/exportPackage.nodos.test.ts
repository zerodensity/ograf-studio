import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import {
  createAsset,
  createCustomActionDefinition,
  createDefaultTransform,
  createFieldDefinition,
  createImageElement,
  createLayerKeyframe,
  createLayerVisualRule,
  createProject,
  createTextElement,
  createTickerElement,
  createTickerLayer,
  type Composition,
  type Project,
} from '@ograf-editor/scene-model';
import {
  getExportProfile,
  getOfflinePreviewFileName,
  type ExportArtifacts,
  type ExportProfile,
} from '@ograf-editor/codegen';
import {
  addProjectSetControl,
  createProjectSet,
  createProjectSetArchive,
  openProjectSetArchive,
  resolveProjectSetTemplate,
  setProjectSetControlValue,
  updateProjectSetSettings,
} from './projectSet';
import {
  buildNodosPreset,
  createCertifiedProjectHtml,
  createCertifiedProjectPackage,
} from './exportPackage';

const gates = vi.hoisted(() => ({ certify: vi.fn(), thumbnail: vi.fn() }));

// Compile real artifacts, mocking only browser rendering/certification. These checks exercise
// packaging boundaries; the live browser/installed Nodos gate remains a separate requirement.
vi.mock('./ografCompatibility', async () => {
  const { buildExportArtifactsWithRuntime } = await import('@ograf-editor/codegen');
  return {
    buildExportArtifacts: (project: Project, composition: Composition, profile?: ExportProfile) =>
      buildExportArtifactsWithRuntime(project, composition, 'class GraphicElement {}', profile),
    certifyExportArtifacts: gates.certify,
  };
});
vi.mock('./templateThumbnail', () => ({ createTemplateThumbnail: gates.thumbnail }));

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const thumbnail = () => new Blob([Uint8Array.from(atob(png), (char) => char.charCodeAt(0))]);
const options = { displayName: 'Market graphic', category: 'OGraf|Markets' };
const text = (base64: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));

beforeEach(() => {
  vi.clearAllMocks();
  gates.thumbnail.mockImplementation(async () => thumbnail());
  gates.certify.mockImplementation(async (artifacts: ExportArtifacts) => ({
    valid: artifacts.valid,
    errors: artifacts.errors,
    checks: [],
  }));
});

function interactiveFixture() {
  const project = createProject({ name: 'Market graphic', supportsNonRealTime: false });
  const composition = project.compositions[0]!;
  composition.frameRate = 50;
  composition.crop = { x: 80, y: 60, width: 1280, height: 720 };
  const logo = createAsset({
    id: 'logo',
    name: 'Market logo',
    mimeType: 'image/png',
    dataUri: `data:image/png;base64,${png}`,
  });
  const font = createAsset({
    id: 'font',
    name: 'Market font',
    kind: 'font',
    mimeType: 'font/woff2',
    dataUri: 'data:font/woff2;base64,d09GMg==',
    fontFamily: 'Market',
    packagePath: 'fonts/market.woff2',
    licenseText: 'Licence — özgür yazı',
  });
  composition.assets = [logo, font];
  const engine = createFieldDefinition('number', {
    id: 'engine',
    key: 'engineSecret',
    defaultValue: 5,
    exposeToOgraf: false,
  });
  const quote = createFieldDefinition('object', {
    id: 'quote',
    key: 'quote',
    defaultValue: { label: 'Original', secret: 42 },
    properties: [
      createFieldDefinition('text', { key: 'label', defaultValue: 'Original' }),
      createFieldDefinition('number', { key: 'secret', defaultValue: 42, exposeToOgraf: false }),
    ],
  });
  composition.dataFields = [
    engine,
    quote,
    createFieldDefinition('image-url', {
      id: 'logo-field',
      key: 'logo',
      defaultValue: 'asset:logo',
    }),
  ];
  composition.customActions = [createCustomActionDefinition({ actionId: 'advance' })];
  composition.functions = [
    {
      type: 'javascript',
      version: 1,
      id: 'logic',
      name: 'Logic',
      enabled: true,
      pointer: true,
      source: '({state})=>({state})',
      inputs: { value: engine.id },
      outputs: { value: engine.id },
      actions: ['advance'],
      initialState: { count: 0 },
      timeoutMs: 250,
    },
  ];
  const ticker = createTickerLayer();
  ticker.keyframes = [createLayerKeyframe(0, createDefaultTransform({ width: 1200, height: 80 }))];
  ticker.element = createTickerElement({
    direction: 'left',
    textDirection: 'rtl',
    speedPixelsPerSecond: 120,
    updatePolicy: 'immediate',
    entryFade: 32,
    exitFade: 24,
    items: [
      {
        id: 'headline',
        width: 320,
        element: createTextElement({ content: 'Market', fontFamily: 'Market' }),
        animation: { type: 'fade', durationMs: 500, delayMs: 0 },
      },
      { id: 'logo', width: 64, element: createImageElement({ src: 'asset:logo' }) },
    ],
  });
  ticker.bindings = [{ fieldId: engine.id, targetProperty: 'layer.x' }];
  ticker.visualRules = [
    createLayerVisualRule({
      trigger: 'play',
      actions: [{ type: 'set-data', fieldId: engine.id, mode: 'set', value: 9 }],
    }),
  ];
  composition.layers.push(ticker);
  return { project, composition, ticker, quote };
}

describe('Nodos packaging on the current Studio export contract', () => {
  it('puts the source prompt history in the standalone manifest and HTML payload', async () => {
    const prompts = [
      { id: 'first', text: 'Author a chart for İstanbul.\nUse a dark palette.' },
      { id: 'follow-up', text: 'Show </script><script id="prompt-probe"></script> as text.\u2028' },
    ];
    const project = createProject({ name: 'Authored chart', authoringPrompts: prompts });
    const packaged = await createCertifiedProjectPackage(
      project,
      project.compositions[0]!,
      getExportProfile('realtime'),
    );
    const zip = await JSZip.loadAsync(await packaged.blob.arrayBuffer());
    const manifest = JSON.parse(
      await zip.file(packaged.artifacts.manifestFileName)!.async('string'),
    );
    expect(manifest.id).not.toBe(project.id);
    expect(manifest.v_ografStudioAuthoringPrompts).toEqual({
      version: 1,
      templates: [{ projectId: project.id, name: project.name, prompts }],
    });
    expect(zip.file(getOfflinePreviewFileName(packaged.artifacts))).toBeNull();
    const preview = await createCertifiedProjectHtml(
      project,
      project.compositions[0]!,
      getExportProfile('realtime'),
    );
    const html = await preview.blob.text();
    const payload = html.match(
      /<script type="application\/json" id="ograf-package">([\s\S]*?)<\/script>/,
    );
    expect(JSON.parse(payload![1]!).manifest).toEqual(preview.artifacts.manifest);
    expect(preview.artifacts.manifest.v_ografStudioAuthoringPrompts).toEqual(
      manifest.v_ografStudioAuthoringPrompts,
    );
    expect(html).not.toContain('<script id="prompt-probe">');
    expect(await zip.file('main.js')!.async('string')).not.toContain('Author a chart for');
    expect(zip.file('authoring-prompts.json')).toBeNull();
  });

  it('keeps Functions, ticker policy, Rules and internal data while exposing only public pins', async () => {
    const { project, composition, ticker } = interactiveFixture();
    const original = structuredClone(project);
    const built = await buildNodosPreset(
      project,
      composition,
      options,
      getExportProfile('realtime'),
    );
    const certified = gates.certify.mock.calls[0]![0] as ExportArtifacts;
    expect(certified.valid, certified.errors.join('\n')).toBe(true);
    expect(certified.manifest.v_ografStudioAuthoringPrompts).toBeUndefined();
    expect(certified.manifest.supportsNonRealTime).toBe(false);
    expect(certified.descriptor!.functions![0]).toMatchObject({
      pointer: true,
      inputs: { value: 'engineSecret' },
      outputs: { value: 'engineSecret' },
    });
    expect(certified.descriptor!.dataDefaults).toMatchObject({
      engineSecret: 5,
      quote: { secret: 42 },
    });
    const compiledTicker = certified.descriptor!.layers.find((layer) => layer.id === ticker.id)!;
    expect(compiledTicker.element).toMatchObject({
      type: 'ticker',
      direction: 'left',
      textDirection: 'rtl',
      updatePolicy: 'immediate',
      speedPixelsPerSecond: 120,
      entryFade: 32,
      exitFade: 24,
    });
    expect(compiledTicker.visualRules).toHaveLength(1);
    expect(built.preset.node.pins.find((pin) => pin.name === 'Resolution')).toEqual({
      name: 'Resolution',
      type_name: 'nos.fb.vec2u',
      data: { x: 1280, y: 720 },
    });
    expect(
      built.preset.node.pins.some((pin) => ['Width', 'Height', 'FrameRate'].includes(pin.name)),
    ).toBe(false);
    expect(built.preset.node.pins.find((pin) => pin.name === 'engineSecret')).toBeUndefined();
    expect(built.preset.node.pins.find((pin) => pin.name === 'quote')).toBeUndefined();
    expect(text(built.files.find((file) => file.path === 'nodos.html')!.base64)).toContain(
      '"label":"Original"',
    );
    expect(text(built.files.find((file) => file.path === 'nodos.html')!.base64)).not.toContain(
      'engineSecret',
    );
    expect(project).toEqual(original);
  });

  it('serves the exact certified standalone bytes, including binary resources, licence text and thumbnail', async () => {
    const { project, composition } = interactiveFixture();
    const profile = getExportProfile('realtime');
    const nodos = await buildNodosPreset(project, composition, options, profile);
    const standalone = await createCertifiedProjectPackage(project, composition, profile);
    const zip = await JSZip.loadAsync(await standalone.blob.arrayBuffer());
    for (const file of nodos.files.filter((entry) => entry.path !== 'nodos.html')) {
      expect(await zip.file(file.path)!.async('base64'), file.path).toBe(file.base64);
    }
    expect(nodos.files.filter((entry) => entry.path === 'assets/logo.png')).toHaveLength(1);
    expect(text(nodos.files.find((entry) => entry.path.startsWith('licenses/font-'))!.base64)).toBe(
      'Licence — özgür yazı',
    );
    const manifest = JSON.parse(
      text(nodos.files.find((entry) => entry.path.endsWith('.ograf.json'))!.base64),
    );
    expect(nodos.files.find((entry) => entry.path === manifest.thumbnails[0].file)).toBeDefined();
    expect(gates.certify).toHaveBeenCalledTimes(2);
  });

  it('uses one immutable snapshot across asynchronous capture, certification and preset generation', async () => {
    const { project, composition, quote } = interactiveFixture();
    let finish!: (value: Blob) => void;
    const captured = new Promise<void>((resolve) =>
      gates.thumbnail.mockImplementationOnce(() => {
        resolve();
        return new Promise<Blob>((done) => {
          finish = done;
        });
      }),
    );
    const building = buildNodosPreset(project, composition, options);
    await captured;
    composition.crop!.width = 640;
    quote.defaultValue = { label: 'Edited while exporting', secret: 99 };
    composition.functions![0]!.source = '()=>({state:{later:true}})';
    finish(thumbnail());
    const result = await building;
    expect(result.preset.node.pins.find((pin) => pin.name === 'Resolution')?.data).toEqual({
      x: 1280,
      y: 720,
    });
    expect(result.preset.node.pins.find((pin) => pin.name === 'quote')).toBeUndefined();
    expect(text(result.files.find((file) => file.path === 'nodos.html')!.base64)).toContain(
      '"label":"Original"',
    );
    const certified = gates.certify.mock.calls[0]![0] as ExportArtifacts;
    expect(certified.descriptor!.functions![0]!.source).toBe('({state})=>({state})');
    expect(quote.defaultValue).toEqual({ label: 'Edited while exporting', secret: 99 });
  });

  it('resolves compact-set shared controls, resources and inherited settings before packaging', async () => {
    const { project, composition, quote } = interactiveFixture();
    let set = createProjectSet('Shared package', project);
    const id = set.templates[0]!.id;
    set = addProjectSetControl(set, id, composition.id, quote.id, project);
    set = setProjectSetControlValue(set, set.controls[0]!.field.id, {
      label: 'Shared current value',
      secret: 17,
    });
    set = updateProjectSetSettings(set, { ...set.settings!, frameRate: 60 });
    const archive = await createProjectSetArchive(set);
    const loaded = await openProjectSetArchive(await archive.arrayBuffer());
    const resolved = resolveProjectSetTemplate(loaded, id);
    const main = resolved.compositions.find((item) => item.id === resolved.mainCompositionId)!;
    const result = await buildNodosPreset(resolved, main, options);
    expect(result.preset.node.pins.find((pin) => pin.name === 'FrameRate')).toBeUndefined();
    expect(text(result.files.find((file) => file.path === 'nodos.html')!.base64)).toContain(
      '"frameRate":60',
    );
    expect(result.preset.node.pins.find((pin) => pin.name === 'quote')).toBeUndefined();
    expect(text(result.files.find((file) => file.path === 'nodos.html')!.base64)).toContain(
      '"label":"Shared current value"',
    );
    expect(result.files.filter((file) => file.path === 'fonts/market.woff2')).toHaveLength(1);
    expect(result.files.filter((file) => file.path === 'assets/logo.png')).toHaveLength(1);
  });

  it('never returns Nodos files after a failed certification and never silently removes Functions', async () => {
    const { project, composition } = interactiveFixture();
    gates.certify.mockResolvedValueOnce({ valid: false, errors: ['Lifecycle failed'], checks: [] });
    await expect(buildNodosPreset(project, composition, options)).rejects.toThrow(
      'Lifecycle failed',
    );
    await expect(
      buildNodosPreset(project, composition, options, getExportProfile('dual')),
    ).rejects.toThrow('uses Functions');
    const before = gates.certify.mock.calls.length;
    await expect(
      buildNodosPreset(project, composition, options, getExportProfile('non-realtime')),
    ).rejects.toThrow('requires a Real-time');
    expect(gates.certify).toHaveBeenCalledTimes(before);
    expect(composition.functions).toHaveLength(1);
  });
});
