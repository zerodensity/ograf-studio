import {
  defaultLayerMotionSpec,
  isAnimationPresetPluginSnapshot,
  rendererPluginKey,
  studioPluginReference,
  LAYER_MOTION_STYLES,
  TRANSITION_LOGIC_VERSION,
  validateAnimationPresetPluginSnapshot,
  type AnimationPluginPreset,
  type AnimationPresetPluginSnapshot,
  type LayerMotionSide,
  type LayerMotionStyle,
  type TransitionLogicContentAnimation,
  type TransitionLogicDefinition,
} from '@ograf-editor/scene-model';
import type { InstalledStudioPlugin } from './pluginSettingsStore';

export const TRANSITION_CONTENT_MOTIONS: ReadonlyArray<[LayerMotionStyle, string]> =
  LAYER_MOTION_STYLES.map((style) => [style, style[0]!.toUpperCase() + style.slice(1)]);

export interface TransitionAnimationPack {
  snapshot: AnimationPresetPluginSnapshot;
  retained: boolean;
  presets: AnimationPluginPreset[];
}

/** Packs are JSON data. Retained exact pins stay usable without a local installation. */
export function transitionAnimationPacks(
  definition: TransitionLogicDefinition,
  installed: readonly InstalledStudioPlugin[],
  side: LayerMotionSide,
): TransitionAnimationPack[] {
  const packs = new Map<string, TransitionAnimationPack>();
  const add = (snapshot: AnimationPresetPluginSnapshot, retained: boolean) => {
    if (validateAnimationPresetPluginSnapshot(snapshot).length) return;
    const key = rendererPluginKey(studioPluginReference(snapshot));
    const presets = snapshot.presets.filter(
      (preset) =>
        !!preset.tracks[side]?.length &&
        (!preset.targetKinds || preset.targetKinds.includes('rectangle')),
    );
    if (!presets.length) return;
    const previous = packs.get(key);
    if (previous && !previous.retained) return;
    packs.set(key, { snapshot, retained, presets });
  };
  for (const snapshot of definition.animationPresetPlugins ?? []) add(snapshot, true);
  for (const entry of installed)
    if (entry.enabled && entry.trusted && isAnimationPresetPluginSnapshot(entry.snapshot))
      add(entry.snapshot, false);
  return [...packs.values()].sort((a, b) =>
    `${a.snapshot.manifest.name} ${a.snapshot.manifest.version}`.localeCompare(
      `${b.snapshot.manifest.name} ${b.snapshot.manifest.version}`,
    ),
  );
}

export function transitionAnimationChoiceKey(choice?: TransitionLogicContentAnimation): string {
  if (!choice) return 'default';
  if (choice.type === 'template') return 'template';
  if (choice.type === 'builtin') return `builtin:${choice.motion.style}`;
  return `plugin:${JSON.stringify([rendererPluginKey(choice.reference), choice.presetId])}`;
}

export function transitionAnimationPresetKey(
  snapshot: AnimationPresetPluginSnapshot,
  preset: AnimationPluginPreset,
): string {
  return transitionAnimationChoiceKey({
    type: 'plugin',
    reference: studioPluginReference(snapshot),
    presetId: preset.id,
  });
}

export function defaultTransitionContentMotion(
  style: LayerMotionStyle,
): TransitionLogicContentAnimation {
  const {
    durationFrames: _duration,
    offsetFrames: _offset,
    ...motion
  } = defaultLayerMotionSpec(style, 12);
  return { type: 'builtin', motion };
}

/** Pin once, preserving the exact saved bytes when the same reference is selected again. */
export function pinTransitionAnimationPlugin(
  definition: TransitionLogicDefinition,
  snapshot?: AnimationPresetPluginSnapshot,
): TransitionLogicDefinition {
  if (!snapshot) return definition;
  const errors = validateAnimationPresetPluginSnapshot(snapshot);
  if (errors.length) throw new Error(errors.join(' '));
  const key = rendererPluginKey(studioPluginReference(snapshot));
  const current = definition.animationPresetPlugins?.find(
    (entry) => rendererPluginKey(studioPluginReference(entry)) === key,
  );
  if (current) {
    if (validateAnimationPresetPluginSnapshot(current).length)
      throw new Error('The saved animation snapshot is invalid. Review the plugin.');
    return definition;
  }
  return {
    ...definition,
    version: TRANSITION_LOGIC_VERSION,
    animationPresetPlugins: [
      ...(definition.animationPresetPlugins ?? []),
      structuredClone(snapshot),
    ],
  };
}
