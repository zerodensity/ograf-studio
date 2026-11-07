import {
  applyAnimationPreset,
  resolveAnimationPresetKeyValue,
  studioPluginKey,
  studioPluginReference,
  validateAnimationPresetPluginSnapshot,
} from './animationPresetPlugins';
import { CHART_ANIMATION_EASINGS } from './chartAnimation';
import {
  createComposition,
  createDefaultTransform,
  createKeyframe,
  createLayerKeyframe,
  createRectangleLayer,
  createTransition,
} from './factory';
import { applyLayerMotion, layerMotionDirections, LAYER_MOTION_STYLES } from './layerMotion';
import {
  MAX_RENDERER_PLUGIN_CATALOG_BYTES,
  MAX_RENDERER_PLUGIN_CATALOG_ENTRIES,
  rendererPluginByteLength,
} from './rendererPlugins';
import type { AnimationPresetPluginSnapshot, Composition } from './types';
import type { TransitionLogicContentAnimation } from './transitionLogic';

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** The definition owns each immutable JSON-only animation pack once, never per recipe. */
export function transitionAnimationCatalogErrors(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_RENDERER_PLUGIN_CATALOG_ENTRIES)
    return ['Transition animation catalog must contain at most 16 animation packs.'];
  let bytes: number;
  try {
    bytes = rendererPluginByteLength(JSON.stringify(value));
  } catch {
    return ['Transition animation catalog must be JSON-safe.'];
  }
  if (bytes > MAX_RENDERER_PLUGIN_CATALOG_BYTES)
    return ['Transition animation catalog exceeds its 8 MiB limit.'];
  const errors: string[] = [];
  const identities = new Set<string>();
  for (const snapshot of value) {
    const invalid = validateAnimationPresetPluginSnapshot(snapshot);
    errors.push(...invalid);
    if (invalid.length) continue;
    const key = studioPluginKey(studioPluginReference(snapshot));
    if (identities.has(key)) errors.push('Transition animation catalog repeats a pinned pack.');
    identities.add(key);
  }
  return errors;
}

/** Validate before baking; unsupported presets must not silently become fades. */
export function transitionContentAnimationErrors(
  value: unknown,
  side: 'in' | 'out',
  durationFrames: number,
  catalog: readonly AnimationPresetPluginSnapshot[] = [],
): string[] {
  if (value === undefined) return [];
  if (!record(value)) return ['Content animation must be an object.'];
  const unknownFields = (allowed: string[]) =>
    Object.keys(value).some((key) => !allowed.includes(key));
  if (value.type === 'template')
    return unknownFields(['type']) ? ['Template animation has unsupported fields.'] : [];
  if (value.type === 'builtin') {
    if (unknownFields(['type', 'motion']) || !record(value.motion))
      return ['Built-in content animation needs a motion specification.'];
    const motion = value.motion;
    if (
      Object.keys(motion).some(
        (key) => !['style', 'direction', 'distance', 'easing'].includes(key),
      ) ||
      !LAYER_MOTION_STYLES.includes(motion.style as never)
    )
      return ['Built-in content animation has unsupported motion fields or style.'];
    const errors: string[] = [];
    if (
      motion.direction !== undefined &&
      !layerMotionDirections(motion.style as never).includes(motion.direction as never)
    )
      errors.push('Built-in content animation direction is unavailable for this style.');
    if (
      motion.distance !== undefined &&
      (!finite(motion.distance) || motion.distance < 0 || motion.distance > 1_000_000)
    )
      errors.push('Built-in content animation distance must be finite and in 0..1000000.');
    if (motion.easing !== undefined && !CHART_ANIMATION_EASINGS.includes(motion.easing as never))
      errors.push('Built-in content animation easing is unsupported.');
    return errors;
  }
  if (
    value.type !== 'plugin' ||
    unknownFields(['type', 'reference', 'presetId', 'parameters']) ||
    !record(value.reference)
  )
    return ['Content animation must select template, builtin, or a pinned plugin preset.'];
  if (Object.keys(value.reference).some((key) => !['id', 'version', 'sha256'].includes(key)))
    return ['Content animation plugin identity has unsupported fields.'];
  const reference = value.reference;
  const snapshot = catalog.find(
    (entry) =>
      entry.manifest.id === reference.id &&
      entry.manifest.version === reference.version &&
      entry.sha256 === reference.sha256,
  );
  if (!snapshot)
    return ['Content animation plugin is missing its exact pinned identity and digest.'];
  const preset = snapshot.presets.find((entry) => entry.id === value.presetId);
  if (!preset) return ['Content animation preset is missing from its pinned plugin.'];
  const errors: string[] = [];
  if (preset.targetKinds && !preset.targetKinds.includes('rectangle'))
    errors.push('Content animation preset must support the rectangle content wrapper.');
  const tracks = preset.tracks[side];
  if (!tracks?.length) errors.push(`Content animation preset has no ${side} tracks.`);
  if (value.parameters !== undefined && !record(value.parameters))
    errors.push('Content animation parameters must be a numeric object.');
  else
    for (const [id, parameterValue] of Object.entries(value.parameters ?? {})) {
      const parameter = preset.parameters?.find((entry) => entry.id === id);
      if (
        !parameter ||
        !finite(parameterValue) ||
        parameterValue < parameter.min ||
        parameterValue > parameter.max
      )
        errors.push(`Content animation parameter ${id} is unknown or outside its declared range.`);
    }
  // Zero-duration phases are intentional cuts; no animation keys are sampled for them.
  if (
    durationFrames > 0 &&
    tracks?.some(
      (track) =>
        new Set(track.keys.map((key) => Math.round(key.at * durationFrames))).size !==
        track.keys.length,
    )
  )
    errors.push(
      'Content animation duration is too short: normalized key times collide at a frame.',
    );
  if (!errors.length && durationFrames > 0) {
    const parameters: Record<string, number> = {
      ...Object.fromEntries(
        (preset.parameters ?? []).map((parameter) => [parameter.id, parameter.default]),
      ),
      ...(value.parameters as Record<string, number> | undefined),
    };
    // The wrapper's plugin-track anchors are dimension-independent: unit opacity/scale, zero
    // translation, rotation, blur, and clipping. Reuse numeric resolution without baking a scene.
    for (const track of tracks ?? []) {
      const onAir = track.property === 'opacity' || track.property === 'scale' ? 1 : 0;
      try {
        for (const key of track.keys)
          resolveAnimationPresetKeyValue(track, key.value, onAir, parameters);
      } catch (cause) {
        errors.push(cause instanceof Error ? cause.message : String(cause));
      }
    }
  }
  return errors;
}

/**
 * Bake one full-canvas wrapper using the same native/plugin bakers as ordinary Animate In/Out.
 * Source layers and shared instances are never changed. Runtime samples in at 0..D, out at D..2D.
 */
export function createTransitionContentAnimationComposition(
  choice: TransitionLogicContentAnimation | undefined,
  side: 'in' | 'out',
  durationFrames: number,
  width: number,
  height: number,
  frameRate: number,
  catalog: readonly AnimationPresetPluginSnapshot[] = [],
): Composition | null {
  const errors = transitionContentAnimationErrors(choice, side, durationFrames, catalog);
  if (errors.length) throw new Error(errors.join(' '));
  if (!choice || choice.type === 'template' || durationFrames === 0) return null;
  if (
    !Number.isSafeInteger(durationFrames) ||
    durationFrames < 0 ||
    ![width, height, frameRate].every((value) => finite(value) && value > 0)
  )
    throw new Error('Content animation needs a valid duration, output size, and frame rate.');
  const keys = ['start', 'step', 'end'].map((role) =>
    createKeyframe({
      id: `transition-content-${role}`,
      role: role as 'start' | 'step' | 'end',
      name: role,
    }),
  );
  const layer = createRectangleLayer();
  layer.id = 'transition-content-wrapper';
  layer.name = 'Transition content';
  layer.element = { ...layer.element, fill: 'transparent' } as typeof layer.element;
  const transform = createDefaultTransform({ x: 0, y: 0, width, height });
  layer.keyframes = [0, durationFrames, durationFrames * 2].map((frame, index) =>
    createLayerKeyframe(frame, transform, { id: `transition-content-pose-${index}` }),
  );
  const composition = createComposition({
    id: 'transition-content',
    width,
    height,
    frameRate,
    layers: [layer],
    keyframes: keys,
    transitions: keys.slice(1).map((key, index) =>
      createTransition(keys[index]!.id, key.id, {
        id: `transition-content-phase-${index}`,
        durationFrames,
      }),
    ),
  });
  if (choice.type === 'builtin')
    applyLayerMotion(composition, layer, side, { ...choice.motion, durationFrames });
  else {
    const snapshot = catalog.find(
      (entry) =>
        studioPluginKey(studioPluginReference(entry)) === studioPluginKey(choice.reference),
    )!;
    applyAnimationPreset(composition, layer, snapshot, choice.presetId, side, {
      durationFrames,
      ...(choice.parameters ? { parameters: choice.parameters } : {}),
    });
  }
  // Factory IDs are intentionally random for authoring; compiled synthetic output is reproducible.
  layer.keyframes.forEach((key, index) => {
    key.id = `transition-content-pose-${index}`;
  });
  for (const [property, track] of Object.entries(layer.animationTracks ?? {}))
    track?.forEach((key, index) => {
      key.id = `transition-content-${property}-${index}`;
    });
  return composition;
}
