import { createAnimationTracksFromLegacyLayer } from './layerAnimation';
import {
  createFieldDefinition,
  createLayerLoopClip,
  createLayerOfKind,
  createLayerPropertyKeyframe,
  createLayerSemantics,
} from './factory';
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
import type { Composition, EasingPreset, Layer, LayerTransform } from './types';

export type BroadcastRecipeName = 'bug' | 'ticker' | 'scoreboard' | 'clock';

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

interface CommonRecipeOptions {
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
  fieldKeys?: { label?: string; text?: string };
  speedPixelsPerSecond?: number;
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
  content?: { hours?: string; minutes?: string };
  fieldKeys?: { hours?: string; minutes?: string };
}

export interface MaterializedBroadcastRecipe {
  recipe: BroadcastRecipeName;
  name: string;
  stylePack: StylePackId;
  groupId: string;
  timelineGroupId: string;
  layers: Record<string, string>;
  fields: Record<string, string>;
}

interface ResolvedRecipeMotion {
  style: MotionStyle;
  entrance: MotionDirection;
  exit: MotionDirection;
  staggerFrames: number;
  entranceDurationFrames: number;
  exitDurationFrames: number;
  entranceEasing: EasingPreset;
  exitEasing: EasingPreset;
}

interface RecipeContext {
  packId: StylePackId;
  motion: ResolvedRecipeMotion;
  groupId: string;
  timelineGroupId: string;
  color: (key: Parameters<typeof styleTokenValue>[1], fallback: string) => string;
  number: (key: Parameters<typeof styleTokenValue>[1], fallback: number) => number;
}

function requireStep(composition: Composition, recipe: string): void {
  if (!composition.keyframes.some((keyframe) => keyframe.role === 'step')) {
    throw new Error(`The ${recipe} recipe requires at least one pausable OGraf Step.`);
  }
}

function uniqueFieldKey(composition: Composition, requested: string, fallback: string): string {
  const base = (requested.trim() || fallback).replace(/[^A-Za-z0-9_]+/g, '_').replace(/^\d/, '_$&');
  let key = base || fallback;
  let suffix = 2;
  while (composition.dataFields.some((field) => field.key === key)) key = `${base}_${suffix++}`;
  return key;
}

function fieldKeyAllocator(composition: Composition) {
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

function context(
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

function recipeLayer(
  composition: Composition,
  recipe: BroadcastRecipeName,
  name: string,
  groupId: string,
  kind: 'rectangle' | 'ellipse' | 'text',
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

function staticRecipeLayer(
  composition: Composition,
  recipe: BroadcastRecipeName,
  name: string,
  groupId: string,
  kind: 'rectangle' | 'ellipse' | 'text',
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

function finish(
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

function pose(x: number, y: number, width: number, height: number): LayerTransform {
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

export function materializeBug(
  composition: Composition,
  options: BugRecipeOptions = {},
): MaterializedBroadcastRecipe {
  requireStep(composition, 'bug');
  const name = options.name?.trim() || 'Channel Bug';
  const ctx = context(composition, options.stylePack, 'news', options.motion, {
    style: 'wipe',
    entrance: 'right',
    exit: 'up',
  });
  const width = Math.max(220, Math.round(options.placement?.width ?? composition.width * 0.19));
  const height = Math.max(64, Math.round(options.placement?.height ?? composition.height * 0.085));
  const x = Math.round(
    options.placement?.x ?? composition.width - width - composition.width * 0.045,
  );
  const y = Math.round(options.placement?.y ?? composition.height * 0.055);
  const panel = recipeLayer(
    composition,
    'bug',
    `${name} · Panel`,
    ctx.groupId,
    'rectangle',
    'container',
    ['panel', 'primary'],
    pose(x, y, width, height),
    ctx.motion,
    0,
    3,
    ctx.motion.style === 'wipe',
  );
  panel.clipChildren = true;
  const accentWidth = Math.max(6, Math.round(height * 0.08));
  const accent = staticRecipeLayer(
    composition,
    'bug',
    `${name} · Accent`,
    ctx.groupId,
    'rectangle',
    'accent',
    ['accent'],
    pose(x, y, accentWidth, height),
  );
  const label = staticRecipeLayer(
    composition,
    'bug',
    `${name} · Label`,
    ctx.groupId,
    'text',
    'label',
    ['editable', 'identity'],
    pose(x + accentWidth + 18, y + 12, width - accentWidth - 36, height - 24),
  );
  if (label.element.type === 'text') {
    label.element.content = options.content?.label ?? 'LIVE';
    label.element.autoFit = 'shrink-to-fit';
    label.element.overflowPolicy = 'clip';
  }
  accent.parentId = panel.id;
  label.parentId = panel.id;
  const labelField = createFieldDefinition('text', {
    key: uniqueFieldKey(composition, options.fieldKey ?? 'bug_label', 'bug_label'),
    label: `${name} Label`,
    description: 'Short bug, watermark, or live-status label.',
    defaultValue: label.element.type === 'text' ? label.element.content : 'LIVE',
    constraints: { maxLength: 24 },
  });
  label.bindings = [{ fieldId: labelField.id, targetProperty: 'content' }];
  return finish(composition, ctx, 'bug', name, { panel, accent, label }, { label: labelField });
}

export function materializeTicker(
  composition: Composition,
  options: TickerRecipeOptions = {},
): MaterializedBroadcastRecipe {
  requireStep(composition, 'ticker');
  const name = options.name?.trim() || 'News Ticker';
  const ctx = context(composition, options.stylePack, 'news', options.motion, {
    style: 'wipe',
    entrance: 'left',
    exit: 'down',
  });
  const width = Math.max(640, Math.round(options.placement?.width ?? composition.width * 0.84));
  const height = Math.max(48, Math.round(options.placement?.height ?? composition.height * 0.065));
  const x = Math.round(options.placement?.x ?? (composition.width - width) / 2);
  const y = Math.round(
    options.placement?.y ?? composition.height - height - composition.height * 0.04,
  );
  const window = recipeLayer(
    composition,
    'ticker',
    `${name} · Window`,
    ctx.groupId,
    'rectangle',
    'mask',
    ['window', 'clip'],
    pose(x, y, width, height),
    ctx.motion,
    0,
    4,
    true,
  );
  window.clipChildren = true;
  const labelWidth = Math.max(110, Math.round(width * 0.12));
  const labelPlate = staticRecipeLayer(
    composition,
    'ticker',
    `${name} · Label Plate`,
    ctx.groupId,
    'rectangle',
    'accent',
    ['label-plate'],
    pose(x, y, labelWidth, height),
  );
  const label = staticRecipeLayer(
    composition,
    'ticker',
    `${name} · Label`,
    ctx.groupId,
    'text',
    'label',
    ['editable', 'category'],
    pose(x + 14, y + 8, labelWidth - 28, height - 16),
  );
  const crawlWidth = Math.max(1200, Math.round(width * 1.7));
  const crawl = staticRecipeLayer(
    composition,
    'ticker',
    `${name} · Crawl`,
    ctx.groupId,
    'text',
    'ticker',
    ['editable', 'crawl', 'qa:allow-loop-seam', 'qa:allow-offcanvas'],
    pose(x + width, y + 8, crawlWidth, height - 16),
  );
  if (label.element.type === 'text') {
    label.element.content = options.content?.label ?? 'NEWS';
    label.element.autoFit = 'shrink-to-fit';
    label.element.overflowPolicy = 'clip';
  }
  if (crawl.element.type === 'text') {
    crawl.element.content =
      options.content?.text ??
      'Latest headlines and information update continuously across the screen.';
    crawl.element.autoFit = 'fixed';
    crawl.element.overflowPolicy = 'visible';
  }
  for (const child of [labelPlate, label, crawl]) child.parentId = window.id;
  const speed = Math.max(
    40,
    Number(options.speedPixelsPerSecond ?? 180 * (composition.height / 1080)),
  );
  const distance = width + crawlWidth;
  const durationFrames = Math.max(30, Math.round((distance / speed) * composition.frameRate));
  crawl.loop = createLayerLoopClip({
    name: `${name} Crawl`,
    activation: { type: 'lifecycle' },
    durationFrames,
    repeatCount: null,
    tracks: {
      x: [
        createLayerPropertyKeyframe(0, x + width, { easing: 'linear' }),
        createLayerPropertyKeyframe(durationFrames, x - crawlWidth, { easing: 'linear' }),
      ],
    },
  });
  const nextTickerFieldKey = fieldKeyAllocator(composition);
  const labelField = createFieldDefinition('text', {
    key: nextTickerFieldKey(options.fieldKeys?.label ?? 'ticker_label', 'ticker_label'),
    label: `${name} Label`,
    description: 'Short category label preceding the crawl.',
    defaultValue: label.element.type === 'text' ? label.element.content : 'NEWS',
    constraints: { maxLength: 16 },
  });
  const textField = createFieldDefinition('textarea', {
    key: nextTickerFieldKey(options.fieldKeys?.text ?? 'ticker_text', 'ticker_text'),
    label: `${name} Text`,
    description: 'Continuous ticker or crawl content.',
    defaultValue: crawl.element.type === 'text' ? crawl.element.content : '',
    constraints: { maxLength: 240 },
  });
  label.bindings = [{ fieldId: labelField.id, targetProperty: 'content' }];
  crawl.bindings = [{ fieldId: textField.id, targetProperty: 'content' }];
  return finish(
    composition,
    ctx,
    'ticker',
    name,
    { window, labelPlate, label, crawl },
    { label: labelField, text: textField },
  );
}

export function materializeScoreboard(
  composition: Composition,
  options: ScoreboardRecipeOptions = {},
): MaterializedBroadcastRecipe {
  requireStep(composition, 'scoreboard');
  const name = options.name?.trim() || 'Scoreboard';
  const ctx = context(composition, options.stylePack, 'sports', options.motion, {
    style: 'wipe',
    entrance: 'up',
    exit: 'up',
  });
  const width = Math.max(560, Math.round(options.placement?.width ?? composition.width * 0.42));
  const height = Math.max(96, Math.round(options.placement?.height ?? composition.height * 0.12));
  const x = Math.round(options.placement?.x ?? (composition.width - width) / 2);
  const y = Math.round(options.placement?.y ?? composition.height * 0.055);
  const panel = recipeLayer(
    composition,
    'scoreboard',
    `${name} · Panel`,
    ctx.groupId,
    'rectangle',
    'container',
    ['panel'],
    pose(x, y, width, height),
    ctx.motion,
    0,
    6,
    true,
  );
  panel.clipChildren = true;
  const scoreWidth = Math.max(86, Math.round(width * 0.14));
  const dividerWidth = Math.max(4, Math.round(width * 0.008));
  const teamWidth = (width - scoreWidth * 2 - dividerWidth - 48) / 2;
  const homeName = staticRecipeLayer(
    composition,
    'scoreboard',
    `${name} · Home Team`,
    ctx.groupId,
    'text',
    'label',
    ['home', 'team', 'editable'],
    pose(x + 20, y + 20, teamWidth, height - 40),
  );
  const homeScore = staticRecipeLayer(
    composition,
    'scoreboard',
    `${name} · Home Score`,
    ctx.groupId,
    'text',
    'score',
    ['home', 'score', 'editable'],
    pose(x + 24 + teamWidth, y + 10, scoreWidth, height - 20),
  );
  const dividerX = x + 24 + teamWidth + scoreWidth;
  const divider = staticRecipeLayer(
    composition,
    'scoreboard',
    `${name} · Divider`,
    ctx.groupId,
    'rectangle',
    'accent',
    ['divider'],
    pose(dividerX, y + 16, dividerWidth, height - 32),
  );
  const awayScore = staticRecipeLayer(
    composition,
    'scoreboard',
    `${name} · Away Score`,
    ctx.groupId,
    'text',
    'score',
    ['away', 'score', 'editable'],
    pose(dividerX + dividerWidth, y + 10, scoreWidth, height - 20),
  );
  const awayName = staticRecipeLayer(
    composition,
    'scoreboard',
    `${name} · Away Team`,
    ctx.groupId,
    'text',
    'label',
    ['away', 'team', 'editable'],
    pose(dividerX + dividerWidth + scoreWidth + 8, y + 20, teamWidth, height - 40),
  );
  for (const child of [homeName, homeScore, divider, awayScore, awayName]) {
    child.parentId = panel.id;
  }
  for (const text of [homeName, homeScore, awayScore, awayName]) {
    if (text.element.type !== 'text') continue;
    text.element.textAlign = text === homeName ? 'right' : text === awayName ? 'left' : 'center';
    text.element.verticalAlign = 'middle';
    text.element.autoFit = 'shrink-to-fit';
    text.element.overflowPolicy = 'clip';
  }
  if (homeName.element.type === 'text')
    homeName.element.content = options.content?.homeName ?? 'HOME';
  if (homeScore.element.type === 'text')
    homeScore.element.content = String(options.content?.homeScore ?? 0);
  if (awayScore.element.type === 'text')
    awayScore.element.content = String(options.content?.awayScore ?? 0);
  if (awayName.element.type === 'text')
    awayName.element.content = options.content?.awayName ?? 'AWAY';
  const nextScoreFieldKey = fieldKeyAllocator(composition);
  const homeNameField = createFieldDefinition('text', {
    key: nextScoreFieldKey(options.fieldKeys?.homeName ?? 'home_name', 'home_name'),
    label: 'Home Team',
    description: 'Home team abbreviation or short name.',
    defaultValue: homeName.element.type === 'text' ? homeName.element.content : 'HOME',
    constraints: { maxLength: 20 },
  });
  const homeScoreField = createFieldDefinition('integer', {
    key: nextScoreFieldKey(options.fieldKeys?.homeScore ?? 'home_score', 'home_score'),
    label: 'Home Score',
    description: 'Home team score.',
    defaultValue: options.content?.homeScore ?? 0,
    constraints: { minimum: 0, maximum: 999 },
  });
  const awayScoreField = createFieldDefinition('integer', {
    key: nextScoreFieldKey(options.fieldKeys?.awayScore ?? 'away_score', 'away_score'),
    label: 'Away Score',
    description: 'Away team score.',
    defaultValue: options.content?.awayScore ?? 0,
    constraints: { minimum: 0, maximum: 999 },
  });
  const awayNameField = createFieldDefinition('text', {
    key: nextScoreFieldKey(options.fieldKeys?.awayName ?? 'away_name', 'away_name'),
    label: 'Away Team',
    description: 'Away team abbreviation or short name.',
    defaultValue: awayName.element.type === 'text' ? awayName.element.content : 'AWAY',
    constraints: { maxLength: 20 },
  });
  homeName.bindings = [{ fieldId: homeNameField.id, targetProperty: 'content' }];
  homeScore.bindings = [{ fieldId: homeScoreField.id, targetProperty: 'content' }];
  awayScore.bindings = [{ fieldId: awayScoreField.id, targetProperty: 'content' }];
  awayName.bindings = [{ fieldId: awayNameField.id, targetProperty: 'content' }];
  return finish(
    composition,
    ctx,
    'scoreboard',
    name,
    { panel, homeName, homeScore, divider, awayScore, awayName },
    {
      homeName: homeNameField,
      homeScore: homeScoreField,
      awayScore: awayScoreField,
      awayName: awayNameField,
    },
  );
}

export function materializeClock(
  composition: Composition,
  options: ClockRecipeOptions = {},
): MaterializedBroadcastRecipe {
  requireStep(composition, 'clock');
  const name = options.name?.trim() || 'Clock';
  const ctx = context(composition, options.stylePack, 'news', options.motion, {
    style: 'slide',
    entrance: 'up',
    exit: 'up',
  });
  const width = Math.max(220, Math.round(options.placement?.width ?? composition.width * 0.15));
  const height = Math.max(72, Math.round(options.placement?.height ?? composition.height * 0.09));
  const x = Math.round(
    options.placement?.x ?? composition.width - width - composition.width * 0.045,
  );
  const y = Math.round(options.placement?.y ?? composition.height * 0.055);
  const panel = recipeLayer(
    composition,
    'clock',
    `${name} · Panel`,
    ctx.groupId,
    'rectangle',
    'container',
    ['panel'],
    pose(x, y, width, height),
    ctx.motion,
    0,
    4,
  );
  panel.clipChildren = true;
  const digitWidth = (width - 36) / 2;
  const hours = staticRecipeLayer(
    composition,
    'clock',
    `${name} · Hours`,
    ctx.groupId,
    'text',
    'value',
    ['hours', 'editable'],
    pose(x + 10, y + 8, digitWidth, height - 16),
  );
  const separator = staticRecipeLayer(
    composition,
    'clock',
    `${name} · Separator`,
    ctx.groupId,
    'text',
    'value',
    ['separator', 'qa:static-text'],
    pose(x + 10 + digitWidth, y + 8, 16, height - 16),
  );
  const minutes = staticRecipeLayer(
    composition,
    'clock',
    `${name} · Minutes`,
    ctx.groupId,
    'text',
    'value',
    ['minutes', 'editable'],
    pose(x + 26 + digitWidth, y + 8, digitWidth, height - 16),
  );
  for (const text of [hours, separator, minutes]) {
    if (text.element.type !== 'text') continue;
    text.element.textAlign = 'center';
    text.element.verticalAlign = 'middle';
    text.element.autoFit = 'shrink-to-fit';
    text.element.overflowPolicy = 'clip';
  }
  for (const child of [hours, separator, minutes]) child.parentId = panel.id;
  if (hours.element.type === 'text') hours.element.content = options.content?.hours ?? '18';
  if (separator.element.type === 'text') separator.element.content = ':';
  if (minutes.element.type === 'text') minutes.element.content = options.content?.minutes ?? '42';
  const nextClockFieldKey = fieldKeyAllocator(composition);
  const hoursField = createFieldDefinition('text', {
    key: nextClockFieldKey(options.fieldKeys?.hours ?? 'clock_hours', 'clock_hours'),
    label: 'Clock Hours',
    description: 'Two-digit 24-hour clock hour.',
    defaultValue: hours.element.type === 'text' ? hours.element.content : '18',
    constraints: { maxLength: 2, pattern: '^([01][0-9]|2[0-3])$' },
  });
  const minutesField = createFieldDefinition('text', {
    key: nextClockFieldKey(options.fieldKeys?.minutes ?? 'clock_minutes', 'clock_minutes'),
    label: 'Clock Minutes',
    description: 'Two-digit clock minute.',
    defaultValue: minutes.element.type === 'text' ? minutes.element.content : '42',
    constraints: { maxLength: 2, pattern: '^[0-5][0-9]$' },
  });
  hours.bindings = [{ fieldId: hoursField.id, targetProperty: 'content' }];
  minutes.bindings = [{ fieldId: minutesField.id, targetProperty: 'content' }];
  return finish(
    composition,
    ctx,
    'clock',
    name,
    { panel, hours, separator, minutes },
    { hours: hoursField, minutes: minutesField },
  );
}
