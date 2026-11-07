import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileDescriptor } from '@ograf-editor/codegen';
import { createShaderPaint, getLayerPropertyValueAtFrame } from '@ograf-editor/scene-model';
import { validateProject } from '@ograf-editor/validation';
import { getActiveComposition, useProjectStore } from './projectStore';
import { useProjectSetStore } from './projectSetStore';
import { useSelectionStore } from './selectionStore';
import { useTimelineStore } from './timelineStore';
import {
  createProjectSet,
  createProjectSetArchive,
  openProjectSetArchive,
  resolveProjectSetTemplate,
} from './projectSet';
import { parseProjectSource } from './studioDocument';

vi.stubGlobal('window', {
  setTimeout: (callback: () => void, timeout?: number) => setTimeout(callback, timeout),
  clearTimeout: (timer: ReturnType<typeof setTimeout> | undefined) => clearTimeout(timer),
});
const history = await import('./historyStore');

function composition() {
  const state = useProjectStore.getState();
  return getActiveComposition(state.project, state.activeCompositionId);
}

function setup() {
  const store = useProjectStore.getState();
  const recipe = store.addLowerThird();
  const targetId = recipe.layers.headline;
  const target = composition().layers.find((layer) => layer.id === targetId)!;
  const sourceId = target.componentLink!.sourceLayerId;
  const componentId = recipe.componentId!;
  const otherIds = store.instantiateComponent(componentId, { x: 30, y: 20 });
  const sibling = composition().layers.find(
    (layer) => otherIds.includes(layer.id) && layer.componentLink?.sourceLayerId === sourceId,
  )!;
  const deletedFrame = 3;
  const key = composition()
    .layers.find((layer) => layer.id === targetId)!
    .keyframes.find((candidate) => candidate.frame === deletedFrame)!;
  expect(key).toBeDefined();
  return {
    store,
    targetId,
    sourceId,
    componentId,
    siblingId: sibling.id,
    deletedFrame,
    keyId: key.id,
  };
}

const getLayer = (id: string) => composition().layers.find((layer) => layer.id === id)!;

describe('linked component keyframe deletion', () => {
  beforeEach(() => {
    useProjectSetStore.getState().clearProjectSet();
    useProjectStore.getState().newProject();
    useSelectionStore.getState().deselectAll();
    useTimelineStore.getState().setAutoKeyframe(false);
    history.resetHistory();
  });
  afterAll(() => {
    history.resetHistory();
    vi.unstubAllGlobals();
  });

  it('removes the recipe key only from the edited instance, and undo and redo restore it', () => {
    const { store, targetId, sourceId, componentId, siblingId, deletedFrame, keyId } = setup();
    const definitionBefore = structuredClone(
      composition().components.find((c) => c.id === componentId)!,
    );
    const siblingBefore = structuredClone(getLayer(siblingId));
    const originalId = getLayer(targetId).keyframes.find((key) => key.frame === deletedFrame)!.id;
    history.resetHistory();
    history.runDiscreteHistoryStep(
      () => store.removeLayerKeyframe(targetId, keyId),
      'Delete keyframe',
    );
    expect(getLayer(targetId).keyframes.some((key) => key.frame === deletedFrame)).toBe(false);
    expect(
      Object.values(getLayer(targetId).animationTracks).every(
        (keys) => !keys?.some((key) => key.frame === deletedFrame),
      ),
    ).toBe(true);
    expect(composition().components.find((c) => c.id === componentId)).toEqual(definitionBefore);
    expect(getLayer(siblingId).keyframes).toEqual(siblingBefore.keyframes);
    expect(getLayer(siblingId).animationTracks).toEqual(siblingBefore.animationTracks);
    history.undo();
    expect(getLayer(targetId).keyframes.find((key) => key.frame === deletedFrame)?.id).toBe(
      originalId,
    );
    history.redo();
    expect(getLayer(targetId).keyframes.some((key) => key.frame === deletedFrame)).toBe(false);

    const master = composition()
      .components.find((c) => c.id === componentId)!
      .layers.find((l) => l.id === sourceId)!;
    if (master.element.type !== 'text') throw new Error('Expected text source');
    store.updateComponentLayer(componentId, sourceId, {
      element: { ...master.element, fontSize: 93 },
    });
    const changed = getLayer(targetId);
    expect(changed.element.type === 'text' && changed.element.fontSize).toBe(93);
    expect(changed.keyframes.some((key) => key.frame === deletedFrame)).toBe(false);
    expect(getLayer(siblingId).keyframes.some((key) => key.frame === deletedFrame)).toBe(true);
  });

  it('keeps deleted keys removed in compact sets, standalone source and compiled output', async () => {
    const { store, targetId, componentId, sourceId, siblingId, deletedFrame, keyId } = setup();
    store.removeLayerKeyframe(targetId, keyId);
    const project = structuredClone(useProjectStore.getState().project);
    const set = createProjectSet('Keyframe test', project);
    const archive = await createProjectSetArchive(set);
    const restoredSet = await openProjectSetArchive(await archive.arrayBuffer());
    const restored = resolveProjectSetTemplate(restoredSet, restoredSet.templates[0]!.id);
    const standalone = parseProjectSource(JSON.stringify(project));
    for (const candidate of [restored, standalone]) {
      store.loadProject(candidate);
      const current = composition();
      expect(
        current.layers
          .find((layer) => layer.id === targetId)!
          .keyframes.some((key) => key.frame === deletedFrame),
      ).toBe(false);
      expect(
        current.layers
          .find((layer) => layer.id === siblingId)!
          .keyframes.some((key) => key.frame === deletedFrame),
      ).toBe(true);
      expect(
        current.components
          .find((c) => c.id === componentId)!
          .layers.find((layer) => layer.id === sourceId)!
          .keyframes.some((key) => key.frame === deletedFrame),
      ).toBe(true);
      const compiled = compileDescriptor(current).layers.find((layer) => layer.id === targetId)!;
      expect(compiled.keyframes.some((key) => key.frame === deletedFrame)).toBe(false);
      expect(validateProject(candidate).errors).toEqual([]);
    }
  });

  it('keeps the deletion local when the parent retimes its key and restores it on reset', () => {
    const { store, targetId, sourceId, componentId, siblingId, deletedFrame, keyId } = setup();
    store.removeLayerKeyframe(targetId, keyId);
    const master = composition()
      .components.find((c) => c.id === componentId)!
      .layers.find((layer) => layer.id === sourceId)!;
    const retimedFrame = 5;
    const keyframes = structuredClone(master.keyframes).map((key) =>
      key.frame === deletedFrame ? { ...key, frame: retimedFrame } : key,
    );
    const animationTracks = Object.fromEntries(
      Object.entries(structuredClone(master.animationTracks)).map(([property, keys]) => [
        property,
        keys?.map((key) => (key.frame === deletedFrame ? { ...key, frame: retimedFrame } : key)),
      ]),
    );
    store.updateComponentLayer(componentId, sourceId, { keyframes, animationTracks });
    expect(getLayer(targetId).keyframes.some((key) => key.frame === deletedFrame)).toBe(false);
    expect(getLayer(targetId).keyframes.some((key) => key.frame === retimedFrame)).toBe(false);
    expect(getLayer(siblingId).keyframes.some((key) => key.frame === retimedFrame)).toBe(true);
    store.resetComponentOverrides([targetId]);
    expect(getLayer(targetId).keyframes.some((key) => key.frame === retimedFrame)).toBe(true);
    expect(getLayer(targetId).keyframes.some((key) => key.frame === deletedFrame)).toBe(false);
  });

  it('preserves a new local hold key through later source updates', () => {
    const { store, targetId, sourceId, componentId, deletedFrame, keyId } = setup();
    store.removeLayerKeyframe(targetId, keyId);
    const holdId = store.addLayerHoldFrame(targetId, 7);
    expect(getLayer(targetId).keyframes.find((key) => key.frame === 7)?.id).toBe(holdId);
    const master = composition()
      .components.find((candidate) => candidate.id === componentId)!
      .layers.find((candidate) => candidate.id === sourceId)!;
    if (master.element.type !== 'text') throw new Error('Expected text source');
    store.updateComponentLayer(componentId, sourceId, {
      element: { ...master.element, fontSize: 85 },
    });
    expect(getLayer(targetId).keyframes.find((key) => key.frame === 7)?.id).toBe(holdId);
    expect(getLayer(targetId).keyframes.some((key) => key.frame === deletedFrame)).toBe(false);
  });

  it('removes the final animated shader property key without altering a linked sibling', () => {
    const store = useProjectStore.getState();
    const targetId = store.addLayer('text');
    store.updateLayerPaint(
      targetId,
      0,
      createShaderPaint({
        fragmentSource:
          '#pragma ograf yaw slider min(-90) max(90) step(1)\nconst float yaw = 0.0;\nvoid mainImage(out vec4 c, in vec2 p) { c=vec4(vec3(yaw),1.0); }',
      }),
    );
    // Explicitly author one key; Auto creates a baseline plus the later edited frame.
    const initialKey = store.addLayerPropertyKeyframe(targetId, 'fill.parameters.yaw', 5);
    store.updateLayerPropertyKeyframeValue(targetId, 'fill.parameters.yaw', initialKey, 30);
    const componentId = store.createComponent([targetId], 'Shader title')!;
    const [siblingId] = store.instantiateComponent(componentId);
    const property = 'fill.parameters.yaw';
    const key = getLayer(targetId).animationTracks[property]!.find((entry) => entry.frame === 5)!;
    expect(key).toBeDefined();
    expect(getLayer(siblingId!).animationTracks[property]!.some((entry) => entry.frame === 5)).toBe(
      true,
    );
    store.removeLayerPropertyKeyframe(targetId, property, key.id);
    expect(getLayer(targetId).animationTracks[property]).toBeUndefined();
    expect(getLayerPropertyValueAtFrame(getLayer(targetId), property, 5)).toBe(30);
    expect(getLayer(targetId).keyframes.some((entry) => entry.frame === 5)).toBe(false);
    expect(getLayer(siblingId!).animationTracks[property]!.some((entry) => entry.frame === 5)).toBe(
      true,
    );
  });

  it('keeps the summary key when another property is still keyed at that frame', () => {
    const { store, targetId, siblingId, deletedFrame } = setup();
    const xKey = getLayer(targetId).animationTracks.x!.find((key) => key.frame === deletedFrame)!;
    expect(xKey).toBeDefined();
    store.removeLayerPropertyKeyframe(targetId, 'x', xKey.id);
    expect(getLayer(targetId).animationTracks.x!.some((key) => key.frame === deletedFrame)).toBe(
      false,
    );
    expect(
      getLayer(targetId).animationTracks.opacity!.some((key) => key.frame === deletedFrame),
    ).toBe(true);
    expect(getLayer(targetId).keyframes.some((key) => key.frame === deletedFrame)).toBe(true);
    expect(getLayer(siblingId).animationTracks.x!.some((key) => key.frame === deletedFrame)).toBe(
      true,
    );
  });

  it('allows property-key deletion after a linked layer is reset', () => {
    const { store, targetId, deletedFrame, keyId } = setup();
    store.removeLayerKeyframe(targetId, keyId);
    store.resetComponentOverrides([targetId]);
    const xKey = getLayer(targetId).animationTracks.x!.find((key) => key.frame === deletedFrame)!;
    expect(xKey).toBeDefined();
    store.removeLayerPropertyKeyframe(targetId, 'x', xKey.id);
    expect(getLayer(targetId).animationTracks.x!.some((key) => key.frame === deletedFrame)).toBe(
      false,
    );
    expect(getLayer(targetId).keyframes.some((key) => key.frame === deletedFrame)).toBe(true);
  });

  it('allows property-key deletion after resetting just the removed key override', () => {
    const { store, targetId, deletedFrame, keyId } = setup();
    store.removeLayerKeyframe(targetId, keyId);
    const deletionPath = getLayer(targetId).componentLink!.overridePaths?.find((path) =>
      path.startsWith('/keyframes/@'),
    );
    expect(deletionPath).toBeDefined();
    store.resetComponentOverrides([targetId], [deletionPath!]);
    const xKey = getLayer(targetId).animationTracks.x!.find((key) => key.frame === deletedFrame)!;
    expect(xKey).toBeDefined();
    store.removeLayerPropertyKeyframe(targetId, 'x', xKey.id);
    expect(getLayer(targetId).animationTracks.x!.some((key) => key.frame === deletedFrame)).toBe(
      false,
    );
    expect(
      getLayer(targetId).animationTracks.opacity!.some((key) => key.frame === deletedFrame),
    ).toBe(true);
    expect(getLayer(targetId).keyframes.some((key) => key.frame === deletedFrame)).toBe(true);
  });
});
