import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import {
  createAsset,
  createFieldDefinition,
  createProject,
  createTextLayer,
} from '@ograf-editor/scene-model';
import {
  addProjectSetTemplate,
  createProjectSet,
  createProjectSetArchive,
  openProjectSetArchive,
  resolveProjectSetTemplate,
  saveProjectSetTemplateEdits,
} from './projectSet';
import { useProjectStore } from './projectStore';
import { useProjectSetStore } from './projectSetStore';
import { useSelectionStore } from './selectionStore';
import { useTestDataStore } from './testDataStore';
import { parseProjectSource } from './studioDocument';

vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
const profileStorage = new Map<string, string>();
vi.stubGlobal('window', {
  clearTimeout: (timer: ReturnType<typeof setTimeout> | undefined) => clearTimeout(timer),
  addEventListener: () => undefined,
  localStorage: {
    getItem: (key: string) => profileStorage.get(key) ?? null,
    setItem: (key: string, value: string) => profileStorage.set(key, value),
    removeItem: (key: string) => profileStorage.delete(key),
  },
});

const history = await import('./historyStore');
const { setTemplateSettingOverrides, setTemplateSettingOverride } =
  await import('./templateSetInheritance');
const {
  SETTINGS_SCOPE_SECTIONS,
  settingsSectionForScope,
  saveTemplateSetSettings,
  useTemplateSetSettingsStore,
} = await import('./templateSetSettingsStore');
const { useWorkspaceStore, hydrateWorkspaceState, serializeWorkspaceState } =
  await import('./workspaceStore');
const { WORKSPACE_STORAGE_KEY } = await import('./workspaceModel');
const originalWorkspace = serializeWorkspaceState(useWorkspaceStore.getState());

function project(name: string) {
  const value = createProject({ name });
  const composition = value.compositions[0]!;
  composition.assets.push(
    createAsset({
      id: 'shared-font',
      name: 'Settings Test Sans',
      kind: 'font',
      fontFamily: 'Settings Test Sans',
      dataUri: 'data:font/woff2;base64,AAEC',
      mimeType: 'font/woff2',
      originalFileName: 'settings-test.woff2',
      byteSize: 3,
    }),
  );
  const title = createTextLayer();
  title.name = 'Title';
  if (title.element.type !== 'text') throw new Error('Expected text layer.');
  title.element.content = `${name} title`;
  title.element.fontFamily = 'Settings Test Sans';
  title.animationTracks.opacity = [
    { id: `opacity-${name}-start`, frame: 0, value: 0, easing: 'linear' },
    { id: `opacity-${name}-end`, frame: 25, value: 1, easing: 'linear' },
  ];
  const titleField = createFieldDefinition('text', {
    id: `title-field-${name}`,
    key: 'title',
    defaultValue: `${name} title`,
  });
  title.bindings = [{ fieldId: titleField.id, targetProperty: 'content' }];
  composition.dataFields.push(titleField);
  composition.layers.push(title);
  return value;
}

function fixture() {
  let set = createProjectSet('Settings persistence', project('Headline'));
  set = addProjectSetTemplate(set, project('Ticker'));
  const independent = project('Independent');
  Object.assign(independent.compositions[0]!, {
    width: 1280,
    height: 720,
    frameRate: 30,
    backgroundColor: '#551122',
  });
  set = addProjectSetTemplate(set, independent, independent.name, false);
  const templateId = set.templates[0]!.id;
  useProjectStore.getState().loadProject(resolveProjectSetTemplate(set, templateId));
  useProjectSetStore.setState({ projectSet: set, activeTemplateId: templateId });
  history.resetHistory();
  return {
    templateId,
    followerId: set.templates[1]!.id,
    independentId: set.templates[2]!.id,
  };
}

function currentSet() {
  const set = useProjectSetStore.getState().projectSet;
  if (!set) throw new Error('Expected an open set.');
  return set;
}

function snapshotDocument() {
  return structuredClone({
    project: useProjectStore.getState().project,
    projectSet: useProjectSetStore.getState().projectSet,
    activeTemplateId: useProjectSetStore.getState().activeTemplateId,
    selection: useSelectionStore.getState().selectedLayerIds,
  });
}

function editScopes() {
  useTemplateSetSettingsStore.getState().show('template', 'output');
  // A same-value local override must remain explicit after saving and reloading.
  setTemplateSettingOverrides(['width', 'frameRate', 'backgroundColor'], true);
  useProjectStore.getState().updateCompositionSettings({
    width: 1600,
    backgroundColor: '#335577',
  });
  const overriddenFrameRate = useProjectStore.getState().project.compositions[0]!.frameRate;
  useTemplateSetSettingsStore.getState().show('template-set', 'output');
  const defaults = structuredClone(currentSet().settings!);
  Object.assign(defaults, {
    width: 2560,
    height: 1440,
    frameRate: 50,
    backgroundColor: '#224466',
    updateTransitionFrames: 18,
    updateInterruption: 'replace',
  });
  defaults.layout.gridSize = 32;
  saveTemplateSetSettings(defaults, {});
  return { defaults, overriddenFrameRate };
}

describe('unified settings scopes and saved documents', () => {
  beforeEach(() => {
    useTemplateSetSettingsStore.getState().close();
    useProjectSetStore.getState().clearProjectSet();
    useProjectStore.getState().newProject();
    useSelectionStore.setState({ selectedLayerId: null, selectedLayerIds: [] });
    useTestDataStore.getState().resetAll();
    history.resetHistory();
    profileStorage.clear();
    hydrateWorkspaceState(originalWorkspace);
  });

  afterAll(() => {
    history.resetHistory();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('opens every scope and closes without changing document values, identities or history', () => {
    fixture();
    const before = snapshotDocument();
    const projectReference = useProjectStore.getState().project;
    const setReference = currentSet();
    for (const scope of ['studio', 'template-set', 'template'] as const) {
      for (const section of SETTINGS_SCOPE_SECTIONS[scope]) {
        useTemplateSetSettingsStore.getState().show(scope, section);
        expect(useTemplateSetSettingsStore.getState()).toMatchObject({
          open: true,
          scope,
          section,
        });
        useTemplateSetSettingsStore.getState().close();
        expect(useTemplateSetSettingsStore.getState().open).toBe(false);
      }
    }
    expect(snapshotDocument()).toEqual(before);
    expect(useProjectStore.getState().project).toBe(projectReference);
    expect(currentSet()).toBe(setReference);
    expect(history.getHistorySnapshot()).toMatchObject({ past: [], future: [] });
  });

  it('uses a valid initial category for each scope and preserves the existing gear entry point', () => {
    expect(settingsSectionForScope('studio', 'nodos')).toBe('nodos');
    expect(settingsSectionForScope('template-set', 'nodos')).toBe('output');
    expect(settingsSectionForScope('template', 'nodos')).toBe('output');
    for (const scope of ['studio', 'template-set', 'template'] as const)
      expect(settingsSectionForScope(scope, 'plugins')).toBe('plugins');
    expect(settingsSectionForScope('studio', 'output')).toBe('workspace');
    expect(settingsSectionForScope('template-set', 'background')).toBe('output');
    expect(settingsSectionForScope('template', 'inheritance')).toBe('output');
    useTemplateSetSettingsStore.getState().show('studio');
    expect(useTemplateSetSettingsStore.getState()).toMatchObject({
      scope: 'studio',
      section: 'workspace',
    });
    useTemplateSetSettingsStore.getState().show();
    expect(useTemplateSetSettingsStore.getState()).toMatchObject({
      scope: 'template-set',
      section: 'output',
    });
    useTemplateSetSettingsStore.getState().show('template');
    expect(useTemplateSetSettingsStore.getState()).toMatchObject({
      scope: 'template',
      section: 'output',
    });
  });

  it.each(['compact', 'compatible'] as const)(
    'saves and reloads %s settings, same-value overrides and independent templates',
    async (archiveMode) => {
      const { templateId, followerId, independentId } = fixture();
      const { defaults, overriddenFrameRate } = editScopes();
      const saved = saveProjectSetTemplateEdits(
        currentSet(),
        templateId,
        useProjectStore.getState().project,
      );
      const archive = await createProjectSetArchive(saved, { archiveMode });
      const reopened = await openProjectSetArchive(await archive.arrayBuffer());
      expect(reopened.settings).toEqual(defaults);
      expect(reopened.templates.find((item) => item.id === templateId)?.settingsOverrides).toEqual([
        'width',
        'frameRate',
        'backgroundColor',
      ]);
      expect(resolveProjectSetTemplate(reopened, templateId).compositions[0]).toMatchObject({
        width: 1600,
        height: 1440,
        frameRate: overriddenFrameRate,
        backgroundColor: '#335577',
        updateTransitionFrames: 18,
        updateInterruption: 'replace',
        layout: { gridSize: 32 },
      });
      expect(resolveProjectSetTemplate(reopened, followerId).compositions[0]).toMatchObject({
        width: 2560,
        height: 1440,
        frameRate: 50,
        backgroundColor: '#224466',
      });
      expect(reopened.templates.find((item) => item.id === independentId)?.inheritSettings).toBe(
        false,
      );
      expect(resolveProjectSetTemplate(reopened, independentId).compositions[0]).toMatchObject({
        width: 1280,
        height: 720,
        frameRate: 30,
        backgroundColor: '#551122',
      });

      useProjectSetStore.setState({ projectSet: reopened, activeTemplateId: templateId });
      useProjectStore.getState().loadProject(resolveProjectSetTemplate(reopened, templateId));
      setTemplateSettingOverride('width', false);
      const resetArchive = await createProjectSetArchive(currentSet(), { archiveMode });
      const reset = await openProjectSetArchive(await resetArchive.arrayBuffer());
      expect(
        reset.templates.find((item) => item.id === templateId)?.settingsOverrides,
      ).not.toContain('width');
      expect(resolveProjectSetTemplate(reset, templateId).compositions[0]!.width).toBe(2560);
    },
  );

  it('keeps a standalone template portable with effective defaults, resources, animation and bindings', () => {
    const { followerId } = fixture();
    editScopes();
    const resolved = resolveProjectSetTemplate(currentSet(), followerId);
    const reopened = parseProjectSource(JSON.stringify(resolved));
    expect(reopened.compositions[0]).toMatchObject({
      width: 2560,
      height: 1440,
      frameRate: 50,
      backgroundColor: '#224466',
      updateTransitionFrames: 18,
    });
    expect(reopened.compositions[0]!.assets).toContainEqual(
      expect.objectContaining({
        kind: 'font',
        fontFamily: 'Settings Test Sans',
        dataUri: 'data:font/woff2;base64,AAEC',
      }),
    );
    expect(reopened.compositions[0]!.layers[0]!.animationTracks.opacity).toEqual(
      resolved.compositions[0]!.layers[0]!.animationTracks.opacity,
    );
    expect(
      reopened.compositions[0]!.layers[0]!.animationTracks.opacity?.map((key) => key.frame),
    ).toEqual([0, 25]);
    expect(reopened.compositions[0]!.layers[0]!.bindings).toEqual(
      resolved.compositions[0]!.layers[0]!.bindings,
    );
    expect(JSON.stringify(reopened)).not.toMatch(
      /settingsOverrides|inheritSettings|ograf-studio-workspaces/,
    );
  });

  it('saves and reloads user workspaces independently of both template and set files', async () => {
    const { templateId } = fixture();
    const beforeDocument = snapshotDocument();
    const olderProfile = serializeWorkspaceState(useWorkspaceStore.getState());
    delete olderProfile.editorPreferences?.exportDefaults;
    hydrateWorkspaceState(olderProfile);
    expect(useWorkspaceStore.getState().editorPreferences.exportDefaults).toEqual({
      scope: 'set',
      format: 'both',
    });
    useWorkspaceStore.getState().applyPreset('builtin-default');
    useTemplateSetSettingsStore.getState().show('studio', 'workspace');
    useWorkspaceStore.getState().updateDetached('rules', {
      left: 140,
      top: 90,
      width: 640,
      height: 480,
    });
    const presetId = useWorkspaceStore.getState().saveAs('Settings isolation workspace');
    useWorkspaceStore.getState().updateStartup({
      mode: 'preset',
      presetId,
      restoreDetached: false,
    });
    useWorkspaceStore.getState().updateEditorPreferences({
      durationUnit: 'timecode',
      assistantContext: {
        contextWindowTokens: 131_072,
        maxHistoryTokens: 32_768,
        maxToolResultTokens: 2048,
      },
    });
    useWorkspaceStore.getState().updateEditorPreferences({
      exportDefaults: { scope: 'template', format: 'html' },
    });
    useWorkspaceStore.getState().flush();
    const savedProfile = JSON.parse(profileStorage.get(WORKSPACE_STORAGE_KEY)!);
    hydrateWorkspaceState(originalWorkspace);
    hydrateWorkspaceState(savedProfile);
    const restoredProfile = serializeWorkspaceState(useWorkspaceStore.getState());
    expect(restoredProfile.startup).toEqual({
      mode: 'preset',
      presetId,
      restoreDetached: false,
    });
    expect(restoredProfile.editorPreferences?.durationUnit).toBe('timecode');
    expect(restoredProfile.editorPreferences?.exportDefaults).toEqual({
      scope: 'template',
      format: 'html',
    });
    expect(restoredProfile.editorPreferences?.assistantContext).toEqual({
      contextWindowTokens: 131_072,
      maxHistoryTokens: 32_768,
      maxToolResultTokens: 2048,
    });
    expect(restoredProfile.session.current.detached.rules).toEqual({
      left: 140,
      top: 90,
      width: 640,
      height: 480,
    });
    expect(snapshotDocument()).toEqual(beforeDocument);

    const archive = await createProjectSetArchive(currentSet());
    const archiveBytes = await archive.arrayBuffer();
    const zip = await JSZip.loadAsync(archiveBytes);
    for (const file of Object.values(zip.files).filter((entry) => !entry.dir)) {
      const text = await file.async('string');
      expect(text).not.toContain('Settings isolation workspace');
      expect(text).not.toContain('ograf-studio-workspaces');
      expect(text).not.toContain('assistantContext');
      expect(text).not.toContain('exportDefaults');
    }
    const set = await openProjectSetArchive(archiveBytes);
    const standalone = parseProjectSource(
      JSON.stringify(resolveProjectSetTemplate(set, templateId)),
    );
    useProjectSetStore.getState().clearProjectSet();
    useProjectStore.getState().loadProject(standalone);
    expect(serializeWorkspaceState(useWorkspaceStore.getState())).toEqual(restoredProfile);
    useProjectSetStore.setState({ projectSet: set, activeTemplateId: templateId });
    useProjectStore.getState().loadProject(resolveProjectSetTemplate(set, templateId));
    expect(serializeWorkspaceState(useWorkspaceStore.getState())).toEqual(restoredProfile);
  });
});
