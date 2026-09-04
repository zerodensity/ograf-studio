import { applyDesignTokenBinding, syncDesignTokenFieldDefaults } from './designSystem';
import { planStylePackPalette, applyStylePackPalette } from './stylePackPalette';
import {
  createStylePackRestore,
  rememberPackProperty,
  restorePackAppearance,
} from './stylePackRestore';
import type {
  Composition,
  DesignToken,
  DesignTokenBinding,
  DesignTokenTargetProperty,
  DesignTokenType,
  DesignTokenValue,
  EasingPreset,
  Layer,
} from './types';

export const STYLE_PACK_IDS = ['news', 'sports', 'entertainment', 'documentary'] as const;
export type StylePackId = (typeof STYLE_PACK_IDS)[number];

export const STYLE_TOKEN_KEYS = {
  packId: 'brand.pack.id',
  background: 'brand.color.background',
  surface: 'brand.color.surface',
  accent: 'brand.color.accent',
  primaryText: 'brand.color.text.primary',
  secondaryText: 'brand.color.text.secondary',
  outline: 'brand.color.text.outline',
  fontFamily: 'brand.font.family',
  displaySize: 'brand.type.display',
  headlineSize: 'brand.type.headline',
  subheadlineSize: 'brand.type.subheadline',
  labelSize: 'brand.type.label',
  valueSize: 'brand.type.value',
  displayWeight: 'brand.weight.display',
  headlineWeight: 'brand.weight.headline',
  bodyWeight: 'brand.weight.body',
  radius: 'brand.shape.radius',
  strokeWidth: 'brand.text.strokeWidth',
  entranceFrames: 'motion.entrance.frames',
  exitFrames: 'motion.exit.frames',
  updateFrames: 'motion.update.frames',
  staggerFrames: 'motion.stagger.frames',
  entranceEasing: 'motion.entrance.easing',
  exitEasing: 'motion.exit.easing',
} as const;

export type StyleTokenKey = (typeof STYLE_TOKEN_KEYS)[keyof typeof STYLE_TOKEN_KEYS];

export interface StylePackTokenDefinition {
  key: StyleTokenKey;
  name: string;
  type: DesignTokenType;
  value: DesignTokenValue;
  description: string;
  scaleWithComposition?: boolean;
}

export interface StylePackMotionConvention {
  entranceFrames: number;
  exitFrames: number;
  updateFrames: number;
  staggerFrames: number;
  entranceEasing: EasingPreset;
  exitEasing: EasingPreset;
}

export interface StylePackDefinition {
  id: StylePackId;
  name: string;
  description: string;
  tokens: readonly StylePackTokenDefinition[];
  motion: Readonly<StylePackMotionConvention>;
}

interface StylePackPalette {
  background: string;
  surface: string;
  accent: string;
  primaryText: string;
  secondaryText: string;
  outline: string;
}

interface StylePackTypography {
  fontFamily: string;
  displaySize: number;
  headlineSize: number;
  subheadlineSize: number;
  labelSize: number;
  valueSize: number;
  displayWeight: number;
  headlineWeight: number;
  bodyWeight: number;
  radius: number;
  strokeWidth: number;
}

function definition(
  id: StylePackId,
  name: string,
  description: string,
  palette: StylePackPalette,
  typography: StylePackTypography,
  motion: StylePackMotionConvention,
): StylePackDefinition {
  const token = (
    key: StyleTokenKey,
    tokenName: string,
    type: DesignTokenType,
    value: DesignTokenValue,
    tokenDescription: string,
    scaleWithComposition = false,
  ): StylePackTokenDefinition =>
    Object.freeze({
      key,
      name: tokenName,
      type,
      value,
      description: tokenDescription,
      ...(scaleWithComposition ? { scaleWithComposition: true } : {}),
    });
  const tokens = [
    token(STYLE_TOKEN_KEYS.packId, 'Style pack', 'text', id, 'Applied broadcast style-pack ID.'),
    token(
      STYLE_TOKEN_KEYS.background,
      'Background',
      'color',
      palette.background,
      'Deep background.',
    ),
    token(
      STYLE_TOKEN_KEYS.surface,
      'Surface',
      'color',
      palette.surface,
      'Primary graphic surface.',
    ),
    token(STYLE_TOKEN_KEYS.accent, 'Accent', 'color', palette.accent, 'Editorial accent colour.'),
    token(
      STYLE_TOKEN_KEYS.primaryText,
      'Primary text',
      'color',
      palette.primaryText,
      'Primary on-air text.',
    ),
    token(
      STYLE_TOKEN_KEYS.secondaryText,
      'Secondary text',
      'color',
      palette.secondaryText,
      'Secondary on-air text.',
    ),
    token(
      STYLE_TOKEN_KEYS.outline,
      'Text outline',
      'color',
      palette.outline,
      'Outline behind score/value glyphs.',
    ),
    token(
      STYLE_TOKEN_KEYS.fontFamily,
      'Font family',
      'font-family',
      typography.fontFamily,
      'Portable font-family stack.',
    ),
    token(
      STYLE_TOKEN_KEYS.displaySize,
      'Display size',
      'number',
      typography.displaySize,
      'Display type size at 1080 lines.',
      true,
    ),
    token(
      STYLE_TOKEN_KEYS.headlineSize,
      'Headline size',
      'number',
      typography.headlineSize,
      'Headline type size at 1080 lines.',
      true,
    ),
    token(
      STYLE_TOKEN_KEYS.subheadlineSize,
      'Subheadline size',
      'number',
      typography.subheadlineSize,
      'Subheadline type size at 1080 lines.',
      true,
    ),
    token(
      STYLE_TOKEN_KEYS.labelSize,
      'Label size',
      'number',
      typography.labelSize,
      'Label type size at 1080 lines.',
      true,
    ),
    token(
      STYLE_TOKEN_KEYS.valueSize,
      'Value size',
      'number',
      typography.valueSize,
      'Score/value type size at 1080 lines.',
      true,
    ),
    token(
      STYLE_TOKEN_KEYS.displayWeight,
      'Display weight',
      'font-weight',
      typography.displayWeight,
      'Display/value font weight.',
    ),
    token(
      STYLE_TOKEN_KEYS.headlineWeight,
      'Headline weight',
      'font-weight',
      typography.headlineWeight,
      'Headline font weight.',
    ),
    token(
      STYLE_TOKEN_KEYS.bodyWeight,
      'Body weight',
      'font-weight',
      typography.bodyWeight,
      'Secondary/label font weight.',
    ),
    token(
      STYLE_TOKEN_KEYS.radius,
      'Corner radius',
      'number',
      typography.radius,
      'Panel radius at 1080 lines.',
      true,
    ),
    token(
      STYLE_TOKEN_KEYS.strokeWidth,
      'Text stroke width',
      'number',
      typography.strokeWidth,
      'Score/value outline width at 1080 lines.',
      true,
    ),
    token(
      STYLE_TOKEN_KEYS.entranceFrames,
      'Entrance frames',
      'number',
      motion.entranceFrames,
      'Recommended entrance duration.',
    ),
    token(
      STYLE_TOKEN_KEYS.exitFrames,
      'Exit frames',
      'number',
      motion.exitFrames,
      'Recommended exit duration.',
    ),
    token(
      STYLE_TOKEN_KEYS.updateFrames,
      'Update frames',
      'number',
      motion.updateFrames,
      'Recommended data-update crossfade.',
    ),
    token(
      STYLE_TOKEN_KEYS.staggerFrames,
      'Stagger frames',
      'number',
      motion.staggerFrames,
      'Recommended layer stagger.',
    ),
    token(
      STYLE_TOKEN_KEYS.entranceEasing,
      'Entrance easing',
      'text',
      motion.entranceEasing,
      'Recommended incoming easing.',
    ),
    token(
      STYLE_TOKEN_KEYS.exitEasing,
      'Exit easing',
      'text',
      motion.exitEasing,
      'Recommended outgoing easing.',
    ),
  ];
  return /* @__PURE__ */ Object.freeze({
    id,
    name,
    description,
    tokens: Object.freeze(tokens),
    motion: Object.freeze({ ...motion }),
  });
}

export const STYLE_PACKS: readonly StylePackDefinition[] = /* @__PURE__ */ Object.freeze([
  /* @__PURE__ */ definition(
    'news',
    'News',
    'Authoritative navy/red editorial system with compact, rapid motion.',
    {
      background: '#081A33',
      surface: '#123A63',
      accent: '#E11D2E',
      primaryText: '#FFFFFF',
      secondaryText: '#C7D5EA',
      outline: '#020617',
    },
    {
      fontFamily: 'Arial, Helvetica, sans-serif',
      displaySize: 96,
      headlineSize: 64,
      subheadlineSize: 38,
      labelSize: 26,
      valueSize: 72,
      displayWeight: 800,
      headlineWeight: 700,
      bodyWeight: 500,
      radius: 10,
      strokeWidth: 3,
    },
    {
      entranceFrames: 10,
      exitFrames: 8,
      updateFrames: 6,
      staggerFrames: 2,
      entranceEasing: 'cubic-out',
      exitEasing: 'cubic-in',
    },
  ),
  /* @__PURE__ */ definition(
    'sports',
    'Sports',
    'High-contrast charcoal/cyan system with condensed, emphatic values.',
    {
      background: '#071014',
      surface: '#13232A',
      accent: '#00E5FF',
      primaryText: '#FFFFFF',
      secondaryText: '#B8C7CC',
      outline: '#000000',
    },
    {
      fontFamily: 'Arial Narrow, Arial, sans-serif',
      displaySize: 112,
      headlineSize: 68,
      subheadlineSize: 40,
      labelSize: 26,
      valueSize: 88,
      displayWeight: 900,
      headlineWeight: 800,
      bodyWeight: 600,
      radius: 6,
      strokeWidth: 4,
    },
    {
      entranceFrames: 8,
      exitFrames: 6,
      updateFrames: 5,
      staggerFrames: 2,
      entranceEasing: 'expo-out',
      exitEasing: 'cubic-in',
    },
  ),
  /* @__PURE__ */ definition(
    'entertainment',
    'Entertainment',
    'Violet/magenta system with expressive scale and softer timing.',
    {
      background: '#160B2B',
      surface: '#351B59',
      accent: '#FF3CAC',
      primaryText: '#FFFFFF',
      secondaryText: '#E7D9FF',
      outline: '#120018',
    },
    {
      fontFamily: 'Trebuchet MS, Arial, sans-serif',
      displaySize: 104,
      headlineSize: 66,
      subheadlineSize: 40,
      labelSize: 28,
      valueSize: 78,
      displayWeight: 800,
      headlineWeight: 700,
      bodyWeight: 500,
      radius: 18,
      strokeWidth: 3,
    },
    {
      entranceFrames: 12,
      exitFrames: 10,
      updateFrames: 8,
      staggerFrames: 3,
      entranceEasing: 'back-out',
      exitEasing: 'quart-in',
    },
  ),
  /* @__PURE__ */ definition(
    'documentary',
    'Documentary',
    'Warm charcoal/ivory system with restrained serif typography and deliberate motion.',
    {
      background: '#171714',
      surface: '#302F28',
      accent: '#D6A85F',
      primaryText: '#F4F0E6',
      secondaryText: '#C9C1B2',
      outline: '#11110F',
    },
    {
      fontFamily: 'Georgia, Times New Roman, serif',
      displaySize: 92,
      headlineSize: 58,
      subheadlineSize: 36,
      labelSize: 24,
      valueSize: 70,
      displayWeight: 700,
      headlineWeight: 700,
      bodyWeight: 400,
      radius: 4,
      strokeWidth: 2,
    },
    {
      entranceFrames: 12,
      exitFrames: 12,
      updateFrames: 10,
      staggerFrames: 4,
      entranceEasing: 'sine-out',
      exitEasing: 'sine-in',
    },
  ),
]);

export interface AppliedStylePack {
  packId: StylePackId;
  name: string;
  tokenIds: Record<StyleTokenKey, string>;
  createdTokenIds: string[];
  affectedLayerIds: string[];
}

export interface ApplyStylePackOptions {
  bindLayerIds?: string[];
  refreshTokens?: boolean;
  tokenIds?: Partial<Record<StyleTokenKey, string>>;
}

export function getStylePack(id: StylePackId): StylePackDefinition {
  return STYLE_PACKS.find((pack) => pack.id === id)!;
}

export function stylePackIdForComposition(composition: Composition): StylePackId | null {
  const value = composition.designSystem.tokens.find(
    (token) => token.key === STYLE_TOKEN_KEYS.packId,
  )?.value;
  return STYLE_PACK_IDS.includes(value as StylePackId) ? (value as StylePackId) : null;
}

/** Restore recorded pre-pack styles; older sources without a baseline can only detach the pack. */
export function removeStylePack(composition: Composition): {
  packId: StylePackId;
  removedTokenIds: string[];
  affectedLayerIds: string[];
  restored: boolean;
} | null {
  const packId = stylePackIdForComposition(composition);
  if (!packId) return null;
  const pack = getStylePack(packId);
  const keys = new Set<string>(pack.tokens.map((token) => token.key));
  const removedTokenIds = composition.designSystem.tokens
    .filter((token) => keys.has(token.key))
    .map((token) => token.id);
  const removed = new Set(removedTokenIds);
  const affectedLayerIds: string[] = [];
  const restore = composition.designSystem.stylePackRestore;
  delete composition.designSystem.stylePackColors;
  for (const layer of [
    ...composition.layers,
    ...composition.components.flatMap((component) => component.layers),
  ]) {
    const before = layer.designTokenBindings.length;
    layer.designTokenBindings = layer.designTokenBindings.filter(
      (binding) => !removed.has(binding.tokenId),
    );
    if (before !== layer.designTokenBindings.length) affectedLayerIds.push(layer.id);
  }
  composition.designSystem.tokens = composition.designSystem.tokens.filter(
    (token) => !removed.has(token.id),
  );
  if (composition.designSystem.name === `${pack.name} Brand Kit`)
    composition.designSystem.name = restore?.name ?? 'Brand Kit';
  affectedLayerIds.push(
    ...restorePackAppearance(
      composition,
      new Set([...removed, ...(restore?.tokens.map((t) => t.token.id) ?? [])]),
    ),
  );
  const remainingTokens = new Set(composition.designSystem.tokens.map((token) => token.id));
  for (const field of [
    ...composition.dataFields,
    ...composition.components.flatMap((component) => component.dataFields),
  ])
    if (
      field.defaultTokenId &&
      removed.has(field.defaultTokenId) &&
      !remainingTokens.has(field.defaultTokenId)
    )
      delete field.defaultTokenId;
  return {
    packId,
    removedTokenIds,
    affectedLayerIds: [...new Set(affectedLayerIds)],
    restored: Boolean(restore),
  };
}

function scaledValue(
  composition: Composition,
  definition: StylePackTokenDefinition,
): DesignTokenValue {
  if (!definition.scaleWithComposition || typeof definition.value !== 'number') {
    return definition.value;
  }
  return Math.max(0, Math.round(definition.value * (composition.height / 1080)));
}

function defaultStyleTokenId(key: StyleTokenKey): string {
  return `design-token-style-${key.replace(/[^A-Za-z0-9_-]+/g, '-')}`;
}

export function styleTokenValue(
  composition: Composition,
  key: StyleTokenKey,
  fallback: DesignTokenValue,
): DesignTokenValue {
  return composition.designSystem.tokens.find((token) => token.key === key)?.value ?? fallback;
}

function tokenKeyForProperty(
  layer: Layer,
  property: DesignTokenTargetProperty,
): StyleTokenKey | null {
  if (property === 'fill') {
    if (layer.semantics.role === 'background') return STYLE_TOKEN_KEYS.background;
    if (layer.semantics.role === 'accent' || layer.semantics.role === 'icon') {
      return STYLE_TOKEN_KEYS.accent;
    }
    if (layer.semantics.role === 'container' || layer.semantics.role === 'mask') {
      return STYLE_TOKEN_KEYS.surface;
    }
    return null;
  }
  if (property === 'borderRadius') return STYLE_TOKEN_KEYS.radius;
  if (property === 'color') {
    return ['subheadline', 'label', 'ticker'].includes(layer.semantics.role)
      ? STYLE_TOKEN_KEYS.secondaryText
      : STYLE_TOKEN_KEYS.primaryText;
  }
  if (property === 'fontFamily') return STYLE_TOKEN_KEYS.fontFamily;
  if (property === 'fontSize') {
    if (layer.semantics.role === 'headline') return STYLE_TOKEN_KEYS.headlineSize;
    if (layer.semantics.role === 'subheadline') return STYLE_TOKEN_KEYS.subheadlineSize;
    if (layer.semantics.role === 'score' || layer.semantics.role === 'value') {
      return STYLE_TOKEN_KEYS.valueSize;
    }
    return STYLE_TOKEN_KEYS.labelSize;
  }
  if (property === 'fontWeight') {
    if (layer.semantics.role === 'score' || layer.semantics.role === 'value') {
      return STYLE_TOKEN_KEYS.displayWeight;
    }
    return layer.semantics.role === 'headline'
      ? STYLE_TOKEN_KEYS.headlineWeight
      : STYLE_TOKEN_KEYS.bodyWeight;
  }
  if (property === 'strokeColor') return STYLE_TOKEN_KEYS.outline;
  if (property === 'strokeWidth') return STYLE_TOKEN_KEYS.strokeWidth;
  return null;
}

function bind(
  composition: Composition,
  layer: Layer,
  tokenByKey: Map<string, DesignToken>,
  property: DesignTokenTargetProperty,
): boolean {
  const key = tokenKeyForProperty(layer, property);
  const token = key ? tokenByKey.get(key) : undefined;
  if (!token) return false;
  rememberPackProperty(composition, layer, property);
  const binding: DesignTokenBinding = { tokenId: token.id, targetProperty: property };
  layer.designTokenBindings = [
    ...layer.designTokenBindings.filter((candidate) => candidate.targetProperty !== property),
    binding,
  ];
  applyDesignTokenBinding(layer, binding, token);
  return true;
}

function materializeLayerStyle(
  composition: Composition,
  layer: Layer,
  tokenByKey: Map<string, DesignToken>,
): boolean {
  let affected = false;
  if (layer.isMaskOnly || layer.semantics.role === 'mask' || layer.lighting) return false;
  if ('fill' in layer.element && typeof layer.element.fill !== 'string') return false;
  if (layer.element.type === 'rectangle') {
    affected = bind(composition, layer, tokenByKey, 'fill') || affected;
    affected = bind(composition, layer, tokenByKey, 'borderRadius') || affected;
  } else if (
    layer.element.type === 'ellipse' ||
    layer.element.type === 'path' ||
    layer.element.type === 'pattern'
  ) {
    affected = bind(composition, layer, tokenByKey, 'fill') || affected;
  } else if (layer.element.type === 'text') {
    for (const property of ['color', 'fontFamily', 'fontSize', 'fontWeight'] as const) {
      affected = bind(composition, layer, tokenByKey, property) || affected;
    }
    if (
      layer.element.strokeWidth > 0 ||
      layer.semantics.role === 'score' ||
      layer.semantics.role === 'value'
    ) {
      affected = bind(composition, layer, tokenByKey, 'strokeColor') || affected;
      affected = bind(composition, layer, tokenByKey, 'strokeWidth') || affected;
    }
  }
  return affected;
}

export function applyStylePack(
  composition: Composition,
  packId: StylePackId,
  options: ApplyStylePackOptions = {},
): AppliedStylePack {
  const pack = getStylePack(packId);
  if (!composition.designSystem.stylePackRestore && !stylePackIdForComposition(composition)) {
    composition.designSystem.stylePackRestore = createStylePackRestore(
      composition,
      new Set(pack.tokens.map((token) => token.key)),
    );
  }
  const refreshTokens = options.refreshTokens ?? true;
  const allowed = options.bindLayerIds ? new Set(options.bindLayerIds) : undefined;
  const palette = planStylePackPalette(composition, allowed);
  const createdTokenIds: string[] = [];
  const tokenIds = {} as Record<StyleTokenKey, string>;
  for (const definition of pack.tokens) {
    let token = composition.designSystem.tokens.find(
      (candidate) => candidate.key === definition.key,
    );
    if (!token) {
      const requestedId = options.tokenIds?.[definition.key];
      const baseId = requestedId ?? defaultStyleTokenId(definition.key);
      let id = baseId;
      let suffix = 2;
      while (composition.designSystem.tokens.some((candidate) => candidate.id === id)) {
        id = `${baseId}-${suffix++}`;
      }
      token = {
        id,
        key: definition.key,
        name: definition.name,
        type: definition.type,
        value: scaledValue(composition, definition),
        description: definition.description,
      };
      composition.designSystem.tokens.push(token);
      createdTokenIds.push(token.id);
    } else if (refreshTokens) {
      token.name = definition.name;
      token.type = definition.type;
      token.value = scaledValue(composition, definition);
      token.description = definition.description;
    }
    tokenIds[definition.key] = token.id;
    syncDesignTokenFieldDefaults(composition, token.id);
  }
  composition.designSystem.name = `${pack.name} Brand Kit`;
  const tokenByKey = new Map(
    composition.designSystem.tokens.map((token) => [token.key, token] as const),
  );
  const packTokenById = new Map(
    [...tokenByKey.values()]
      .filter((token) => pack.tokens.some((definition) => definition.key === token.key))
      .map((token) => [token.id, token] as const),
  );
  const affected = new Set<string>();
  for (const layer of composition.layers) {
    for (const binding of layer.designTokenBindings) {
      const token = packTokenById.get(binding.tokenId);
      if (!token) continue;
      if (
        binding.targetProperty === 'fill' &&
        'fill' in layer.element &&
        typeof layer.element.fill !== 'string'
      )
        continue;
      rememberPackProperty(composition, layer, binding.targetProperty);
      applyDesignTokenBinding(layer, binding, token);
      affected.add(layer.id);
    }
  }
  for (const layer of composition.layers.filter((item) => !allowed || allowed.has(item.id))) {
    if (materializeLayerStyle(composition, layer, tokenByKey)) affected.add(layer.id);
  }
  for (const id of applyStylePackPalette(composition, palette, !allowed)) affected.add(id);
  const affectedLayerIds = [...affected];
  if (refreshTokens) {
    composition.updateTransitionFrames = resolveStylePackMotion(composition, packId).updateFrames;
  }
  return { packId, name: pack.name, tokenIds, createdTokenIds, affectedLayerIds };
}

const STYLE_PACK_EASINGS = new Set<EasingPreset>([
  'cubic-out',
  'cubic-in',
  'expo-out',
  'quart-in',
  'back-out',
  'sine-out',
  'sine-in',
]);

export function resolveStylePackMotion(
  composition: Composition,
  packId: StylePackId,
): StylePackMotionConvention {
  const pack = getStylePack(packId);
  const number = (key: StyleTokenKey, fallback: number) => {
    const value = Number(styleTokenValue(composition, key, fallback));
    return Number.isFinite(value) ? Math.max(0, Math.round(value)) : fallback;
  };
  const easing = (key: StyleTokenKey, fallback: EasingPreset) => {
    const value = styleTokenValue(composition, key, fallback);
    return STYLE_PACK_EASINGS.has(value as EasingPreset) ? (value as EasingPreset) : fallback;
  };
  return {
    entranceFrames: Math.max(
      2,
      number(STYLE_TOKEN_KEYS.entranceFrames, pack.motion.entranceFrames),
    ),
    exitFrames: Math.max(2, number(STYLE_TOKEN_KEYS.exitFrames, pack.motion.exitFrames)),
    updateFrames: number(STYLE_TOKEN_KEYS.updateFrames, pack.motion.updateFrames),
    staggerFrames: number(STYLE_TOKEN_KEYS.staggerFrames, pack.motion.staggerFrames),
    entranceEasing: easing(STYLE_TOKEN_KEYS.entranceEasing, pack.motion.entranceEasing),
    exitEasing: easing(STYLE_TOKEN_KEYS.exitEasing, pack.motion.exitEasing),
  };
}
