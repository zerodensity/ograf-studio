import {
  getLayerAnimatableProperties,
  type AnimatableLayerProperty,
  type Composition,
  type LayerPropertyKeyframe,
} from '@ograf-editor/scene-model';
import type { SelectedLayerKeyframe } from '../state/selectionStore';
import { useProjectStore } from '../state/projectStore';
import { runDiscreteHistoryStep } from '../state/historyStore';
import { timelineAnimationTracks, timelineLayerKeyframes } from './timelinePropertyVisibility';

export interface CopiedMotionKey {
  property: AnimatableLayerProperty;
  offset: number;
  value: number;
  easing: LayerPropertyKeyframe['easing'];
  curve?: LayerPropertyKeyframe['curve'];
}

/** Shared by the Timeline keydown listener and its keyboard regression tests. */
export function handleMotionClipboardShortcut(
  event: Pick<
    KeyboardEvent,
    | 'key'
    | 'ctrlKey'
    | 'metaKey'
    | 'altKey'
    | 'defaultPrevented'
    | 'preventDefault'
    | 'stopPropagation'
  >,
  scope: { withinTimeline: boolean; editable: boolean },
  composition: Composition,
  selection: SelectedLayerKeyframe[],
  layerIds: string[],
  frame: number,
  durationFrames: number,
  clipboard: CopiedMotionKey[],
): CopiedMotionKey[] {
  if (
    !(event.ctrlKey || event.metaKey) ||
    event.altKey ||
    event.defaultPrevented ||
    !scope.withinTimeline ||
    scope.editable
  )
    return clipboard;
  if (event.key.toLowerCase() === 'c' && selection.length) {
    const copied = copyMotionKeys(composition, selection);
    if (copied.length) {
      event.preventDefault();
      event.stopPropagation();
      return copied;
    }
  } else if (event.key.toLowerCase() === 'v' && clipboard.length && layerIds.length) {
    pasteMotionKeys(composition, clipboard, layerIds, frame, durationFrames);
    event.preventDefault();
    event.stopPropagation();
  }
  return clipboard;
}

/** Paste only compatible tracks; replace keys at the same frame in one undoable command. */
export function pasteMotionKeys(
  composition: Composition,
  keys: CopiedMotionKey[],
  layerIds: string[],
  frame: number,
  durationFrames: number,
): number {
  let count = 0;
  const targets = composition.layers.filter(
    (layer) => layerIds.includes(layer.id) && !layer.isLocked,
  );
  runDiscreteHistoryStep(() => {
    for (const layer of targets) {
      const supported = new Set(getLayerAnimatableProperties(layer));
      const pasted = new Set<string>();
      for (const key of keys) {
        const targetFrame = frame + key.offset;
        const identity = JSON.stringify([key.property, targetFrame]);
        if (
          !supported.has(key.property) ||
          targetFrame > durationFrames ||
          targetFrame < 0 ||
          pasted.has(identity)
        )
          continue;
        pasted.add(identity);
        const store = useProjectStore.getState();
        const id = store.addLayerPropertyKeyframe(layer.id, key.property, targetFrame);
        store.updateLayerPropertyKeyframeValue(layer.id, key.property, id, key.value);
        store.updateLayerPropertyKeyframeEasing(layer.id, key.property, id, key.easing);
        if (key.curve)
          store.updateLayerPropertyKeyframeCurve(layer.id, key.property, id, key.curve);
        count++;
      }
    }
  }, 'Paste motion');
  return count;
}

/** Copy authored property keys, including the tracks represented by a composite key. */
export function copyMotionKeys(
  composition: Composition,
  selection: SelectedLayerKeyframe[],
): CopiedMotionKey[] {
  const copied = new Map<string, Omit<CopiedMotionKey, 'offset'> & { frame: number }>();
  for (const item of selection) {
    const layer = composition.layers.find((candidate) => candidate.id === item.layerId);
    if (!layer) continue;
    const tracks = timelineAnimationTracks(layer);
    const aggregate = item.property
      ? undefined
      : timelineLayerKeyframes(layer).find((key) => key.id === item.keyframeId);
    const properties = item.property
      ? [item.property]
      : (Object.keys(tracks) as AnimatableLayerProperty[]);
    for (const property of properties) {
      const key = tracks[property]?.find((candidate) =>
        item.property ? candidate.id === item.keyframeId : candidate.frame === aggregate?.frame,
      );
      if (!key) continue;
      // A timeline selection normally belongs to one track. Avoid duplicated keys when a
      // composite marker and its property marker are both selected.
      const identity = JSON.stringify([item.layerId, property, key.id]);
      copied.set(identity, {
        property,
        frame: key.frame,
        value: key.value,
        easing: key.easing,
        ...(key.curve ? { curve: { ...key.curve } } : {}),
      });
    }
  }
  const entries = [...copied.values()];
  if (!entries.length) return [];
  const firstFrame = Math.min(...entries.map((entry) => entry.frame));
  return entries.map(({ frame, ...entry }) => ({ ...entry, offset: frame - firstFrame }));
}
