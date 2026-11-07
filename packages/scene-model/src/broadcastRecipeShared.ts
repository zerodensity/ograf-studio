import { createAnimationTracksFromLegacyLayer } from './layerAnimation';
import { createFieldDefinition, createLayerOfKind, createLayerSemantics } from './factory';
import { createId } from './id';
import { buildLayerMotionKeyframes, type MotionDirection, type MotionStyle } from './motionPresets';
import {
  applyStylePack,
  resolveStylePackMotion,
  STYLE_TOKEN_KEYS,
  stylePackIdForComposition,
  styleTokenValue,
  type StylePackId,
} from './stylePacks';
import type {
  Composition,
  EasingPreset,
  Layer,
  LayerTransform,
  TickerElement,
  TickerItem,
} from './types';

export type BroadcastRecipeName = 'bug' | 'ticker' | 'scoreboard' | 'clock' | 'countdown';

export interface BroadcastRecipeMotionOptions {
  style?: MotionStyle;
  entrance?: MotionDirection;
  exit?: MotionDirection;
  staggerFrames?: number;
  entranceDurationFrames?: number;
  exitDurationFrames?: number;
  entranceEasing?: EasingPreset;
  exitEasing?: EasingPreset;
}

export interface CommonRecipeOptions {
  /** Save a reusable asset and keep this scene instance linked by default. */
  asComponent?: boolean;
  name?: string;
  stylePack?: StylePackId;
  placement?: Partial<Pick<LayerTransform, 'x' | 'y' | 'width' | 'height'>>;
  motion?: BroadcastRecipeMotionOptions;
}

export interface BugRecipeOptions extends CommonRecipeOptions {
  content?: { label?: string };
  fieldKey?: string;
}

export interface TickerRecipeOptions extends CommonRecipeOptions {
  content?: { label?: string; text?: string };
  fieldKeys?: { label?: string; text?: string; feed?: string };
  speedPixelsPerSecond?: number;
  items?: TickerItem[];
  gap?: number;
  direction?: TickerElement['direction'];
  textDirection?: TickerElement['textDirection'];
  updatePolicy?: TickerElement['updatePolicy'];
  entryFade?: number;
  exitFade?: number;
  fadeSoftness?: number;
}

export interface ScoreboardRecipeOptions extends CommonRecipeOptions {
  content?: {
    homeName?: string;
    homeScore?: number;
    awayScore?: number;
    awayName?: string;
  };
  fieldKeys?: {
    homeName?: string;
    homeScore?: string;
    awayScore?: string;
    awayName?: string;
  };
}

export interface ClockRecipeOptions extends CommonRecipeOptions {
  /** Stable reference captured for projected authoring transactions. */
  referenceTimeMs?: number;
  content?: { hours?: string; minutes?: string };
  fieldKeys?: { hours?: string; minutes?: string; value?: string };
  mode?: 'clock' | 'count-up' | 'count-down';
  source?: 'automatic' | 'manual';
  format?: string;
  timeZone?: string;
  hourCycle?: '12' | '24';
  durationSeconds?: number;
  alarms?: boolean;
}

export interface MaterializedBroadcastRecipe {
  recipe: BroadcastRecipeName;
  name: string;
  stylePack: StylePackId;
  groupId: string;
  timelineGroupId: string;
  layers: Record<string, string>;
  fields: Record<string, string>;
  componentId?: string;
  instanceId?: string;
}

export interface ResolvedRecipeMotion {
  style: MotionStyle;
  entrance: MotionDirection;
  exit: MotionDirection;
  staggerFrames: number;
  entranceDurationFrames: number;
  exitDurationFrames: number;
  entranceEasing: EasingPreset;
  exitEasing: EasingPreset;
}

export interface RecipeContext {
  packId: StylePackId;
  motion: ResolvedRecipeMotion;
  groupId: string;
  timelineGroupId: string;
  color: (key: Parameters<typeof styleTokenValue>[1], fallback: string) => string;
  number: (key: Parameters<typeof styleTokenValue>[1], fallback: number) => number;
}

export function requireStep(composition: Composition, recipe: string): void {
  if (!composition.keyframes.some((keyframe) => keyframe.role === 'step')) {
    throw new Error(`The ${recipe} recipe requires at least one pausable OGraf Step.`);
  }
}

export function uniqueFieldKey(
  composition: Composition,
  requested: string,
  fallback: string,
): string {
  const base = (requested.trim() || fallback).replace(/[^A-Za-z0-9_]+/g, '_').replace(/^\d/, '_$&');
  let key = base || fallback;
  let suffix = 2;
  while (composition.dataFields.some((field) => field.key === key)) key = `${base}_${suffix++}`;
  return key;
}

export function fieldKeyAllocator(composition: Composition) {
  const reserved = new Set(composition.dataFields.map((field) => field.key));
  return (requested: string, fallback: string) => {
    const base = (requested.trim() || fallback)
      .replace(/[^A-Za-z0-9_]+/g, '_')
      .replace(/^\d/, '_$&');
    let key = base || fallback;
    let suffix = 2;
    while (reserved.has(key)) key = `${base}_${suffix++}`;
    reserved.add(key);
    return key;
  };
}

export function context(
  composition: Composition,
  requestedPack: StylePackId | undefined,
  fallbackPack: StylePackId,
  motion: BroadcastRecipeMotionOptions | undefined,
  defaults: Pick<ResolvedRecipeMotion, 'style' | 'entrance' | 'exit'>,
): RecipeContext {
  const currentPack = stylePackIdForComposition(composition);
  const packId = requestedPack ?? currentPack ?? fallbackPack;
  const refreshTokens = requestedPack !== undefined || currentPack === null;
  applyStylePack(composition, packId, {
    ...(refreshTokens ? {} : { bindLayerIds: [] }),
    refreshTokens,
  });
  const convention = resolveStylePackMotion(composition, packId);
  return {
    packId,
    groupId: createId('group'),
    timelineGroupId: createId('timeline-group'),
    motion: {
      style: motion?.style ?? defaults.style,
      entrance: motion?.entrance ?? defaults.entrance,
      exit: motion?.exit ?? defaults.exit,
      staggerFrames: Math.max(0, Math.round(motion?.staggerFrames ?? convention.staggerFrames)),
      entranceDurationFrames: Math.max(
        2,
        Math.round(motion?.entranceDurationFrames ?? convention.entranceFrames),
      ),
      exitDurationFrames: Math.max(
        2,
        Math.round(motion?.exitDurationFrames ?? convention.exitFrames),
      ),
      entranceEasing: motion?.entranceEasing ?? convention.entranceEasing,
      exitEasing: motion?.exitEasing ?? convention.exitEasing,
    },
    color: (key, fallback) => String(styleTokenValue(composition, key, fallback)),
    number: (key, fallback) => {
      const value = Number(styleTokenValue(composition, key, fallback));
      return Number.isFinite(value) ? value : fallback;
    },
  };
}

export function recipeLayer(
  composition: Composition,
  recipe: BroadcastRecipeName,
  name: string,
  groupId: string,
  kind: Parameters<typeof createLayerOfKind>[0],
  role: Layer['semantics']['role'],
  tags: string[],
  onAir: LayerTransform,
  motion: ResolvedRecipeMotion,
  cascadeIndex: number,
  cascadeCount: number,
  revealMask = false,
): Layer {
  const layer = createLayerOfKind(kind);
  layer.name = name;
  layer.groupId = groupId;
  layer.semantics = createLayerSemantics({
    role,
    tags: [recipe, ...tags],
    description: `${role} generated by the ${recipe} authoring recipe.`,
  });
  layer.keyframes = buildLayerMotionKeyframes({
    composition,
    onAir,
    style: motion.style,
    entrance: motion.entrance,
    exit: motion.exit,
    staggerFrames: motion.staggerFrames,
    cascadeIndex,
    cascadeCount,
    isRevealMask: revealMask,
    entranceDurationFrames: motion.entranceDurationFrames,
    exitDurationFrames: motion.exitDurationFrames,
    entranceEasing: motion.entranceEasing,
    exitEasing: motion.exitEasing,
  });
  layer.animationTracks = createAnimationTracksFromLegacyLayer(layer);
  return layer;
}

export function staticRecipeLayer(
  composition: Composition,
  recipe: BroadcastRecipeName,
  name: string,
  groupId: string,
  kind: Parameters<typeof createLayerOfKind>[0],
  role: Layer['semantics']['role'],
  tags: string[],
  onAir: LayerTransform,
): Layer {
  return recipeLayer(
    composition,
    recipe,
    name,
    groupId,
    kind,
    role,
    tags,
    onAir,
    {
      style: 'none',
      entrance: 'none',
      exit: 'none',
      staggerFrames: 0,
      entranceDurationFrames: 2,
      exitDurationFrames: 2,
      entranceEasing: 'linear',
      exitEasing: 'linear',
    },
    0,
    1,
  );
}

export function finish(
  composition: Composition,
  context: RecipeContext,
  recipe: BroadcastRecipeName,
  name: string,
  layers: Record<string, Layer>,
  fields: Record<string, ReturnType<typeof createFieldDefinition>>,
): MaterializedBroadcastRecipe {
  const layerValues = Object.values(layers);
  const fieldValues = Object.values(fields);
  composition.layers.push(...layerValues);
  composition.dataFields.push(...fieldValues);
  applyStylePack(composition, context.packId, {
    bindLayerIds: layerValues.map((layer) => layer.id),
    refreshTokens: false,
  });
  composition.layout.timelineFolders.push({
    id: context.timelineGroupId,
    name,
    color: context.color(STYLE_TOKEN_KEYS.accent, '#31b7d4'),
    layerIds: layerValues.map((layer) => layer.id),
  });
  return {
    recipe,
    name,
    stylePack: context.packId,
    groupId: context.groupId,
    timelineGroupId: context.timelineGroupId,
    layers: Object.fromEntries(Object.entries(layers).map(([key, layer]) => [key, layer.id])),
    fields: Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.id])),
  };
}

export function pose(x: number, y: number, width: number, height: number): LayerTransform {
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
    rotation: 0,
    opacity: 1,
    transformOriginX: 0.5,
    transformOriginY: 0.5,
  };
}
