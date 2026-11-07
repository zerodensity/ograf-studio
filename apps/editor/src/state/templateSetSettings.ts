import {
  getResolvedLayerAnimationTracks,
  resizeConstrainedTransform,
  normalizeCanvasCrop,
  hasElementMediaPaint,
  isMediaPaint,
  type Project,
  type CompositionLayout,
} from '@ograf-editor/scene-model';

export const TEMPLATE_SET_LAYOUT_KEYS = [
  'showRulers',
  'showActionSafe',
  'showTitleSafe',
  'showCenterMarker',
  'dimOutsideCanvas',
  'snappingEnabled',
  'snapToGrid',
  'snapToGuides',
  'snapToLayers',
  'gridSize',
  'snapThreshold',
  'boundsMode',
  'overflowPreview',
] as const;

export interface TemplateSetSettings {
  width: number;
  height: number;
  frameRate: number;
  backgroundColor: string;
  supportsRealTime: boolean;
  supportsNonRealTime: boolean;
  updateTransitionFrames: number;
  updateInterruption: 'queue' | 'replace';
  layout: Pick<CompositionLayout, (typeof TEMPLATE_SET_LAYOUT_KEYS)[number]>;
}

const TEMPLATE_SET_PROPERTY_KEYS = [
  'width',
  'height',
  'frameRate',
  'backgroundColor',
  'supportsRealTime',
  'supportsNonRealTime',
  'updateTransitionFrames',
  'updateInterruption',
] as const;

export type TemplateSetSettingKey =
  | Exclude<keyof TemplateSetSettings, 'layout'>
  | `layout.${(typeof TEMPLATE_SET_LAYOUT_KEYS)[number]}`;

export const TEMPLATE_SET_SETTING_KEYS: readonly TemplateSetSettingKey[] = [
  ...TEMPLATE_SET_PROPERTY_KEYS,
  ...TEMPLATE_SET_LAYOUT_KEYS.map((key) => `layout.${key}` as const),
];

export function templateSetSettingsFromProject(project: Project): TemplateSetSettings {
  const composition = project.compositions.find((item) => item.id === project.mainCompositionId)!;
  return {
    width: composition.width,
    height: composition.height,
    frameRate: composition.frameRate,
    backgroundColor: composition.backgroundColor,
    supportsRealTime: project.supportsRealTime,
    supportsNonRealTime: project.supportsNonRealTime,
    updateTransitionFrames: composition.updateTransitionFrames,
    updateInterruption: composition.updateInterruption ?? 'queue',
    layout: Object.fromEntries(
      TEMPLATE_SET_LAYOUT_KEYS.map((key) => [key, composition.layout[key]]),
    ) as TemplateSetSettings['layout'],
  };
}

/** An explicit override keeps the canonical child value, even when it equals the set default. */
export function effectiveTemplateSetSettings(
  project: Project,
  defaults: TemplateSetSettings | undefined,
  overrideKeys: readonly TemplateSetSettingKey[] = [],
): TemplateSetSettings {
  const local = templateSetSettingsFromProject(project);
  if (!defaults) return local;
  const overrides = new Set(overrideKeys);
  return {
    ...Object.fromEntries(
      TEMPLATE_SET_PROPERTY_KEYS.map((key) => [
        key,
        overrides.has(key) ? local[key] : defaults[key],
      ]),
    ),
    layout: Object.fromEntries(
      TEMPLATE_SET_LAYOUT_KEYS.map((key) => [
        key,
        overrides.has(`layout.${key}`) ? local.layout[key] : defaults.layout[key],
      ]),
    ),
  } as TemplateSetSettings;
}

/** Detect authored changes without treating subcomposition or editor-only layout edits as overrides. */
export function changedTemplateSetSettingKeys(
  beforeProject: Project,
  afterProject: Project,
): TemplateSetSettingKey[] {
  const before = templateSetSettingsFromProject(beforeProject);
  const after = templateSetSettingsFromProject(afterProject);
  return [
    ...TEMPLATE_SET_PROPERTY_KEYS.filter((key) => !Object.is(before[key], after[key])),
    ...TEMPLATE_SET_LAYOUT_KEYS.filter(
      (key) => !Object.is(before.layout[key], after.layout[key]),
    ).map((key) => `layout.${key}` as const),
  ];
}

export function templateSetSettingsErrors(settings: TemplateSetSettings): string[] {
  const errors: string[] = [];
  if (!settings || typeof settings !== 'object') return ['Template-set settings are invalid.'];
  if (
    ![settings.width, settings.height].every(
      (value) => Number.isInteger(value) && value > 0 && value <= 32768,
    )
  )
    errors.push('Canvas dimensions must be whole pixels between 1 and 32768.');
  if (!Number.isFinite(settings.frameRate) || settings.frameRate <= 0 || settings.frameRate > 240)
    errors.push('Frame rate must be greater than 0 and no more than 240.');
  const validColor =
    typeof settings.backgroundColor === 'string' &&
    (typeof CSS !== 'undefined'
      ? CSS.supports('color', settings.backgroundColor)
      : /^(?:#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8}|[a-z]+|(?:rgba?|hsla?|color|lab|lch|oklab|oklch)\([^;{}<>]*\))$/i.test(
          settings.backgroundColor,
        ));
  if (settings.backgroundColor !== 'transparent' && !validColor)
    errors.push('Choose a valid background color or transparency.');
  if (
    typeof settings.supportsRealTime !== 'boolean' ||
    typeof settings.supportsNonRealTime !== 'boolean' ||
    (!settings.supportsRealTime && !settings.supportsNonRealTime)
  )
    errors.push('Select at least one render mode.');
  if (!Number.isInteger(settings.updateTransitionFrames) || settings.updateTransitionFrames < 0)
    errors.push('Data-transition duration must be a non-negative whole number of frames.');
  if (!['queue', 'replace'].includes(settings.updateInterruption))
    errors.push('Choose a data-transition interruption mode.');
  if (!settings.layout || typeof settings.layout !== 'object')
    errors.push('Canvas preferences are missing.');
  else {
    for (const key of TEMPLATE_SET_LAYOUT_KEYS.slice(0, 9))
      if (typeof settings.layout[key] !== 'boolean')
        errors.push(`Canvas preference ${key} must be on or off.`);
    if (!Number.isInteger(settings.layout.gridSize) || settings.layout.gridSize < 1)
      errors.push('Grid size must be a positive whole number of pixels.');
    if (!Number.isInteger(settings.layout.snapThreshold) || settings.layout.snapThreshold < 0)
      errors.push('Snap distance must be a non-negative whole number of pixels.');
    if (!['allow', 'contain'].includes(settings.layout.boundsMode))
      errors.push('Choose a canvas bounds mode.');
    if (!['visible', 'clip'].includes(settings.layout.overflowPreview))
      errors.push('Choose an overflow preview mode.');
  }
  return errors;
}

/** Bakes inherited canvas geometry once while keeping property timing, easing and key identities. */
export function applyTemplateSetSettings(project: Project, settings: TemplateSetSettings): Project {
  const errors = templateSetSettingsErrors(settings);
  if (errors.length) throw new Error(errors.join(' '));
  const requiresRealTime = project.compositions.some(
    (composition) =>
      isMediaPaint(composition.backgroundPaint) ||
      composition.mediaCues.length > 0 ||
      composition.layers.some(
        (layer) => layer.element.type === 'audio' || hasElementMediaPaint(layer.element),
      ),
  );
  const next = structuredClone(project);
  const composition = next.compositions.find((item) => item.id === next.mainCompositionId)!;
  const oldSize = { width: composition.width, height: composition.height };
  const newSize = { width: settings.width, height: settings.height };
  if (oldSize.width !== newSize.width || oldSize.height !== newSize.height) {
    for (const layer of composition.layers) {
      const originalTracks = getResolvedLayerAnimationTracks(layer);
      const fallback = layer.keyframes[0]?.transform;
      if (!fallback) continue;
      layer.animationTracks = structuredClone(originalTracks);
      for (const property of ['x', 'y', 'width', 'height'] as const)
        layer.animationTracks[property] = (originalTracks[property] ?? []).map((key) => ({
          ...key,
          value: resizeConstrainedTransform(
            { ...fallback, [property]: key.value },
            layer.constraints,
            oldSize,
            newSize,
          )[property],
        }));
      layer.keyframes = layer.keyframes.map((key) => ({
        ...key,
        transform: resizeConstrainedTransform(key.transform, layer.constraints, oldSize, newSize),
      }));
    }
  }
  Object.assign(composition, {
    width: settings.width,
    height: settings.height,
    frameRate: settings.frameRate,
    backgroundColor: settings.backgroundColor,
    updateTransitionFrames: settings.updateTransitionFrames,
    updateInterruption: settings.updateInterruption,
  });
  Object.assign(composition.layout, settings.layout);
  if (composition.crop)
    composition.crop = normalizeCanvasCrop(composition.crop, settings.width, settings.height);
  next.supportsRealTime = requiresRealTime || settings.supportsRealTime;
  next.supportsNonRealTime = !requiresRealTime && settings.supportsNonRealTime;
  return next;
}
