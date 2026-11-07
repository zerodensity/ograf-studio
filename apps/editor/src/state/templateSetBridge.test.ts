import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultTransform,
  createLayerKeyframe,
  createLayerOfKind,
  createAsset,
  createProject,
  type DesignSystem,
  type Project,
} from '@ograf-editor/scene-model';
import { useProjectStore } from './projectStore';
import { useProjectSetStore } from './projectSetStore';
import { useSelectionStore } from './selectionStore';
import {
  addProjectSetAssetSlot,
  addProjectSetTemplate,
  bindProjectSetAsset,
  createProjectSet,
  resolveProjectSetTemplate,
  setProjectSetAssetBindingInherited,
  setProjectSetAssetSlotSource,
} from './projectSet';

vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
vi.stubGlobal('window', {
  clearTimeout: (timer: ReturnType<typeof setTimeout> | undefined) => clearTimeout(timer),
});
const history = await import('./historyStore');
const { handleTemplateSetRequest } = await import('./templateSetBridge');

const sharedToken = {
  id: 'shared-accent',
  key: 'accent',
  name: 'Accent',
  type: 'color' as const,
  value: '#bb4400',
  description: 'Shared accent',
};
const sharedKit: DesignSystem = { name: 'Master branding', tokens: [sharedToken] };

interface Snapshot {
  revision: string;
  activeTemplateId: string | null;
  templateSet: {
    brandKit?: DesignSystem;
    brandKitCss?: string;
    templates: Array<{
      id: string;
      width: number;
      settingsOverrides: string[];
      brandKitOverrides: string[];
      settingsOrigins: Record<string, 'local' | 'inherited' | 'overridden'>;
      project?: Project;
    }>;
  };
}

function read(includeProjects = false) {
  return handleTemplateSetRequest({ action: 'read', includeProjects }) as unknown as Snapshot;
}

function command(operation: Record<string, unknown>, expectedRevision = read().revision) {
  return handleTemplateSetRequest({
    action: 'command',
    operation,
    expectedRevision,
  }) as unknown as Snapshot;
}

function fixture() {
  const first = createProject({ name: 'News' });
  const main = first.compositions[0]!;
  main.designSystem = {
    name: 'Local kit',
    tokens: [{ ...sharedToken, id: 'local-accent', value: '#1166aa' }],
  };
  const text = createLayerOfKind('text');
  if (text.element.type !== 'text') throw new Error('Expected text.');
  text.element.fill = '#1166aa';
  text.element.color = '#1166aa';
  text.keyframes = [createLayerKeyframe(0, createDefaultTransform())];
  text.designTokenBindings = [{ tokenId: 'local-accent', targetProperty: 'fill' }];
  main.layers.push(text);
  let set = createProjectSet('Evening Show', first);
  set = addProjectSetTemplate(set, createProject({ name: 'Sports' }));
  const templateId = set.templates[0]!.id;
  useProjectStore.getState().loadProject(resolveProjectSetTemplate(set, templateId));
  useProjectSetStore.setState({ projectSet: set, activeTemplateId: templateId });
  history.resetHistory();
  return { templateId, layerId: text.id };
}

function activeComposition() {
  const project = useProjectStore.getState().project;
  return project.compositions.find((composition) => composition.id === project.mainCompositionId)!;
}

function stateSnapshot() {
  return structuredClone({
    project: useProjectStore.getState().project,
    set: useProjectSetStore.getState().projectSet,
    activeTemplateId: useProjectSetStore.getState().activeTemplateId,
  });
}

describe('Template Set MCP bridge inheritance and themes', () => {
  it('reports bounded shared-asset usage and replacement impact without exposing asset bytes', () => {
    const first = createProject({ name: 'News' });
    const second = createProject({ name: 'Sports' });
    const asset = (id: string) =>
      createAsset({
        id,
        name: id,
        kind: 'image',
        mimeType: 'image/png',
        dataUri: 'data:image/png;base64,AQID',
        byteSize: 3,
      });
    first.compositions[0]!.assets.push(asset('logo-a'));
    second.compositions[0]!.assets.push(asset('logo-b'), asset('logo-c'));
    let set = addProjectSetTemplate(createProjectSet('News set', first), second);
    const a = set.templates[0]!;
    const b = set.templates[1]!;
    set = addProjectSetAssetSlot(set, a.id, first.mainCompositionId, 'logo-a');
    const slot = set.assetSlots[0]!;
    set = bindProjectSetAsset(set, slot.id, b.id, second.mainCompositionId, 'logo-b');
    const bBinding = set.assetSlots[0]!.bindings.find((binding) => binding.templateId === b.id)!;
    set = setProjectSetAssetBindingInherited(set, slot.id, bBinding.id, false);
    set = addProjectSetAssetSlot(set, b.id, second.mainCompositionId, 'logo-c');
    set = setProjectSetAssetSlotSource(set, set.assetSlots[1]!.id, slot.assetId);
    set.componentAssets = [
      { id: 'shared-component', name: 'Shared', scope: 'set', layers: [], dataFields: [] },
    ];
    useProjectStore.getState().loadProject(resolveProjectSetTemplate(set, a.id));
    useProjectSetStore.setState({ projectSet: set, activeTemplateId: a.id });
    const before = read().revision;
    const result = handleTemplateSetRequest({
      action: 'read',
      resourceUsage: { slotIds: [slot.id], componentIds: ['shared-component'] },
      offset: 1,
      limit: 1,
    });
    expect(result).toMatchObject({
      revision: before,
      templateSet: {
        resourceUsage: {
          slots: [
            {
              slotId: slot.id,
              sourceAssetId: slot.assetId,
              templates: [
                { templateId: b.id, status: 'local', bindingId: bBinding.id, assetId: 'logo-b' },
              ],
              replacementImpact: { affectedSlotCount: 2, inheritedBindings: 2, localBindings: 1 },
            },
          ],
          components: [
            {
              componentId: 'shared-component',
              templates: [{ templateId: b.id, count: 0, overridden: 0 }],
            },
          ],
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain('data:image/png;base64');
    expect(() =>
      handleTemplateSetRequest({ action: 'read', resourceUsage: { slotIds: ['missing'] } }),
    ).toThrow(/slot not found/i);
    expect(() =>
      handleTemplateSetRequest({
        action: 'read',
        resourceUsage: { slotIds: Array.from({ length: 17 }, (_, i) => `slot-${i}`) },
      }),
    ).toThrow(/at most 16/i);
    expect(read().revision).toBe(before);

    const activeProject = structuredClone(useProjectStore.getState().project);
    const editedLayer = createLayerOfKind('text');
    editedLayer.componentLink = {
      componentId: 'shared-component',
      instanceId: 'new-instance',
      sourceLayerId: 'source',
      overridePaths: ['/opacity'],
    };
    activeProject.compositions[0]!.layers.push(editedLayer);
    useProjectStore.setState({ project: activeProject });
    const active = handleTemplateSetRequest({
      action: 'read',
      templateIds: [a.id],
      resourceUsage: { componentIds: ['shared-component'] },
    });
    expect(active).toMatchObject({
      templateSet: {
        resourceUsage: {
          components: [
            {
              componentId: 'shared-component',
              templates: [{ templateId: a.id, count: 1, overridden: 1 }],
            },
          ],
        },
      },
    });

    useProjectSetStore.setState({ projectSet: setProjectSetAssetSlotSource(set, slot.id, null) });
    const fallback = handleTemplateSetRequest({
      action: 'read',
      templateIds: [a.id],
      resourceUsage: { slotIds: [slot.id] },
    });
    expect(fallback).toMatchObject({
      templateSet: {
        resourceUsage: {
          slots: [
            {
              slotId: slot.id,
              sourceAssetId: null,
              templates: [{ templateId: a.id, status: 'local-fallback' }],
            },
          ],
        },
      },
    });
  });

  it('pages and filters complete projects without switching the active template or revising the set', () => {
    fixture();
    const before = read();
    const ids = before.templateSet.templates.map((template) => template.id);
    const page = handleTemplateSetRequest({
      action: 'read',
      includeProjects: true,
      offset: 1,
      limit: 1,
    });
    expect(page).toMatchObject({
      revision: before.revision,
      activeTemplateId: ids[0],
      pagination: { total: 2, offset: 1, returned: 1, nextOffset: null },
      templateSet: { templates: [{ id: ids[1], project: { id: expect.any(String) } }] },
    });
    const filtered = handleTemplateSetRequest({
      action: 'read',
      templateIds: [ids[0]!],
      includeProjects: true,
    });
    expect(filtered).toMatchObject({
      revision: before.revision,
      pagination: { total: 1, returned: 1 },
    });
    expect(read().templateSet.templates).toHaveLength(2);
    for (const invalid of [{ limit: 0 }, { offset: -1 }, { templateIds: ['missing'] }])
      expect(() => handleTemplateSetRequest({ action: 'read', ...invalid })).toThrow();
  });
  beforeEach(() => {
    useProjectSetStore.getState().clearProjectSet();
    useProjectStore.getState().newProject();
    useSelectionStore.setState({ selectedLayerId: null, selectedLayerIds: [] });
    history.resetHistory();
  });
  afterAll(() => {
    history.resetHistory();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('uses opaque revisions and atomically rejects a stale token after a local edit', () => {
    const { templateId, layerId } = fixture();
    const before = read();
    expect(before.revision).toMatch(/^[0-9a-f-]+:\d+$/);
    useProjectStore.getState().updateLayerElement(layerId, { content: 'Local edit' });
    expect(read().revision).not.toBe(before.revision);
    const state = stateSnapshot();
    expect(() =>
      command(
        { type: 'set_setting_override', templateId, key: 'width', override: true },
        before.revision,
      ),
    ).toThrow(/revision conflict/);
    expect(stateSnapshot()).toEqual(state);
  });

  it('adopts a master Brand Kit by semantic key and upserts linked token values', () => {
    const { layerId } = fixture();
    command({ type: 'set_brand_kit', brandKit: sharedKit });
    expect(activeComposition().layers.find((layer) => layer.id === layerId)).toMatchObject({
      element: { fill: '#bb4400' },
      designTokenBindings: [{ tokenId: sharedToken.id, targetProperty: 'fill' }],
    });
    command({
      type: 'upsert_brand_token',
      token: { ...sharedToken, value: '#ffcc00' },
    });
    expect(activeComposition().layers[0]!.element).toMatchObject({ fill: '#ffcc00' });
    const result = read(true);
    expect(result.templateSet.brandKit!.tokens[0]!.value).toBe('#ffcc00');
    expect(
      result.templateSet.templates[0]!.project!.compositions[0]!.layers[0]!.element,
    ).toMatchObject({
      fill: '#ffcc00',
    });
  });

  it('sets a per-setting override, preserves the local value and resets to the latest master', () => {
    const { templateId } = fixture();
    const originalWidth = activeComposition().width;
    command({ type: 'set_setting_override', templateId, key: 'width', override: true });
    command({ type: 'set_defaults', patch: { width: originalWidth + 320 } });
    expect(activeComposition().width).toBe(originalWidth);
    expect(read().templateSet.templates[0]).toMatchObject({
      settingsOverrides: ['width'],
      settingsOrigins: { width: 'overridden', height: 'inherited' },
    });
    command({ type: 'set_setting_override', templateId, key: 'width', override: false });
    expect(activeComposition().width).toBe(originalWidth + 320);
    expect(read().templateSet.templates[0]!.settingsOrigins.width).toBe('inherited');
    expect(read().templateSet.templates[0]!.settingsOverrides).not.toContain('width');
  });

  it('sets a per-token override and resets the linked object to the current master token', () => {
    const { templateId } = fixture();
    command({ type: 'set_brand_kit', brandKit: sharedKit });
    command({
      type: 'set_brand_token_override',
      templateId,
      tokenId: sharedToken.id,
      override: true,
    });
    useProjectStore.getState().updateDesignToken(sharedToken.id, { value: '#22aa88' });
    command({ type: 'upsert_brand_token', token: { ...sharedToken, value: '#ffcc00' } });
    expect(activeComposition().layers[0]!.element).toMatchObject({ fill: '#22aa88' });
    expect(read().templateSet.templates[0]!.brandKitOverrides).toContain(sharedToken.id);
    command({
      type: 'set_brand_token_override',
      templateId,
      tokenId: sharedToken.id,
      override: false,
    });
    expect(activeComposition().layers[0]!.element).toMatchObject({ fill: '#ffcc00' });
    expect(read().templateSet.templates[0]!.brandKitOverrides).not.toContain(sharedToken.id);
  });

  it('rejects removal of a linked token atomically and permits removing an unused token', () => {
    fixture();
    command({ type: 'set_brand_kit', brandKit: sharedKit });
    const before = stateSnapshot();
    const revision = read().revision;
    expect(() => command({ type: 'remove_brand_token', tokenId: sharedToken.id })).toThrow(
      /still linked/,
    );
    expect(stateSnapshot()).toEqual(before);
    expect(read().revision).toBe(revision);
    const unused = { ...sharedToken, id: 'unused', key: 'unused', name: 'Unused' };
    command({ type: 'upsert_brand_token', token: unused });
    expect(read().templateSet.brandKit!.tokens.some((token) => token.id === unused.id)).toBe(true);
    command({ type: 'remove_brand_token', tokenId: unused.id });
    expect(read().templateSet.brandKit!.tokens.some((token) => token.id === unused.id)).toBe(false);
  });

  it('returns explicit parameter origins and generated master CSS without applying it to child output', () => {
    const { templateId } = fixture();
    command({ type: 'set_brand_kit', brandKit: sharedKit });
    command({ type: 'set_setting_override', templateId, key: 'layout.gridSize', override: true });
    const result = read();
    expect(result.templateSet.templates[0]!.settingsOrigins).toMatchObject({
      width: 'inherited',
      'layout.gridSize': 'overridden',
      'layout.snapThreshold': 'inherited',
    });
    expect(result.templateSet.brandKitCss).toBe(':root {\n  --accent: #bb4400;\n}');
    command({ type: 'set_inheritance', templateId, inherit: false });
    expect(read().templateSet.templates[0]!.settingsOrigins.width).toBe('local');
    expect(activeComposition().layers[0]!.element).toMatchObject({ fill: '#bb4400' });
  });

  it('rejects unknown override keys and invalid semantic token values without changing state', () => {
    const { templateId } = fixture();
    command({ type: 'set_brand_kit', brandKit: sharedKit });
    const before = stateSnapshot();
    const revision = read().revision;
    expect(() =>
      command({ type: 'set_setting_override', templateId, key: 'layout.unknown', override: true }),
    ).toThrow(/Unknown inherited setting/);
    expect(() =>
      command({
        type: 'upsert_brand_token',
        token: { ...sharedToken, value: 'javascript:alert(1)' },
      }),
    ).toThrow();
    expect(stateSnapshot()).toEqual(before);
    expect(read().revision).toBe(revision);
  });
});
