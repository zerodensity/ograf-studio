import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultTransform,
  createLayerKeyframe,
  createLayerOfKind,
  createProject,
  type Project,
} from '@ograf-editor/scene-model';
import { buildExportArtifactsWithRuntime } from '@ograf-editor/codegen';
import { useProjectStore } from './projectStore';
import { useProjectSetStore } from './projectSetStore';
import { useSelectionStore } from './selectionStore';
import { useTestDataStore } from './testDataStore';
import { resolveDesignerElement } from './dataBinding';
import {
  addProjectSetTemplate,
  createProjectSet,
  createProjectSetArchive,
  openProjectSetArchive,
  resolveProjectSetTemplate,
  saveProjectSetTemplateEdits,
} from './projectSet';

// Keep JSZip's asynchronous compression scheduler real while controlling history bursts.
vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
vi.stubGlobal('window', {
  clearTimeout: (timer: ReturnType<typeof setTimeout> | undefined) => clearTimeout(timer),
});

const history = await import('./historyStore');
const { setTemplateSettingOverride, setTemplateSettingOverrides } =
  await import('./templateSetInheritance');
const { saveTemplateSetSettings } = await import('./templateSetSettingsStore');
const {
  getBrandTokenOrigin,
  getBrandBindingOrigin,
  initializeSharedBrandKit,
  setBrandTokenOverride,
  setBrandBindingOverride,
  updateSharedBrandBackground,
  updateSharedBrandToken,
} = await import('./templateSetBrandKit');

function brandedProject(name: string, suffix: string, fontFamily = 'Show Sans'): Project {
  const project = createProject({ name });
  const composition = project.compositions[0]!;
  composition.designSystem = {
    name: 'Show branding',
    tokens: [
      {
        id: `accent-${suffix}`,
        key: 'brand.accent',
        name: 'Accent',
        type: 'color',
        value: '#1166aa',
        description: 'Shared accent',
      },
      {
        id: `font-${suffix}`,
        key: 'brand.font',
        name: 'Headline font',
        type: 'font-family',
        value: fontFamily,
        description: 'Shared headline font',
      },
    ],
  };
  const text = createLayerOfKind('text');
  if (text.element.type !== 'text') throw new Error('Expected text.');
  text.element.content = `${name} headline`;
  text.element.fontFamily = fontFamily;
  text.element.color = '#1166aa';
  text.element.fill = '#1166aa';
  text.keyframes = [createLayerKeyframe(0, createDefaultTransform())];
  text.designTokenBindings = [
    { tokenId: `accent-${suffix}`, targetProperty: 'fill' },
    { tokenId: `font-${suffix}`, targetProperty: 'fontFamily' },
  ];
  composition.layers.push(text);
  // Packaging fixtures, not fonts presented as browser-rendering or certification proof.
  composition.assets.push({
    id: `font-asset-${suffix}`,
    kind: 'font',
    name: `${fontFamily}.woff2`,
    fontFamily,
    dataUri: `data:font/woff2;base64,${suffix === 'news' ? 'AAEC' : 'AwQF'}`,
    mimeType: 'font/woff2',
    originalFileName: `${fontFamily}.woff2`,
    byteSize: 3,
    licenseName: 'MIT',
    licenseText: `Test font ${suffix} notice`,
  });
  return project;
}

function fixture() {
  let set = createProjectSet('Evening Show', brandedProject('News', 'news'));
  set = addProjectSetTemplate(set, brandedProject('Sports', 'sports', 'Sports Sans'));
  const templateId = set.templates[0]!.id;
  useProjectStore.getState().loadProject(resolveProjectSetTemplate(set, templateId));
  useProjectSetStore.setState({ projectSet: set, activeTemplateId: templateId });
  history.resetHistory();
  return { templateId, secondTemplateId: set.templates[1]!.id };
}

function currentSet() {
  const set = useProjectSetStore.getState().projectSet;
  if (!set) throw new Error('Expected an open Template Set.');
  return set;
}

function currentTemplate() {
  const id = useProjectSetStore.getState().activeTemplateId;
  return currentSet().templates.find((template) => template.id === id)!;
}

function currentComposition() {
  const project = useProjectStore.getState().project;
  return project.compositions.find((composition) => composition.id === project.mainCompositionId)!;
}

function currentText() {
  const layer = currentComposition().layers[0]!;
  if (layer.element.type !== 'text') throw new Error('Expected text.');
  return layer;
}

function snapshot() {
  return structuredClone({
    project: useProjectStore.getState().project,
    projectSet: currentSet(),
    activeTemplateId: useProjectSetStore.getState().activeTemplateId,
  });
}

function expectSnapshot(expected: ReturnType<typeof snapshot>) {
  expect(useProjectStore.getState().project).toEqual(expected.project);
  expect(currentSet()).toEqual(expected.projectSet);
  expect(useProjectSetStore.getState().activeTemplateId).toBe(expected.activeTemplateId);
}

describe('Template Set inheritance services and persistence', () => {
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

  it('keeps overridden width/background after saving edits and changing the master defaults', () => {
    const { templateId, secondTemplateId } = fixture();
    setTemplateSettingOverrides(['width', 'backgroundColor'], true);
    useProjectStore.getState().updateCompositionSettings({
      width: 1440,
      backgroundColor: '#334455',
    });
    saveTemplateSetSettings(
      { ...currentSet().settings!, width: 2560, height: 1440, backgroundColor: '#778899' },
      {},
    );
    expect(currentTemplate().settingsOverrides).toEqual(['width', 'backgroundColor']);
    expect(currentComposition()).toMatchObject({
      width: 1440,
      height: 1440,
      backgroundColor: '#334455',
    });
    const resolved = resolveProjectSetTemplate(currentSet(), templateId);
    expect(resolved.compositions[0]).toMatchObject({ width: 1440, backgroundColor: '#334455' });
    expect(resolveProjectSetTemplate(currentSet(), secondTemplateId).compositions[0]).toMatchObject(
      {
        width: 2560,
        height: 1440,
        backgroundColor: '#778899',
      },
    );
  });

  it('retains an explicitly overridden same-value setting when the master later changes', () => {
    fixture();
    const originalWidth = currentComposition().width;
    setTemplateSettingOverride('width', true);
    saveTemplateSetSettings({ ...currentSet().settings!, width: originalWidth + 200 }, {});
    expect(currentTemplate().settingsOverrides).toContain('width');
    expect(currentComposition().width).toBe(originalWidth);
    expect(currentSet().settings!.width).toBe(originalWidth + 200);
  });

  it('detects direct child edits on save without overriding unchanged settings', () => {
    const { templateId } = fixture();
    useProjectStore.getState().updateCompositionSettings({ width: 1280 });
    const saved = saveProjectSetTemplateEdits(
      currentSet(),
      templateId,
      useProjectStore.getState().project,
    );
    expect(saved.templates[0]!.settingsOverrides).toEqual(['width']);
    expect(resolveProjectSetTemplate(saved, templateId).compositions[0]!.width).toBe(1280);
  });

  it('reset restores the master value and undo/redo restores both metadata and project', () => {
    fixture();
    setTemplateSettingOverride('width', true);
    useProjectStore.getState().updateCompositionSettings({ width: 1440 });
    history.resetHistory();
    const before = snapshot();
    setTemplateSettingOverride('width', false);
    expect(currentComposition().width).toBe(currentSet().settings!.width);
    expect(currentTemplate().settingsOverrides).not.toContain('width');
    const after = snapshot();
    expect(history.getHistorySnapshot().past).toHaveLength(1);
    history.undo();
    expectSnapshot(before);
    history.redo();
    expectSnapshot(after);
  });

  it('undo/redo restores a master-default edit together with the resolved child and overrides', () => {
    fixture();
    setTemplateSettingOverride('width', true);
    useProjectStore.getState().updateCompositionSettings({ width: 1440 });
    history.resetHistory();
    const before = snapshot();
    saveTemplateSetSettings({ ...currentSet().settings!, width: 2560, height: 1440 }, {});
    const after = snapshot();
    expect(currentComposition()).toMatchObject({ width: 1440, height: 1440 });
    expect(history.getHistorySnapshot().past).toHaveLength(1);
    history.undo();
    expectSnapshot(before);
    history.redo();
    expectSnapshot(after);
  });

  it('shared palette and font edits propagate while direct object edits remain local overrides', () => {
    const { secondTemplateId } = fixture();
    initializeSharedBrandKit();
    const layerId = currentText().id;
    useProjectStore.getState().updateLayerElement(layerId, {
      fill: '#22aa88',
      color: '#22aa88',
      fontFamily: 'Local Sans',
    });
    expect(currentText().designTokenBindings).toEqual([
      { tokenId: 'accent-news', targetProperty: 'fill', overridden: true },
      { tokenId: 'font-news', targetProperty: 'fontFamily', overridden: true },
    ]);
    updateSharedBrandToken('accent-news', { value: '#bb4400' });
    updateSharedBrandToken('font-news', { value: 'Sports Sans' });
    expect(currentText().element).toMatchObject({ fill: '#22aa88', fontFamily: 'Local Sans' });
    const other = resolveProjectSetTemplate(currentSet(), secondTemplateId).compositions[0]!;
    expect(other.layers[0]!.element).toMatchObject({ fill: '#bb4400', fontFamily: 'Sports Sans' });
    expect(other.assets.some((asset) => asset.fontFamily === 'Sports Sans')).toBe(true);
  });

  it('retains explicit same-value token overrides and resets them to the latest master', () => {
    fixture();
    initializeSharedBrandKit();
    setBrandTokenOverride('accent-news', true);
    updateSharedBrandToken('accent-news', { value: '#bb4400' });
    expect(getBrandTokenOrigin('accent-news').origin).toBe('overridden');
    expect(currentText().element).toMatchObject({ fill: '#1166aa' });
    setBrandTokenOverride('accent-news', false);
    expect(getBrandTokenOrigin('accent-news').origin).toBe('inherited');
    expect(currentText().element).toMatchObject({ fill: '#bb4400' });
  });

  it('marks a direct local token edit overridden immediately and keeps it through later master edits', () => {
    fixture();
    initializeSharedBrandKit();
    expect(getBrandTokenOrigin('accent-news').origin).toBe('inherited');
    useProjectStore.getState().updateDesignToken('accent-news', { value: '#22aa88' });
    expect(getBrandTokenOrigin('accent-news').origin).toBe('overridden');
    expect(currentTemplate().brandKitOverrides).toContain('accent-news');
    updateSharedBrandToken('accent-news', { value: '#bb4400' });
    expect(currentText().element).toMatchObject({ fill: '#22aa88' });
    expect(currentSet().brandKit!.tokens.find((token) => token.id === 'accent-news')!.value).toBe(
      '#bb4400',
    );
  });

  it.each(['fontSize', 'fill'] as const)(
    'resets an object %s override without cloning an Immer draft and supports undo/redo',
    (property) => {
      fixture();
      const layerId = currentText().id;
      const sizeTokenId = useProjectStore.getState().addDesignToken('number');
      useProjectStore.getState().updateDesignToken(sizeTokenId, {
        key: 'brand.size',
        name: 'Headline size',
        value: 60,
      });
      useProjectStore.getState().bindDesignToken(layerId, sizeTokenId, 'fontSize');
      initializeSharedBrandKit();
      useProjectStore.getState().updateLayerElement(layerId, {
        fontSize: 84,
        fill: '#22aa88',
        content: 'Locally edited headline',
      });
      updateSharedBrandToken('accent-news', { value: '#bb4400' });
      updateSharedBrandToken(sizeTokenId, { value: 100 });
      expect(currentText().element).toMatchObject({ fontSize: 84, fill: '#22aa88' });
      expect(getBrandBindingOrigin(layerId, property).origin).toBe('overridden');
      history.resetHistory();
      const before = snapshot();

      expect(() => setBrandBindingOverride(layerId, property, false)).not.toThrow();
      expect(currentText().element).toMatchObject({
        fontSize: property === 'fontSize' ? 100 : 84,
        fill: property === 'fill' ? '#bb4400' : '#22aa88',
        content: 'Locally edited headline',
      });
      expect(getBrandBindingOrigin(layerId, property).origin).toBe('inherited');
      const other = property === 'fill' ? 'fontSize' : 'fill';
      expect(getBrandBindingOrigin(layerId, other).origin).toBe('overridden');
      const after = snapshot();
      expect(history.getHistorySnapshot().past).toHaveLength(1);
      history.undo();
      expectSnapshot(before);
      expect(getBrandBindingOrigin(layerId, property).origin).toBe('overridden');
      history.redo();
      expectSnapshot(after);
      expect(getBrandBindingOrigin(layerId, property).origin).toBe('inherited');
    },
  );

  it('keeps data-bound color edits local and resets the visible authored default to the master', () => {
    fixture();
    initializeSharedBrandKit();
    const layerId = currentText().id;
    const fieldId = useProjectStore.getState().addDataField('color');
    useProjectStore.getState().updateDataField(fieldId, {
      key: 'headlineColor',
      defaultTokenId: 'accent-news',
    });
    useProjectStore.getState().setLayerBindings(layerId, [{ fieldId, targetProperty: 'fill' }]);
    useTestDataStore.getState().setValue(fieldId, '#aa11ee');
    useProjectStore.getState().updateLayerElement(layerId, { fill: '#22aa88' });
    expect(useTestDataStore.getState().values[fieldId]).toBeUndefined();
    expect(currentComposition().dataFields.find((field) => field.id === fieldId)).toMatchObject({
      defaultValue: '#22aa88',
    });
    expect(
      currentComposition().dataFields.find((field) => field.id === fieldId)!.defaultTokenId,
    ).toBeUndefined();
    updateSharedBrandToken('accent-news', { value: '#bb4400' });
    const visible = () =>
      resolveDesignerElement(
        currentText(),
        useTestDataStore.getState().values,
        currentComposition().dataFields,
      );
    expect(visible()).toMatchObject({ fill: '#22aa88' });
    setBrandBindingOverride(layerId, 'fill', false);
    expect(currentText().element).toMatchObject({ fill: '#bb4400' });
    expect(visible()).toMatchObject({ fill: '#bb4400' });
    expect(currentText().bindings).toEqual([{ fieldId, targetProperty: 'fill' }]);
    updateSharedBrandToken('accent-news', { value: '#ffcc00' });
    expect(visible()).toMatchObject({ fill: '#ffcc00' });
  });

  it('undo/redo restores master Brand Kit edits and their materialized object values', () => {
    fixture();
    initializeSharedBrandKit();
    history.resetHistory();
    const before = snapshot();
    updateSharedBrandToken('accent-news', { value: '#bb4400' });
    expect(currentText().element).toMatchObject({ fill: '#bb4400' });
    const after = snapshot();
    expect(history.getHistorySnapshot().past).toHaveLength(1);
    history.undo();
    expectSnapshot(before);
    history.redo();
    expectSnapshot(after);
  });

  it('shared background changes respect a child background override', () => {
    const { secondTemplateId } = fixture();
    setTemplateSettingOverride('backgroundColor', true);
    useProjectStore.getState().updateCompositionSettings({ backgroundColor: '#334455' });
    updateSharedBrandBackground('#778899');
    expect(currentComposition().backgroundColor).toBe('#334455');
    expect(currentSet().settings!.backgroundColor).toBe('#778899');
    expect(
      resolveProjectSetTemplate(currentSet(), secondTemplateId).compositions[0]!.backgroundColor,
    ).toBe('#778899');
  });

  it('round-trips overrides, branding and font bytes into self-contained child exports', async () => {
    const { templateId, secondTemplateId } = fixture();
    initializeSharedBrandKit();
    setTemplateSettingOverride('width', true);
    useProjectStore.getState().updateCompositionSettings({ width: 1440 });
    setBrandTokenOverride('accent-news', true);
    useProjectStore.getState().updateDesignToken('accent-news', { value: '#22aa88' });
    updateSharedBrandToken('accent-news', { value: '#bb4400' });
    const saved = saveProjectSetTemplateEdits(
      currentSet(),
      templateId,
      useProjectStore.getState().project,
    );
    const archive = await createProjectSetArchive(saved);
    const reopened = await openProjectSetArchive(await archive.arrayBuffer());
    expect(reopened.templates[0]!.settingsOverrides).toContain('width');
    expect(reopened.templates[0]!.brandKitOverrides).toContain('accent-news');
    expect(reopened.brandKit).toEqual(saved.brandKit);
    expect(reopened.assets).toEqual(saved.assets);
    const news = resolveProjectSetTemplate(reopened, templateId);
    expect(news.compositions[0]!.width).toBe(1440);
    expect(news.compositions[0]!.layers[0]!.element).toMatchObject({ fill: '#22aa88' });

    const sports = resolveProjectSetTemplate(reopened, secondTemplateId);
    const composition = sports.compositions[0]!;
    expect(composition.layers[0]!.element).toMatchObject({
      fill: '#bb4400',
      fontFamily: 'Show Sans',
    });
    const font = composition.assets.find(
      (asset) => asset.kind === 'font' && asset.fontFamily === 'Show Sans',
    )!;
    expect(font.dataUri).toBe('data:font/woff2;base64,AAEC');
    const output = buildExportArtifactsWithRuntime(sports, composition, 'class GraphicElement {}');
    expect(output.valid, output.errors.join('\n')).toBe(true);
    const descriptorFont = output.descriptor!.fonts!.find((entry) => entry.family === 'Show Sans')!;
    expect(descriptorFont.source).not.toMatch(/^(?:asset:|asset-slot:)/);
    expect(output.resources).toContainEqual(
      expect.objectContaining({ path: descriptorFont.source, data: 'AAEC', base64: true }),
    );
    expect(output.resources).toContainEqual(
      expect.objectContaining({ data: 'Test font news notice', base64: false }),
    );
    expect(JSON.stringify(output.descriptor)).not.toMatch(/settingsOverrides|brandKitOverrides/);
    expect(JSON.stringify(output.descriptor)).not.toContain('designSystem');
  });
});
