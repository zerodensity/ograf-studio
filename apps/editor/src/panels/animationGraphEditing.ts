import {
  getResolvedLayerAnimationTracks,
  getLayerAnimatableProperties,
  getTotalFrames,
  type AnimatableLayerProperty,
  type LayerPropertyKeyframe,
} from '@ograf-editor/scene-model';
import { useProjectStore } from '../state/projectStore';
import { runDiscreteHistoryStep } from '../state/historyStore';
import { useTimelineStore } from '../state/timelineStore';
import { useSelectionStore } from '../state/selectionStore';

export function seekGraphFrame(frame: number): void {
  const timeline = useTimelineStore.getState();
  if (timeline.controller) timeline.controller.seek(frame);
  else timeline.setCurrentFrame(frame);
}

export interface GraphKeyTarget {
  projectId: string;
  compositionId: string;
  layerId: string;
  property: AnimatableLayerProperty;
  keyframeId: string;
  originalTrack: LayerPropertyKeyframe[];
}

export interface GraphKeyEdit extends GraphKeyTarget {
  preview: { frame: number; value: number };
}

export interface GraphKeyInsertion extends Omit<GraphKeyTarget, 'keyframeId'> {
  frame: number;
  value: number;
}

/** Add a graph point without overwriting a key or changing the operator's current playhead. */
export function insertAnimationGraphKey(target: GraphKeyInsertion): string | null {
  const state = useProjectStore.getState();
  if (
    state.project.id !== target.projectId ||
    state.activeCompositionId !== target.compositionId ||
    !Number.isFinite(target.value) ||
    !Number.isInteger(target.frame) ||
    target.frame < 0
  )
    return null;
  const composition = state.project.compositions.find((item) => item.id === target.compositionId);
  const layer = composition?.layers.find((item) => item.id === target.layerId);
  if (
    !composition ||
    !layer ||
    layer.isLocked ||
    target.frame > getTotalFrames(composition) ||
    !getLayerAnimatableProperties(layer).includes(target.property)
  )
    return null;
  const track =
    layer.animationTrackMode === 'independent'
      ? (layer.animationTracks[target.property] ?? [])
      : (getResolvedLayerAnimationTracks(layer)[target.property] ?? []);
  if (
    JSON.stringify(track) !== JSON.stringify(target.originalTrack) ||
    track.some((key) => key.frame === target.frame)
  )
    return null;
  let inserted: string | null = null;
  runDiscreteHistoryStep(() => {
    const id = state.addLayerPropertyKeyframe(target.layerId, target.property, target.frame);
    state.updateLayerPropertyKeyframeValue(target.layerId, target.property, id, target.value);
    useSelectionStore.getState().selectLayerKeyframe(target.layerId, id, target.property);
    inserted = id;
  }, 'Add animation graph key');
  return inserted;
}

/** Delete only the named key from the unchanged source that the menu/focused key represents. */
export function deleteAnimationGraphKey(target: GraphKeyTarget): boolean {
  const state = useProjectStore.getState();
  if (state.project.id !== target.projectId || state.activeCompositionId !== target.compositionId)
    return false;
  const layer = state.project.compositions
    .find((composition) => composition.id === target.compositionId)
    ?.layers.find((layer) => layer.id === target.layerId);
  if (!layer || layer.isLocked) return false;
  const track =
    layer.animationTrackMode === 'independent'
      ? (layer.animationTracks[target.property] ?? [])
      : (getResolvedLayerAnimationTracks(layer)[target.property] ?? []);
  if (
    JSON.stringify(track) !== JSON.stringify(target.originalTrack) ||
    !track.some((key) => key.id === target.keyframeId)
  )
    return false;
  runDiscreteHistoryStep(() => {
    state.removeLayerPropertyKeyframe(target.layerId, target.property, target.keyframeId);
    useSelectionStore.getState().selectLayerProperty(target.layerId, target.property);
  }, 'Delete animation graph key');
  return true;
}

/** Publish time and value together; a long pointer drag must still be one Undo. */
export function commitAnimationGraphDrag(edit: GraphKeyEdit): boolean {
  const state = useProjectStore.getState();
  if (state.project.id !== edit.projectId || state.activeCompositionId !== edit.compositionId)
    return false;
  const layer = state.project.compositions
    .find((composition) => composition.id === edit.compositionId)
    ?.layers.find((layer) => layer.id === edit.layerId);
  if (!layer || layer.isLocked) return false;
  const track = getResolvedLayerAnimationTracks(layer)[edit.property] ?? [];
  // A different source edit while dragging must not be replaced by a stale local preview.
  if (JSON.stringify(track) !== JSON.stringify(edit.originalTrack)) return false;
  const key = track.find((key) => key.id === edit.keyframeId);
  if (!key || (key.frame === edit.preview.frame && key.value === edit.preview.value)) return false;
  if (track.some((key) => key.id !== edit.keyframeId && key.frame === edit.preview.frame))
    return false;
  runDiscreteHistoryStep(() => {
    if (key.frame !== edit.preview.frame)
      state.moveLayerPropertyKeyframe(
        edit.layerId,
        edit.property,
        edit.keyframeId,
        edit.preview.frame,
      );
    if (key.value !== edit.preview.value)
      state.updateLayerPropertyKeyframeValue(
        edit.layerId,
        edit.property,
        edit.keyframeId,
        edit.preview.value,
      );
  }, 'Move animation graph key');
  seekGraphFrame(edit.preview.frame);
  return true;
}
