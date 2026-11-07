import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_EFFECTS,
  createShaderPackPluginSnapshot,
  createShaderPaint,
  getEffectStack,
  studioPluginReference,
  type Layer,
  type ShaderPackPluginSnapshot,
} from '@ograf-editor/scene-model';
import { useProjectStore, getActiveComposition } from './projectStore';
import { useRendererPluginSettingsStore } from './pluginSettingsStore';
import { useTestDataStore } from './testDataStore';
import { useTimelineStore } from './timelineStore';
import { encodeShaderPluginPresetDrag, type ShaderCanvasDragData } from './shaderCanvasDrag';
import { encodeShaderResourceDrag } from './shaderDrag';
import {
  applyShaderCanvasDrop,
  importShaderCanvasDragToResources,
  shaderCanvasDropChoices,
  type ShaderCanvasDropContext,
} from './shaderCanvasDrop';

vi.useFakeTimers();
vi.stubGlobal('window', { clearTimeout });
const history = await import('./historyStore');
const channelSource =
  'void mainImage(out vec4 color, in vec2 coord) { color = texture(iChannel0, coord / iResolution.xy); }';
const pack = createShaderPackPluginSnapshot({
  manifest: {
    schemaVersion: 1,
    apiVersion: 1,
    kind: 'shader-pack',
    id: 'test.drop',
    name: 'Drop shaders',
    version: '1.0.0',
    license: 'CC0-1.0',
  },
  licenseText: 'CC0-1.0 test notice',
  shaders: [
    {
      id: 'plain',
      name: 'Plain',
      targets: ['fill', 'outline', 'effect'],
      paint: createShaderPaint(),
    },
    {
      id: 'channel',
      name: 'Channel',
      targets: ['effect'],
      paint: createShaderPaint({ fragmentSource: channelSource }),
    },
  ],
});
const reference = studioPluginReference(pack);
const entry = (snapshot: ShaderPackPluginSnapshot = pack) => ({
  snapshot,
  trusted: true,
  enabled: true,
  installedAt: '',
});
const project = () => useProjectStore.getState().project;
const composition = () =>
  getActiveComposition(project(), useProjectStore.getState().activeCompositionId);
const layer = (id: string) => composition().layers.find((candidate) => candidate.id === id)!;
const source = (presetId = 'plain'): ShaderCanvasDragData => ({
  kind: 'plugin',
  payload: encodeShaderPluginPresetDrag(project().id, reference, presetId),
});
const context = (ids: string[]): ShaderCanvasDropContext => ({
  projectId: project().id,
  compositionId: composition().id,
  layerIds: ids,
});
function alterLayer(id: string, mutation: (target: Layer) => void) {
  const copy = structuredClone(project());
  mutation(copy.compositions[0]!.layers.find((item) => item.id === id)!);
  useProjectStore.setState({ project: copy });
}

beforeEach(() => {
  useProjectStore.getState().newProject();
  useTestDataStore.getState().resetAll();
  useTimelineStore.getState().setAutoKeyframe(false);
  useRendererPluginSettingsStore.setState({ installed: [entry()], defaultProvider: null });
  history.resetHistory();
});
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('shader canvas drop transactions', () => {
  it('opens read-only choices and saves/applies Fill in one publication and one undo', () => {
    const ids = [
      useProjectStore.getState().addLayer('rectangle'),
      useProjectStore.getState().addLayer('text'),
    ];
    history.resetHistory();
    const before = structuredClone(project());
    const drag = source();
    const target = context(ids);
    expect(shaderCanvasDropChoices(drag, target).options.map((item) => item.reason)).toEqual([
      '',
      'Outline shaders can only be applied to text.',
      '',
    ]);
    expect(project()).toEqual(before);
    expect(history.getHistorySnapshot().past).toHaveLength(0);
    let publications = 0;
    const unsubscribe = useProjectStore.subscribe((next, previous) => {
      if (next.project !== previous.project) publications++;
    });
    applyShaderCanvasDrop(drag, target, 'fill');
    unsubscribe();
    expect(publications).toBe(1);
    expect(project().shaders).toHaveLength(1);
    expect(layer(ids[0]!).element).toHaveProperty('fill.type', 'shader');
    expect(layer(ids[1]!).element).toHaveProperty('fill.type', 'shader');
    expect(history.getHistorySnapshot().past).toHaveLength(1);
    const after = structuredClone(project());
    history.undo();
    expect(project()).toEqual(before);
    history.redo();
    expect(project()).toEqual(after);
  });

  it('saves Outline and Effect too, deduplicating identical resources across uses', () => {
    const id = useProjectStore.getState().addLayer('text');
    const drag = source();
    const target = context([id]);
    applyShaderCanvasDrop(drag, target, 'outline');
    expect(layer(id).element).toHaveProperty('strokePaint.type', 'shader');
    expect(project().shaders).toHaveLength(1);
    applyShaderCanvasDrop(drag, target, 'effect');
    expect(project().shaders).toHaveLength(1);
    expect(getEffectStack(layer(id).effects).at(-1)).toMatchObject({
      type: 'shader',
      enabled: true,
      blendMode: 'normal',
      blendOpacity: 1,
    });
  });

  it('supports effect-only iChannel0 library copies without a fabricated image', () => {
    const id = useProjectStore.getState().addLayer('rectangle');
    const drag = source('channel');
    expect(
      shaderCanvasDropChoices(drag, context([id])).options.map((item) => !!item.reason),
    ).toEqual([true, true, false]);
    applyShaderCanvasDrop(drag, context([id]), 'effect');
    expect(project().shaders).toHaveLength(1);
    expect(project().shaders[0]!.paint.fragmentSource).toBe(channelSource);
    expect(project().shaders[0]!.paint.inputImage).toBeUndefined();
    const resource: ShaderCanvasDragData = {
      kind: 'resource',
      payload: encodeShaderResourceDrag(project().id, { shaderId: project().shaders[0]!.id }),
    };
    expect(
      shaderCanvasDropChoices(resource, context([id])).options.map((item) => !!item.reason),
    ).toEqual([true, true, false]);
    applyShaderCanvasDrop(resource, context([id]), 'effect');
    expect(project().shaders).toHaveLength(1);
    expect(
      getEffectStack(layer(id).effects).filter((effect) => effect.type === 'shader'),
    ).toHaveLength(2);
  });

  it('never duplicates a library drag and strips its inputImage only from the applied effect', () => {
    const store = useProjectStore.getState();
    const id = store.addLayer('rectangle');
    const saved = store.createShaderResource(
      createShaderPaint({
        fragmentSource: channelSource,
        inputImage: { source: 'data:image/png;base64,AAAA', filter: 'linear', wrap: 'repeat' },
      }),
    );
    const drag: ShaderCanvasDragData = {
      kind: 'resource',
      payload: encodeShaderResourceDrag(project().id, saved),
    };
    applyShaderCanvasDrop(drag, context([id]), 'effect');
    expect(project().shaders).toHaveLength(1);
    expect(project().shaders[0]!.paint.inputImage).toBeDefined();
    expect(getEffectStack(layer(id).effects).at(-1)!.shader!.inputImage).toBeUndefined();
  });

  it('re-resolves changed source values at confirmation instead of using the popup snapshot', () => {
    const store = useProjectStore.getState();
    const id = store.addLayer('rectangle');
    const saved = store.createShaderResource(createShaderPaint({ name: 'Original', speed: 1 }));
    const drag: ShaderCanvasDragData = {
      kind: 'resource',
      payload: encodeShaderResourceDrag(project().id, saved),
    };
    shaderCanvasDropChoices(drag, context([id]));
    store.updateShaderResource(saved, { name: 'Current', speed: 2 });
    applyShaderCanvasDrop(drag, context([id]), 'fill');
    expect(layer(id).element).toHaveProperty('fill.name', 'Current');
    expect(layer(id).element).toHaveProperty('fill.speed', 2);
    expect(project().shaders).toHaveLength(1);
  });

  it('rejects stale projects, compositions and deleted sources without history', () => {
    const store = useProjectStore.getState();
    const id = store.addLayer('rectangle');
    const drag = source();
    const target = context([id]);
    history.resetHistory();
    expect(() => applyShaderCanvasDrop(drag, { ...target, projectId: 'wrong' }, 'fill')).toThrow(
      /project changed/,
    );
    expect(() =>
      applyShaderCanvasDrop(drag, { ...target, compositionId: 'wrong' }, 'fill'),
    ).toThrow(/composition changed/);
    expect(() => applyShaderCanvasDrop(drag, { ...target, layerIds: ['deleted'] }, 'fill')).toThrow(
      /no longer exists/,
    );
    const wrong: ShaderCanvasDragData = {
      kind: 'plugin',
      payload: encodeShaderPluginPresetDrag('wrong', reference, 'plain'),
    };
    expect(() => applyShaderCanvasDrop(wrong, target, 'fill')).toThrow(/different project/);
    expect(history.getHistorySnapshot().past).toHaveLength(0);
    expect(project().shaders).toEqual([]);
    const saved = store.createShaderResource();
    const savedDrag: ShaderCanvasDragData = {
      kind: 'resource',
      payload: encodeShaderResourceDrag(project().id, saved),
    };
    store.removeShaderResource(saved);
    history.resetHistory();
    expect(() => applyShaderCanvasDrop(savedDrag, target, 'fill')).toThrow(/no longer exists/);
    expect(history.getHistorySnapshot().past).toHaveLength(0);
  });

  it('rechecks locks and effect capacity on every member, preventing partial writes', () => {
    const store = useProjectStore.getState();
    const ids = [store.addLayer('rectangle'), store.addLayer('text')];
    const drag = source();
    const target = context(ids);
    shaderCanvasDropChoices(drag, target);
    alterLayer(ids[1]!, (item) => {
      item.isLocked = true;
    });
    history.resetHistory();
    const before = structuredClone(project());
    expect(() => applyShaderCanvasDrop(drag, target, 'fill')).toThrow(/locked/);
    expect(project()).toEqual(before);
    expect(history.getHistorySnapshot().past).toHaveLength(0);
    alterLayer(ids[1]!, (item) => {
      item.isLocked = false;
    });
    while (getEffectStack(layer(ids[1]!).effects).length < MAX_EFFECTS)
      store.addLayerEffect(ids[1]!, 'glow');
    history.resetHistory();
    const full = structuredClone(project());
    expect(() => applyShaderCanvasDrop(drag, target, 'effect')).toThrow(/maximum/);
    expect(project()).toEqual(full);
    expect(history.getHistorySnapshot().past).toHaveLength(0);
  });

  it('rechecks exact plugin review, enablement, content and version at confirmation', () => {
    const id = useProjectStore.getState().addLayer('rectangle');
    const drag = source();
    const target = context([id]);
    shaderCanvasDropChoices(drag, target);
    const tampered = structuredClone(pack);
    tampered.shaders[0]!.paint.speed = 2;
    const newer = createShaderPackPluginSnapshot({
      ...pack,
      manifest: { ...pack.manifest, version: '1.0.1' },
    });
    history.resetHistory();
    const before = structuredClone(project());
    for (const installed of [
      [],
      [{ ...entry(), trusted: false }],
      [{ ...entry(), enabled: false }],
      [entry(tampered)],
      [entry(newer)],
    ]) {
      useRendererPluginSettingsStore.setState({ installed });
      expect(() => applyShaderCanvasDrop(drag, target, 'fill')).toThrow();
      expect(() => importShaderCanvasDragToResources(drag)).toThrow();
      expect(project()).toEqual(before);
      expect(history.getHistorySnapshot().past).toHaveLength(0);
    }
  });

  it('imports into Resources without any object changes, deduplicating but never overwriting edited copies', () => {
    const id = useProjectStore.getState().addLayer('text');
    const before = structuredClone(layer(id));
    const drag = source('channel');
    history.resetHistory();
    importShaderCanvasDragToResources(drag);
    expect(layer(id)).toEqual(before);
    expect(project().shaders).toHaveLength(1);
    expect(history.getHistorySnapshot().past).toHaveLength(1);
    useProjectStore
      .getState()
      .updateShaderResource({ shaderId: project().shaders[0]!.id }, { name: 'My name' });
    history.resetHistory();
    importShaderCanvasDragToResources(drag);
    expect(project().shaders).toHaveLength(1);
    expect(project().shaders[0]!.paint.name).toBe('My name');
    expect(history.getHistorySnapshot().past).toHaveLength(0);
    useProjectStore
      .getState()
      .updateShaderResource({ shaderId: project().shaders[0]!.id }, { speed: 2 });
    importShaderCanvasDragToResources(drag);
    expect(project().shaders).toHaveLength(2);
    expect(project().shaders[0]!.paint.speed).toBe(2);
    expect(layer(id)).toEqual(before);
  });
});
