import {
  createFieldDefinition,
  createTextElement,
  createTickerElement,
  createImageElement,
  createAsset,
} from './factory';
import { finishRecipeMaterials, finishRecipeComponent } from './recipeFinishing';
import { STYLE_TOKEN_KEYS } from './stylePacks';
import {
  context,
  fieldKeyAllocator,
  finish as finishBase,
  pose,
  recipeLayer,
  requireStep,
  staticRecipeLayer,
  uniqueFieldKey,
  type BugRecipeOptions,
  type TickerRecipeOptions,
  type ScoreboardRecipeOptions,
  type MaterializedBroadcastRecipe,
  type BroadcastRecipeName,
  type RecipeContext,
} from './broadcastRecipeShared';
import type { Composition, Layer } from './types';
export type {
  BroadcastRecipeName,
  BroadcastRecipeMotionOptions,
  BugRecipeOptions,
  TickerRecipeOptions,
  ScoreboardRecipeOptions,
  ClockRecipeOptions,
  MaterializedBroadcastRecipe,
} from './broadcastRecipeShared';
export { materializeClock, materializeCountdown } from './clockRecipes';

function finish(
  composition: Composition,
  ctx: RecipeContext,
  recipe: BroadcastRecipeName,
  name: string,
  layers: Record<string, Layer>,
  fields: Record<string, ReturnType<typeof createFieldDefinition>>,
  asComponent = true,
): MaterializedBroadcastRecipe {
  const result = finishBase(composition, ctx, recipe, name, layers, fields);
  finishRecipeMaterials(
    composition,
    layers,
    undefined,
    ctx.motion.style !== 'none' && ctx.motion.entrance !== 'none',
  );
  // Compact recipes align text inside fixed label/score boxes. Max Text Width instead
  // sizes the wrapper to its glyphs, removing the space center/right/middle alignment needs.
  // Their authored shrink-to-fit keeps those boxes intact as external values change.
  return {
    ...result,
    ...finishRecipeComponent(
      composition,
      Object.values(layers).map((layer) => layer.id),
      name,
      asComponent,
    ),
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
    pose(x + accentWidth + 18, y + 10, width - accentWidth - 36, height - 20),
  );
  if (label.element.type === 'text') {
    label.element.content = options.content?.label ?? 'LIVE';
    label.element.autoFit = 'shrink-to-fit';
    label.element.overflowPolicy = 'clip';
    label.element.textAlign = 'center';
    label.element.verticalAlign = 'middle';
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
  return finish(
    composition,
    ctx,
    'bug',
    name,
    { panel, accent, label },
    { label: labelField },
    options.asComponent !== false,
  );
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
  const scale = composition.height / 1080;
  const width = Math.max(640, Math.round(options.placement?.width ?? composition.width * 0.9));
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
    'container',
    ['window', 'clip'],
    pose(x, y, width, height),
    ctx.motion,
    0,
    4,
    true,
  );
  window.clipChildren = true;
  const labelWidth = Math.max(110, Math.round(width * 0.115));
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
    pose(x + 14 * scale, y + 8 * scale, labelWidth - 28 * scale, height - 16 * scale),
  );
  if (label.element.type === 'text') {
    label.element.content = options.content?.label ?? 'NEWS';
    label.element.autoFit = 'shrink-to-fit';
    label.element.overflowPolicy = 'clip';
    label.element.textAlign = 'center';
    label.element.verticalAlign = 'middle';
  }
  const crawlWidth = Math.max(1, width - labelWidth - 28 * scale);
  const crawl = staticRecipeLayer(
    composition,
    'ticker',
    `${name} · Native ticker`,
    ctx.groupId,
    'ticker',
    'ticker',
    ['editable', 'native-ticker', 'qa:allow-loop-seam'],
    pose(x + labelWidth + 14 * scale, y + 8 * scale, crawlWidth, height - 16 * scale),
  );
  const content =
    options.content?.text ??
    'BREAKING NEWS  •  World leaders meet for global summit  •  Markets open higher as technology advances';
  const fontSize = Math.max(20, Math.round(height * 0.43));
  const fontFamily = ctx.color(STYLE_TOKEN_KEYS.fontFamily, 'Arial');
  const condensed = /^['"]?Roboto Condensed['"]?(?:,|$)/i.test(fontFamily.trim());
  const letterSpacing = condensed ? 0.2 : 0;
  const text = createTextElement({
    content,
    fontFamily,
    fontSize,
    fontWeight: 600,
    lineHeight: condensed ? 1.05 : 1.2,
    letterSpacing,
    color: ctx.color(STYLE_TOKEN_KEYS.primaryText, '#ffffff'),
    fill: ctx.color(STYLE_TOKEN_KEYS.primaryText, '#ffffff'),
    autoFit: 'shrink-to-fit',
    minFontSize: Math.round(fontSize * 0.65),
    verticalAlign: 'middle',
    overflowPolicy: 'clip',
  });
  const mark = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M16 3 29 16 16 29 3 16Z" fill="${ctx.color(STYLE_TOKEN_KEYS.accent, '#31b7d4')}"/><path d="M16 10 22 16 16 22 10 16Z" fill="white" opacity=".7"/></svg>`;
  const separatorAsset = options.items
    ? undefined
    : createAsset({
        name: `${name} separator`,
        kind: 'image',
        mimeType: 'image/svg+xml',
        dataUri: `data:image/svg+xml,${encodeURIComponent(mark)}`,
        originalFileName: 'ticker-separator.svg',
        byteSize: new TextEncoder().encode(mark).length,
      });
  if (separatorAsset) composition.assets.push(separatorAsset);
  crawl.element = createTickerElement({
    items: options.items
      ? structuredClone(options.items)
      : [
          {
            id: 'headline',
            name: 'Headline',
            width: Math.max(
              crawlWidth,
              Math.ceil(
                [...content].length * (fontSize * (condensed ? 0.55 : 0.65) + letterSpacing),
              ),
            ),
            element: text,
          },
          {
            id: 'separator',
            name: 'Station separator',
            width: Math.max(24, fontSize),
            height: Math.max(24, fontSize),
            element: createImageElement({ src: `asset:${separatorAsset!.id}` }),
          },
        ],
    speedPixelsPerSecond: Math.min(2000, Math.max(0, options.speedPixelsPerSecond ?? 150 * scale)),
    direction: options.direction ?? 'left',
    textDirection: options.textDirection ?? 'auto',
    updatePolicy: options.updatePolicy ?? 'next-appearance',
    gap: options.gap ?? 48 * scale,
    entryFade: options.entryFade ?? 40 * scale,
    exitFade: options.exitFade ?? 40 * scale,
    fadeSoftness: options.fadeSoftness ?? 0.8,
  });
  for (const child of [labelPlate, label, crawl]) child.parentId = window.id;
  const nextKey = fieldKeyAllocator(composition);
  const labelField = createFieldDefinition('text', {
    key: nextKey(options.fieldKeys?.label ?? 'ticker_label', 'ticker_label'),
    label: `${name} Label`,
    description: 'Short category label preceding the native ticker.',
    defaultValue: label.element.type === 'text' ? label.element.content : 'NEWS',
    constraints: { maxLength: 16 },
  });
  label.bindings = [{ fieldId: labelField.id, targetProperty: 'content' }];
  const fields: Record<string, ReturnType<typeof createFieldDefinition>> = { label: labelField };
  if (options.items !== undefined || options.fieldKeys?.feed !== undefined) {
    const feed = createFieldDefinition('array', {
      key: nextKey(options.fieldKeys?.feed ?? 'ticker_feed', 'ticker_feed'),
      label: `${name} Feed`,
      description: 'Complete native ticker items. Preserve stable item IDs when editing a feed.',
      defaultValue: crawl.element.items as unknown as import('./types').FieldValue,
      constraints: { minItems: 0, maxItems: 128 },
    });
    fields.feed = feed;
    crawl.bindings = [{ fieldId: feed.id, targetProperty: 'items' }];
  } else {
    const textField = createFieldDefinition('textarea', {
      key: nextKey(options.fieldKeys?.text ?? 'ticker_text', 'ticker_text'),
      label: `${name} Text`,
      description:
        'Headline content. Native next-appearance updates preserve the current visible pass.',
      defaultValue: content,
      constraints: { maxLength: 240 },
    });
    fields.text = textField;
    crawl.bindings = [{ fieldId: textField.id, targetProperty: 'items.headline.content' }];
  }
  return finish(
    composition,
    ctx,
    'ticker',
    name,
    { window, labelPlate, label, crawl },
    fields,
    options.asComponent !== false,
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
  const x = Math.round(options.placement?.x ?? composition.width * 0.05);
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
    options.asComponent !== false,
  );
}
