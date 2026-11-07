import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import {
  createAsset,
  createDefaultGradient,
  createDefaultTransform,
  createLayerKeyframe,
  createLayerOfKind,
  createMediaPaint,
  createProject,
  type Project,
  type TypographyPreset,
} from '@ograf-editor/scene-model';
import { buildExportArtifactsWithRuntime, compileDescriptor } from '@ograf-editor/codegen';
import { useProjectStore } from './projectStore';
import { useProjectSetStore } from './projectSetStore';
import { useSelectionStore } from './selectionStore';
import { useTestDataStore } from './testDataStore';
import { resolveDesignerElement } from './dataBinding';
import {
  PROJECT_SET_SCHEMA_VERSION,
  addProjectSetTemplate,
  createProjectSet,
  createProjectSetArchive,
  openProjectSetArchive,
  resolveProjectSetTemplate,
  saveProjectSetTemplateEdits,
} from './projectSet';

vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
vi.stubGlobal('window', {
  clearTimeout: (timer: ReturnType<typeof setTimeout> | undefined) => clearTimeout(timer),
});
const history = await import('./historyStore');
const { initializeSharedBrandKit } = await import('./templateSetBrandKit');
const { activateProjectSetTemplate } = await import('./projectSetSession');
const { saveTemplateSetSettings } = await import('./templateSetSettingsStore');
const {
  addTypographyPreset,
  updateTypographyPreset,
  applyTypographyToLayers,
  resetTypographyProperty,
  setTypographyOverride,
  getTypographyOrigin,
  addBackgroundStyle,
  updateBackgroundStyle,
  setDefaultBackgroundStyle,
  applyBackgroundStyle,
  updateCompositionBackgroundPaint,
  resetCompositionBackground,
  getBackgroundOrigin,
  getBackgroundStyleOrigin,
  setBackgroundStyleOverride,
  removeTypographyPreset,
  removeBackgroundStyle,
} = await import('./brandKitStyles');

function projectWithText(name: string): Project {
  const project = createProject({ name });
  const composition = project.compositions[0]!;
  composition.designSystem = { name: 'News branding', tokens: [] };
  const text = createLayerOfKind('text');
  if (text.element.type !== 'text') throw new Error('Expected text.');
  text.element.fill = '#1166aa';
  text.element.color = '#1166aa';
  text.name = `${name} headline`;
  text.keyframes = [createLayerKeyframe(0, createDefaultTransform())];
  composition.layers.push(text);
  return project;
}

function fixture(withClip = false) {
  const first = projectWithText('News');
  // Resource packaging fixtures only; these bytes do not prove font/video decoding or certification.
  first.compositions[0]!.assets.push(
    createAsset({
      id: 'show-font',
      name: 'Show Sans.woff2',
      kind: 'font',
      fontFamily: 'Show Sans',
      mimeType: 'font/woff2',
      dataUri: 'data:font/woff2;base64,AAEC',
      licenseText: 'Show font fixture notice',
    }),
  );
  if (withClip)
    first.compositions[0]!.assets.push(
      createAsset({
        id: 'local-clip',
        name: 'Background clip',
        kind: 'media',
        mimeType: 'video/mp4',
        dataUri: 'data:video/mp4;base64,AwQF',
        licenseText: 'Background clip fixture notice',
      }),
    );
  let set = createProjectSet('Evening Show', first);
  set = addProjectSetTemplate(set, projectWithText('Sports'));
  const templateId = set.templates[0]!.id;
  const secondTemplateId = set.templates[1]!.id;
  useProjectStore.getState().loadProject(resolveProjectSetTemplate(set, templateId));
  useProjectSetStore.setState({ projectSet: set, activeTemplateId: templateId });
  initializeSharedBrandKit();
  history.resetHistory();
  return { templateId, secondTemplateId, layerId: first.compositions[0]!.layers[0]!.id };
}

function currentSet() {
  const set = useProjectSetStore.getState().projectSet;
  if (!set) throw new Error('Expected Template Set.');
  return set;
}
function composition() {
  const project = useProjectStore.getState().project;
  return project.compositions.find((item) => item.id === project.mainCompositionId)!;
}
function text() {
  const layer = composition().layers[0]!;
  if (layer.element.type !== 'text') throw new Error('Expected text.');
  return layer;
}
function typography(id: string) {
  return currentSet().brandKit!.typography!.find((preset) => preset.id === id)!;
}
function properties(
  patch: Partial<TypographyPreset['properties']> = {},
): TypographyPreset['properties'] {
  return {
    fontFamily: 'Show Sans',
    fontSize: 72,
    fontWeight: 600,
    lineHeight: 1.4,
    letterSpacing: 2,
    textAlign: 'center',
    textTransform: 'uppercase',
    ...patch,
  };
}
function headline() {
  const id = addTypographyPreset('set', 'headline');
  updateTypographyPreset('set', id, { name: 'Main headline', properties: properties() });
  return id;
}
function background(paint = createDefaultGradient()) {
  const id = addBackgroundStyle('set');
  updateBackgroundStyle('set', id, { name: 'News background', paint });
  return id;
}
function snapshot() {
  return structuredClone({
    project: useProjectStore.getState().project,
    set: currentSet(),
    activeTemplateId: useProjectSetStore.getState().activeTemplateId,
  });
}
function expectSnapshot(expected: ReturnType<typeof snapshot>) {
  expect(useProjectStore.getState().project).toEqual(expected.project);
  expect(currentSet()).toEqual(expected.set);
  expect(useProjectSetStore.getState().activeTemplateId).toBe(expected.activeTemplateId);
}

describe('shared typography and background styles', () => {
  beforeEach(() => {
    useProjectSetStore.getState().clearProjectSet();
    useProjectStore.getState().newProject();
    useSelectionStore.setState({ selectedLayerId: null, selectedLayerIds: [] });
    useTestDataStore.getState().resetAll();
    history.resetHistory();
  });
  afterAll(() => {
    history.resetHistory();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('adds a shared typography catalog and applies all seven fields without altering paint/content', () => {
    const { layerId, secondTemplateId } = fixture();
    const before = structuredClone(text().element);
    const id = headline();
    applyTypographyToLayers([layerId], id);
    expect(text().element).toMatchObject(properties());
    expect(text().element).toMatchObject({
      content: before.type === 'text' ? before.content : '',
      fill: before.type === 'text' ? before.fill : '',
    });
    expect(text().typographyBinding).toEqual({ presetId: id });
    const other = resolveProjectSetTemplate(currentSet(), secondTemplateId).compositions[0]!;
    expect(other.designSystem.typography).toContainEqual(typography(id));
    expect(other.assets.some((asset) => asset.fontFamily === 'Show Sans')).toBe(true);
  });

  it('preserves object edits during master changes and resets one property with one undo/redo step', () => {
    const { layerId } = fixture();
    const id = headline();
    applyTypographyToLayers([layerId], id);
    useProjectStore.getState().updateLayerElement(layerId, {
      fontSize: 100,
      letterSpacing: 7,
      content: 'Local headline',
      fill: '#22aa88',
    });
    updateTypographyPreset('set', id, {
      properties: properties({
        fontSize: 80,
        fontWeight: 900,
        letterSpacing: 3,
        textAlign: 'right',
      }),
    });
    expect(text().element).toMatchObject({
      fontSize: 100,
      letterSpacing: 7,
      fontWeight: 900,
      textAlign: 'right',
      content: 'Local headline',
      fill: '#22aa88',
    });
    expect(text().typographyBinding!.overrides).toEqual(['fontSize', 'letterSpacing']);
    history.resetHistory();
    const before = snapshot();
    resetTypographyProperty(layerId, 'fontSize');
    expect(text().element).toMatchObject({ fontSize: 80, letterSpacing: 7 });
    expect(text().typographyBinding!.overrides).toEqual(['letterSpacing']);
    const after = snapshot();
    expect(history.getHistorySnapshot().past).toHaveLength(1);
    history.undo();
    expectSnapshot(before);
    history.redo();
    expectSnapshot(after);
  });

  it('resets data-bound font size and follows later master values without losing its GDD binding', () => {
    const { layerId } = fixture();
    const id = headline();
    const fieldId = useProjectStore.getState().addDataField('number');
    useProjectStore.getState().updateDataField(fieldId, { key: 'headlineSize', defaultValue: 48 });
    useProjectStore.getState().setLayerBindings(layerId, [{ fieldId, targetProperty: 'fontSize' }]);
    applyTypographyToLayers([layerId], id);
    useTestDataStore.getState().setValue(fieldId, 144);
    useProjectStore.getState().updateLayerElement(layerId, { fontSize: 100 });
    updateTypographyPreset('set', id, { properties: properties({ fontSize: 80 }) });
    const visible = () =>
      resolveDesignerElement(text(), useTestDataStore.getState().values, composition().dataFields);
    expect(visible()).toMatchObject({ fontSize: 100 });
    resetTypographyProperty(layerId, 'fontSize');
    expect(visible()).toMatchObject({ fontSize: 80 });
    updateTypographyPreset('set', id, { properties: properties({ fontSize: 90 }) });
    expect(visible()).toMatchObject({ fontSize: 90 });
    expect(text().bindings).toEqual([{ fieldId, targetProperty: 'fontSize' }]);
  });

  it('keeps a template preset override independent while unrelated global settings still propagate', () => {
    const { layerId } = fixture();
    const id = headline();
    applyTypographyToLayers([layerId], id);
    updateTypographyPreset('template', id, { properties: properties({ fontSize: 88 }) });
    expect(getTypographyOrigin(id).origin).toBe('overridden');
    updateTypographyPreset('set', id, { properties: properties({ fontSize: 120 }) });
    saveTemplateSetSettings({ ...currentSet().settings!, height: 1440 }, {});
    expect(text().element).toMatchObject({ fontSize: 88 });
    expect(composition().height).toBe(1440);
    setTypographyOverride(id, false);
    expect(getTypographyOrigin(id).origin).toBe('inherited');
    expect(text().element).toMatchObject({ fontSize: 120 });
  });

  it('applies the default gradient to every template and propagates alpha-preserving style changes', () => {
    fixture();
    const id = background();
    setDefaultBackgroundStyle(id);
    const radial = createDefaultGradient('radial');
    updateBackgroundStyle('set', id, { paint: radial });
    for (const template of currentSet().templates) {
      const resolved = resolveProjectSetTemplate(currentSet(), template.id);
      expect(resolved.compositions[0]).toMatchObject({
        backgroundStyleId: id,
        backgroundPaint: radial,
      });
      const compiled = compileDescriptor(resolved.compositions[0]!);
      expect(compiled.backgroundColor).toBe('transparent');
      expect(compiled.layers[0]!.element).toMatchObject({ type: 'rectangle', fill: radial });
    }
    expect(getBackgroundOrigin().origin).toBe('inherited');
  });

  it('preserves local paint, resets to the master and restores paint/metadata with undo/redo', () => {
    fixture();
    const id = background();
    setDefaultBackgroundStyle(id);
    updateCompositionBackgroundPaint('#22aa88');
    updateBackgroundStyle('set', id, { paint: createDefaultGradient('radial') });
    expect(composition().backgroundPaint).toBe('#22aa88');
    expect(getBackgroundOrigin().origin).toBe('overridden');
    history.resetHistory();
    const before = snapshot();
    resetCompositionBackground();
    expect(composition().backgroundPaint).toEqual(createDefaultGradient('radial'));
    expect(getBackgroundOrigin().origin).toBe('inherited');
    const after = snapshot();
    expect(history.getHistorySnapshot().past).toHaveLength(1);
    history.undo();
    expectSnapshot(before);
    history.redo();
    expectSnapshot(after);
    updateBackgroundStyle('set', id, { paint: createDefaultGradient('conic') });
    expect(composition().backgroundPaint).toEqual(createDefaultGradient('conic'));
  });

  it('a local background-style definition override does not pin the master default selection', () => {
    fixture();
    const first = background();
    const second = background(createDefaultGradient('radial'));
    setDefaultBackgroundStyle(first);
    updateBackgroundStyle('template', first, { paint: createDefaultGradient('conic') });
    expect(getBackgroundStyleOrigin(first).origin).toBe('overridden');
    setDefaultBackgroundStyle(second);
    expect(composition().backgroundStyleId).toBe(second);
    expect(composition().backgroundPaint).toEqual(createDefaultGradient('radial'));
    expect(getBackgroundOrigin().origin).toBe('inherited');
    expect(
      composition().designSystem.backgrounds!.find((style) => style.id === first)!.paint,
    ).toEqual(createDefaultGradient('conic'));
  });

  it('preserves style definitions and local flags through template switching and an .ogp round-trip', async () => {
    const { templateId, secondTemplateId, layerId } = fixture();
    const typeId = headline();
    applyTypographyToLayers([layerId], typeId);
    useProjectStore.getState().updateLayerElement(layerId, { fontSize: 100 });
    const backgroundId = background();
    setDefaultBackgroundStyle(backgroundId);
    setTypographyOverride(typeId, true);
    setBackgroundStyleOverride(backgroundId, true);
    updateCompositionBackgroundPaint('#22aa88');
    activateProjectSetTemplate(secondTemplateId);
    expect(composition().backgroundPaint).toEqual(createDefaultGradient());
    activateProjectSetTemplate(templateId);
    expect(text().element).toMatchObject({ fontSize: 100 });
    expect(text().typographyBinding!.overrides).toContain('fontSize');
    expect(composition().backgroundPaint).toBe('#22aa88');
    const saved = saveProjectSetTemplateEdits(
      currentSet(),
      templateId,
      useProjectStore.getState().project,
    );
    const reopened = await openProjectSetArchive(
      await (await createProjectSetArchive(saved)).arrayBuffer(),
    );
    expect(reopened.brandKit!.typography).toEqual(saved.brandKit!.typography);
    expect(reopened.brandKit!.backgrounds).toEqual(saved.brandKit!.backgrounds);
    expect(reopened.brandKit!.defaultBackgroundStyleId).toBe(backgroundId);
    expect(reopened.templates[0]!.backgroundOverridden).toBe(true);
    expect(reopened.templates[0]!.typographyOverrides).toContain(typeId);
    expect(reopened.templates[0]!.backgroundOverrides).toContain(backgroundId);
    const resolved = resolveProjectSetTemplate(reopened, templateId);
    expect(resolved.compositions[0]!.backgroundPaint).toBe('#22aa88');
    expect(resolved.compositions[0]!.layers[0]!.typographyBinding!.overrides).toContain('fontSize');
  });

  it('copies master Media assets into each child and packages independent real-time resources/notices', () => {
    fixture(true);
    saveTemplateSetSettings(
      { ...currentSet().settings!, supportsRealTime: false, supportsNonRealTime: true },
      {},
    );
    const id = background();
    updateBackgroundStyle('set', id, {
      paint: createMediaPaint({ source: { kind: 'clip', src: 'asset:local-clip' }, loop: true }),
    });
    setDefaultBackgroundStyle(id);
    expect(
      currentSet().assets.some(
        (asset) => asset.kind === 'media' && asset.dataUri === 'data:video/mp4;base64,AwQF',
      ),
    ).toBe(true);
    for (const template of currentSet().templates) {
      const project = resolveProjectSetTemplate(currentSet(), template.id);
      expect(project).toMatchObject({ supportsRealTime: true, supportsNonRealTime: false });
      const main = project.compositions[0]!;
      expect(
        main.assets.some(
          (asset) => asset.kind === 'media' && asset.dataUri === 'data:video/mp4;base64,AwQF',
        ),
      ).toBe(true);
      const output = buildExportArtifactsWithRuntime(project, main, 'class GraphicElement {}');
      expect(output.valid, output.errors.join('\n')).toBe(true);
      const backgroundLayer = output.descriptor!.layers[0]!;
      expect(backgroundLayer.element).toMatchObject({
        type: 'rectangle',
        fill: { type: 'media', source: { kind: 'clip' } },
      });
      if (
        backgroundLayer.element.type !== 'rectangle' ||
        typeof backgroundLayer.element.fill === 'string' ||
        backgroundLayer.element.fill.type !== 'media' ||
        backgroundLayer.element.fill.source.kind !== 'clip'
      )
        throw new Error('Expected Media background.');
      expect(backgroundLayer.element.fill.source.src).not.toMatch(/^asset:/);
      expect(output.resources).toContainEqual(
        expect.objectContaining({
          path: backgroundLayer.element.fill.source.src,
          data: 'AwQF',
          base64: true,
        }),
      );
      expect(output.resources).toContainEqual(
        expect.objectContaining({ data: 'Background clip fixture notice', base64: false }),
      );
    }
  });

  it('rejects removal of used shared styles without partial state or history changes', () => {
    const { layerId } = fixture();
    const typeId = headline();
    applyTypographyToLayers([layerId], typeId);
    const backgroundId = background();
    setDefaultBackgroundStyle(backgroundId);
    history.resetHistory();
    const before = snapshot();
    expect(() => removeTypographyPreset('set', typeId)).toThrow(/still used/);
    expect(() => removeBackgroundStyle('set', backgroundId)).toThrow(/still used/);
    expectSnapshot(before);
    expect(history.getHistorySnapshot().past).toHaveLength(0);
  });

  it('restores both parent render modes when a master Media background becomes a gradient', () => {
    fixture(true);
    saveTemplateSetSettings(
      { ...currentSet().settings!, supportsRealTime: true, supportsNonRealTime: true },
      {},
    );
    const id = background();
    updateBackgroundStyle('set', id, {
      paint: createMediaPaint({ source: { kind: 'clip', src: 'asset:local-clip' } }),
    });
    setDefaultBackgroundStyle(id);
    for (const template of currentSet().templates)
      expect(resolveProjectSetTemplate(currentSet(), template.id)).toMatchObject({
        supportsRealTime: true,
        supportsNonRealTime: false,
      });
    updateBackgroundStyle('set', id, { paint: createDefaultGradient() });
    for (const template of currentSet().templates)
      expect(resolveProjectSetTemplate(currentSet(), template.id)).toMatchObject({
        supportsRealTime: true,
        supportsNonRealTime: true,
      });
    expect(useProjectStore.getState().project).toMatchObject({
      supportsRealTime: true,
      supportsNonRealTime: true,
    });
  });

  it('keeps a local legacy color when a rich master default is introduced, then Reset adopts it', () => {
    fixture();
    useProjectStore.getState().updateCompositionSettings({ backgroundColor: '#22aa88' });
    const id = background(createDefaultGradient('radial'));
    setDefaultBackgroundStyle(id);
    expect(composition().backgroundColor).toBe('#22aa88');
    expect(composition().backgroundPaint).toBeUndefined();
    expect(getBackgroundOrigin().origin).toBe('overridden');
    resetCompositionBackground();
    expect(composition().backgroundStyleId).toBe(id);
    expect(composition().backgroundPaint).toEqual(createDefaultGradient('radial'));
    expect(getBackgroundOrigin().origin).toBe('inherited');
  });

  it('resets a local paint to its linked catalog style when there is no master default', () => {
    fixture();
    const id = background(createDefaultGradient('radial'));
    expect(currentSet().brandKit!.defaultBackgroundStyleId).toBeUndefined();
    applyBackgroundStyle(id);
    updateCompositionBackgroundPaint('#22aa88');
    resetCompositionBackground();
    expect(composition().backgroundStyleId).toBe(id);
    expect(composition().backgroundPaint).toEqual(createDefaultGradient('radial'));
    updateBackgroundStyle('set', id, { paint: createDefaultGradient('conic') });
    expect(composition().backgroundPaint).toEqual(createDefaultGradient('conic'));
  });

  it('stores a shared 1 MiB payload once in the current archive and hydrates child assets before returning projects', async () => {
    fixture(true);
    const uri = `data:video/mp4;base64,${Buffer.alloc(1024 * 1024, 0xa5).toString('base64')}`;
    const project = structuredClone(useProjectStore.getState().project);
    project.compositions[0]!.assets.find((asset) => asset.id === 'local-clip')!.dataUri = uri;
    project.compositions[0]!.assets.find((asset) => asset.id === 'local-clip')!.byteSize =
      1024 * 1024;
    useProjectStore.setState({ project });
    const id = background();
    updateBackgroundStyle('set', id, {
      paint: createMediaPaint({ source: { kind: 'clip', src: 'asset:local-clip' } }),
    });
    setDefaultBackgroundStyle(id);
    const set = currentSet();
    const sourceBefore = structuredClone(set);
    const archive = await createProjectSetArchive(set);
    const bytes = await archive.arrayBuffer();
    const zip = await JSZip.loadAsync(bytes);
    type Manifest = {
      schemaVersion: number;
      assets: Array<{ id: string; kind: string; path: string; sha256: string }>;
      resources: Array<{
        path: string;
        sha256: string;
        byteLength: number;
        encoding: 'data-uri-utf8';
      }>;
      templates: Array<{
        source: string;
        resourceRefs: Array<{ path: Array<string | number>; sha256: string }>;
      }>;
    };
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string')) as Manifest;
    expect(manifest.schemaVersion).toBe(PROJECT_SET_SCHEMA_VERSION);
    const media = manifest.assets.filter((asset) => asset.kind === 'media');
    expect(media).toHaveLength(1);
    expect(new Set(media.map((asset) => asset.path)).size).toBe(1);
    const pooled = manifest.resources.find((resource) => resource.path === media[0]!.path)!;
    expect(pooled).toMatchObject({ encoding: 'data-uri-utf8', sha256: media[0]!.sha256 });
    const storedUri = await zip.file(pooled.path)!.async('string');
    expect(storedUri).toBe(uri);
    expect(new TextEncoder().encode(storedUri).byteLength).toBe(pooled.byteLength);
    expect(Buffer.from(storedUri.split(',')[1]!, 'base64')).toEqual(
      Buffer.alloc(1024 * 1024, 0xa5),
    );
    const resourcePayloads = await Promise.all(
      manifest.resources.map((resource) => zip.file(resource.path)!.async('string')),
    );
    expect(resourcePayloads.filter((payload) => payload === uri)).toHaveLength(1);
    expect(zip.file(/^resources\/.*\.uri$/)).toHaveLength(manifest.resources.length);
    let totalSourceBytes = 0;
    for (const template of manifest.templates) {
      const source = await zip.file(template.source)!.async('string');
      totalSourceBytes += new TextEncoder().encode(source).byteLength;
      expect(source).not.toContain(uri);
      const child = JSON.parse(source) as Project & { archiveFragment: { format: string } };
      expect(child.archiveFragment.format).toBe('ograf-template-fragment');
      expect(template.resourceRefs.length).toBeGreaterThan(0);
      for (const reference of template.resourceRefs) {
        let placeholder: unknown = child;
        for (const segment of reference.path)
          placeholder = (placeholder as Record<string | number, unknown>)[segment];
        expect(placeholder).toBe('');
        expect(manifest.resources.some((resource) => resource.sha256 === reference.sha256)).toBe(
          true,
        );
      }
    }
    expect(totalSourceBytes).toBeLessThan(128 * 1024);
    expect(archive.size).toBeLessThan(128 * 1024);
    expect(set).toEqual(sourceBefore);
    const reopened = await openProjectSetArchive(bytes);
    for (const template of reopened.templates) {
      const main = resolveProjectSetTemplate(reopened, template.id).compositions[0]!;
      const asset = main.assets.find((item) => item.kind === 'media')!;
      expect(asset.dataUri).toBe(uri);
      expect(Buffer.from(asset.dataUri.split(',')[1]!, 'base64').byteLength).toBe(1024 * 1024);
      expect(main.assets.every((item) => item.dataUri !== '')).toBe(true);
    }

    const payloadTamper = await JSZip.loadAsync(bytes);
    payloadTamper.file(media[0]!.path, new Uint8Array([1, 2, 3]));
    await expect(
      openProjectSetArchive(await payloadTamper.generateAsync({ type: 'uint8array' })),
    ).rejects.toThrow(/integrity verification/);
    const referenceTamper = await JSZip.loadAsync(bytes);
    const modified = structuredClone(manifest);
    modified.templates[0]!.resourceRefs[0]!.sha256 = '0'.repeat(64);
    referenceTamper.file('manifest.json', JSON.stringify(modified));
    await expect(
      openProjectSetArchive(await referenceTamper.generateAsync({ type: 'uint8array' })),
    ).rejects.toThrow(/reference is missing its resource/);
    const duplicateTamper = await JSZip.loadAsync(bytes);
    const duplicate = structuredClone(manifest);
    duplicate.templates[0]!.resourceRefs.push(duplicate.templates[0]!.resourceRefs[0]!);
    duplicateTamper.file('manifest.json', JSON.stringify(duplicate));
    await expect(
      openProjectSetArchive(await duplicateTamper.generateAsync({ type: 'uint8array' })),
    ).rejects.toThrow(/Duplicate embedded resource reference/);
    const missingTamper = await JSZip.loadAsync(bytes);
    const missing = structuredClone(manifest);
    missing.templates[0]!.resourceRefs = [];
    missingTamper.file('manifest.json', JSON.stringify(missing));
    const missingRejected = await openProjectSetArchive(
      await missingTamper.generateAsync({ type: 'uint8array' }),
    ).then(
      () => false,
      () => true,
    );
    expect(
      missingRejected,
      'Unmapped compact placeholders must not be published as empty assets',
    ).toBe(true);
  }, 15_000);
});
