import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  createComposition,
  createLayerOfKind,
  createLayerKeyframe,
  createLayerPropertyKeyframe,
  createProject,
  createDefaultTransform,
} from '@ograf-editor/scene-model';
import {
  copyMotionKeys,
  pasteMotionKeys,
  handleMotionClipboardShortcut,
  type CopiedMotionKey,
} from './motionClipboard';
import { useProjectStore } from '../state/projectStore';
import { resetHistory, undo, getHistorySnapshot } from '../state/historyStore';

vi.stubGlobal('window', { clearTimeout });
afterAll(() => vi.unstubAllGlobals());

describe('timeline motion clipboard', () => {
  it('copies only explicitly authored independent channels from an aggregate key', () => {
    const composition = createComposition();
    const layer = createLayerOfKind('rectangle');
    layer.animationTrackMode = 'independent';
    layer.keyframes = [createLayerKeyframe(0, createDefaultTransform({ x: 200 }))];
    layer.animationTracks = { x: [createLayerPropertyKeyframe(0, 200)] };
    composition.layers = [layer];
    const selection = [{ layerId: layer.id, keyframeId: layer.keyframes[0]!.id, property: null }];
    expect(copyMotionKeys(composition, selection)).toEqual([
      { property: 'x', offset: 0, value: 200, easing: 'linear' },
    ]);
    layer.animationTracks = {};
    expect(copyMotionKeys(composition, selection)).toEqual([]);
  });

  it('handles Timeline Ctrl/Meta copy and paste with one Undo, while leaving editable fields and other shortcuts alone', () => {
    useProjectStore.getState().loadProject(createProject());
    const store = useProjectStore.getState();
    const sourceId = store.addLayer('rectangle'),
      targetId = store.addLayer('rectangle');
    const keyId = store.addLayerPropertyKeyframe(sourceId, 'x', 12);
    let composition = useProjectStore.getState().project.compositions[0]!;
    const source = composition.layers.find((layer) => layer.id === sourceId)!;
    const key = source.animationTracks.x!.find((item) => item.id === keyId)!;
    store.updateLayerPropertyKeyframeValue(sourceId, 'x', key.id, 321);
    store.updateLayerPropertyKeyframeEasing(sourceId, 'x', key.id, 'cubic-out');
    composition = useProjectStore.getState().project.compositions[0]!;
    const event = (key: string, ctrlKey = true) => ({
      key,
      ctrlKey,
      metaKey: false,
      altKey: false,
      defaultPrevented: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    });
    const copy = event('c');
    let clipboard: CopiedMotionKey[] = handleMotionClipboardShortcut(
      copy,
      { withinTimeline: true, editable: false },
      composition,
      [{ layerId: sourceId, keyframeId: key.id, property: 'x' }],
      [sourceId],
      12,
      24,
      [],
    );
    expect(copy.preventDefault).toHaveBeenCalledOnce();
    expect(clipboard).toMatchObject([{ property: 'x', value: 321, easing: 'cubic-out' }]);
    const ignored = event('v');
    const before = structuredClone(
      composition.layers.find((layer) => layer.id === targetId)!.animationTracks.x,
    );
    clipboard = handleMotionClipboardShortcut(
      ignored,
      { withinTimeline: true, editable: true },
      composition,
      [],
      [targetId],
      0,
      24,
      clipboard,
    );
    expect(ignored.preventDefault).not.toHaveBeenCalled();
    expect(
      useProjectStore
        .getState()
        .project.compositions[0]!.layers.find((layer) => layer.id === targetId)!.animationTracks.x,
    ).toEqual(before);
    resetHistory();
    const paste = event('v');
    handleMotionClipboardShortcut(
      paste,
      { withinTimeline: true, editable: false },
      composition,
      [],
      [targetId],
      0,
      24,
      clipboard,
    );
    expect(paste.preventDefault).toHaveBeenCalledOnce();
    expect(
      useProjectStore
        .getState()
        .project.compositions[0]!.layers.find((layer) => layer.id === targetId)!
        .animationTracks.x?.find((item) => item.frame === 0),
    ).toMatchObject({ value: 321, easing: 'cubic-out' });
    expect(getHistorySnapshot().past.at(-1)?.label).toBe('Paste motion');
    undo();
    expect(
      useProjectStore
        .getState()
        .project.compositions[0]!.layers.find((layer) => layer.id === targetId)!.animationTracks.x,
    ).toEqual(before);
    const other = event('z');
    handleMotionClipboardShortcut(
      other,
      { withinTimeline: true, editable: false },
      composition,
      [],
      [targetId],
      0,
      24,
      clipboard,
    );
    expect(other.preventDefault).not.toHaveBeenCalled();
  });
  it('preserves relative timing, values, easing and custom curves', () => {
    const composition = createComposition();
    const layer = createLayerOfKind('rectangle');
    const first = createLayerPropertyKeyframe(5, 10, { easing: 'linear' });
    const last = createLayerPropertyKeyframe(15, 80, { easing: 'ease-out' });
    last.curve = { x1: 0.1, y1: 0.2, x2: 0.8, y2: 0.9 };
    layer.animationTracks.x = [first, last];
    composition.layers.push(layer);
    const copied = copyMotionKeys(
      composition,
      [first, last].map((key) => ({ layerId: layer.id, keyframeId: key.id, property: 'x' })),
    );
    expect(copied).toEqual([
      { property: 'x', offset: 0, value: 10, easing: 'linear' },
      { property: 'x', offset: 10, value: 80, easing: 'ease-out', curve: last.curve },
    ]);
    expect(copied[1]!.curve).not.toBe(last.curve);
  });

  it('pastes keys at the playhead, replaces same-frame keys, preserves easing, and undoes once', () => {
    useProjectStore.getState().loadProject(createProject());
    const sourceId = useProjectStore.getState().addLayer('rectangle');
    const targetId = useProjectStore.getState().addLayer('rectangle');
    useProjectStore.getState().addLayerPropertyKeyframe(sourceId, 'x', 0);
    useProjectStore.getState().addLayerPropertyKeyframe(sourceId, 'x', 12);
    const existingAggregateId = useProjectStore.getState().addLayerKeyframe(targetId, 12);
    let composition = useProjectStore.getState().project.compositions[0]!;
    const source = composition.layers.find((layer) => layer.id === sourceId)!;
    const sourceKeys = source.animationTracks.x!;
    useProjectStore
      .getState()
      .updateLayerPropertyKeyframeValue(sourceId, 'x', sourceKeys[0]!.id, 111);
    useProjectStore
      .getState()
      .updateLayerPropertyKeyframeEasing(sourceId, 'x', sourceKeys[1]!.id, 'cubic-out');
    composition = useProjectStore.getState().project.compositions[0]!;
    const keys = copyMotionKeys(
      composition,
      sourceKeys
        .slice(0, 2)
        .map((key) => ({ layerId: sourceId, keyframeId: key.id, property: 'x' })),
    );
    const oldTrack = structuredClone(
      composition.layers.find((layer) => layer.id === targetId)!.animationTracks.x,
    );
    const existingAggregate = composition.layers
      .find((layer) => layer.id === targetId)!
      .keyframes.find((key) => key.frame === 12)!;
    expect(existingAggregate.id).toBe(existingAggregateId);
    expect(useProjectStore.getState().addLayerKeyframe(targetId, 12)).toBe(existingAggregate.id);
    expect(useProjectStore.getState().addLayerHoldFrame(targetId, 12)).toBe(existingAggregate.id);
    resetHistory();
    expect(pasteMotionKeys(composition, keys, [targetId], 12, 24)).toBe(2);
    const pasted = useProjectStore
      .getState()
      .project.compositions[0]!.layers.find((layer) => layer.id === targetId)!.animationTracks.x!;
    expect(pasted.find((key) => key.frame === 12)?.value).toBe(111);
    expect(pasted.find((key) => key.frame === 24)?.easing).toBe('cubic-out');
    expect(getHistorySnapshot().past.at(-1)?.label).toBe('Paste motion');
    undo();
    expect(
      useProjectStore
        .getState()
        .project.compositions[0]!.layers.find((layer) => layer.id === targetId)!.animationTracks.x,
    ).toEqual(oldTrack);
    resetHistory();
  });
});
