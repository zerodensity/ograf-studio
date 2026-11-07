import { createLayerKeyframe } from './factory';
import { getLayerTransformAtFrame, getResolvedLayerAnimationTracks } from './layerAnimation';
import { layerMotionWindows } from './layerMotion';
import type { MotionDirection } from './motionPresets';
import type { Composition, Layer, LayerPropertyKeyframe, LayerTransform } from './types';

const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** Recognize the shared exit baked by buildLayerMotionKeyframes, leaving other motion intact. */
function hasSharedRecipeExit(
  composition: Composition,
  property: 'x' | 'y',
  panelTrack: LayerPropertyKeyframe[],
  childTrack: LayerPropertyKeyframe[],
  panelOnAir: LayerTransform,
  childOnAir: LayerTransform,
  lastStep: number,
  end: number,
  sharedExitDirection?: MotionDirection,
): boolean {
  const panelExit = panelTrack.filter((key) => key.frame >= lastStep);
  const childExit = childTrack.filter((key) => key.frame >= lastStep);
  if (panelExit.length < 2 || childExit.length < 2) return false;
  const terminal = panelExit.at(-1)!;
  if (terminal.frame !== end || close(terminal.value, panelOnAir[property])) return false;
  const extent = property === 'x' ? 'width' : 'height';
  let childTerminal: number;
  let direction: MotionDirection;
  if (close(terminal.value, composition[extent] + 40)) {
    childTerminal = terminal.value;
    direction = property === 'x' ? 'right' : 'down';
  } else if (close(terminal.value, -panelOnAir[extent] - 40)) {
    childTerminal = -childOnAir[extent] - 40;
    direction = property === 'x' ? 'left' : 'up';
  } else return false;
  if (childExit.at(-1)!.frame !== end || !close(childExit.at(-1)!.value, childTerminal))
    return false;
  if (sharedExitDirection === direction) {
    // A newly materialized recipe declares its common exit. Old/static children may omit the
    // panel's extra hold key, so use the panel's timing while retaining all entrance keys.
    return childExit.every(
      (key) =>
        close(key.value, key.frame === end ? childTerminal : childOnAir[property]) &&
        (key.frame === lastStep ||
          (!key.curve && (key.frame !== end || key.easing === terminal.easing))),
    );
  }
  if (panelExit.length !== childExit.length) return false;
  return panelExit.every((key, index) => {
    const childKey = childExit[index]!;
    return (
      key.frame === childKey.frame &&
      (key.frame === lastStep ||
        (key.easing === childKey.easing && !key.curve && !childKey.curve)) &&
      close(key.value, key.frame === end ? terminal.value : panelOnAir[property]) &&
      close(childKey.value, key.frame === end ? childTerminal : childOnAir[property])
    );
  });
}

/**
 * Recipe parents clip in absolute composition space; they do not provide transform inheritance.
 * Bake panel translation into stationary descendants and matching generated exits before taking
 * the component snapshot. Independent entrances remain editable normal tracks, including stagger.
 */
export function finishRecipePanelMotion(
  composition: Composition,
  layers: Record<string, Layer>,
  motion?: { exit: MotionDirection },
): void {
  const panel = layers.panel ?? layers.window;
  const windows = layerMotionWindows(composition);
  if (!panel || !windows) return;
  const byId = new Map(Object.values(layers).map((layer) => [layer.id, layer]));
  const panelOnAir = getLayerTransformAtFrame(panel, windows.firstStep);
  const panelTracks = getResolvedLayerAnimationTracks(panel);
  const translations = new Map<'x' | 'y', LayerPropertyKeyframe[]>();
  for (const property of ['x', 'y'] as const) {
    const extent = property === 'x' ? 'width' : 'height';
    const revealEntrance = (panelTracks[extent] ?? []).some(
      (key) => key.frame < windows.firstStep && !close(key.value, panelOnAir[extent]),
    );
    const track = (panelTracks[property] ?? []).map((key) => ({
      ...key,
      // Right/bottom wipes move the viewport's leading edge; its contents must hold still.
      value: revealEntrance && key.frame < windows.firstStep ? panelOnAir[property] : key.value,
    }));
    if (track.some((key) => !close(key.value, panelOnAir[property])))
      translations.set(property, track);
  }
  if (translations.size === 0) return;

  for (const layer of Object.values(layers)) {
    if (layer === panel) continue;
    let parentId = layer.parentId;
    const visited = new Set<string>();
    while (parentId && parentId !== panel.id && !visited.has(parentId)) {
      visited.add(parentId);
      parentId = byId.get(parentId)?.parentId ?? null;
    }
    if (parentId !== panel.id) continue;

    const tracks = getResolvedLayerAnimationTracks(layer);
    const onAir = getLayerTransformAtFrame(layer, windows.firstStep);
    const changed: LayerPropertyKeyframe[][] = [];
    for (const [property, panelTrack] of translations) {
      const originalTrack = tracks[property] ?? [];
      const stationary = originalTrack.every((key) => close(key.value, onAir[property]));
      const sharedExit = hasSharedRecipeExit(
        composition,
        property,
        panelTrack,
        originalTrack,
        panelOnAir,
        onAir,
        windows.lastStep,
        windows.end,
        motion?.exit,
      );
      if (!stationary && !sharedExit) continue;
      const offset = onAir[property] - panelOnAir[property];
      const synchronized = (
        stationary ? panelTrack : panelTrack.filter((key) => key.frame > windows.lastStep)
      ).map((key) => ({
        ...key,
        id: `${layer.id}:${property}:${key.frame}`,
        value: key.value + offset,
        ...(key.curve ? { curve: { ...key.curve } } : {}),
      }));
      // A child may intentionally enter on a different path or with a stagger. Only its common
      // generated Out is replaced; customized exit keys, curves and targets fail recognition.
      const childTrack = stationary
        ? synchronized
        : [...originalTrack.filter((key) => key.frame <= windows.lastStep), ...synchronized];
      layer.animationTracks[property] = childTrack;
      changed.push(synchronized);
    }
    if (!changed.length) continue;

    const keysByFrame = new Map(layer.keyframes.map((key) => [key.frame, key]));
    for (const track of changed)
      for (const key of track)
        if (!keysByFrame.has(key.frame))
          keysByFrame.set(
            key.frame,
            createLayerKeyframe(key.frame, getLayerTransformAtFrame(layer, key.frame), {
              easing: key.easing,
            }),
          );
    layer.keyframes = [...keysByFrame.values()]
      .sort((a, b) => a.frame - b.frame)
      .map((key) => ({
        ...key,
        transform: getLayerTransformAtFrame(layer, key.frame),
        easing:
          changed.flat().find((trackKey) => trackKey.frame === key.frame)?.easing ?? key.easing,
      }));
  }
}
