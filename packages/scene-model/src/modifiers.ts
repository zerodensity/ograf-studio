import { createId } from './id';
import { attachTransformToMotionPath } from './motionPath';
import type {
  AnimatableLayerProperty,
  Element,
  FieldDefinition,
  GeometryReference,
  Layer,
  LayerModifier,
  LayerModifierType,
  LayerTransform,
  ModifierParameterProperty,
  ModifierParamsByType,
} from './types';

export const MAX_LAYER_MODIFIERS = 16;
export const MODIFIER_TYPES: readonly LayerModifierType[] = [
  'max-text-width',
  'auto-size',
  'auto-follow',
  'hide-empty',
  'grid-arrange',
  'radial-arrange',
  'justify',
  'look-at',
];
/** Owner-level layout modifiers that position the owner's direct children, in stack order. */
export const CONTAINER_MODIFIER_TYPES: readonly LayerModifierType[] = [
  'grid-arrange',
  'radial-arrange',
  'justify',
];
export interface ModifierParameterSpec {
  label: string;
  default: number;
  min: number;
  max: number;
  step: number;
}
const dimension = (label: string, value = 0, min = 0): ModifierParameterSpec => ({
  label,
  default: value,
  min,
  max: 32768,
  step: 1,
});
const count = (label: string, value: number, min: number, max: number): ModifierParameterSpec => ({
  label,
  default: value,
  min,
  max,
  step: 1,
});
const signed = (label: string, value = 0, limit = 32768): ModifierParameterSpec => ({
  label,
  default: value,
  min: -limit,
  max: limit,
  step: 1,
});
const anchor = (label: string): ModifierParameterSpec => ({
  label,
  default: 0,
  min: 0,
  max: 1,
  step: 0.01,
});
export const MODIFIER_CATALOG: Record<
  LayerModifierType,
  {
    label: string;
    params: Record<string, ModifierParameterSpec>;
  }
> = {
  'max-text-width': {
    label: 'Max Text Width',
    params: {
      maxWidth: dimension('Maximum Width', 600, 1),
      minFontSize: dimension('Minimum Font Size', 1, 1),
    },
  },
  'auto-size': {
    label: 'Auto Size',
    params: {
      paddingTop: dimension('Padding Top'),
      paddingRight: dimension('Padding Right'),
      paddingBottom: dimension('Padding Bottom'),
      paddingLeft: dimension('Padding Left'),
      minWidth: dimension('Minimum Width'),
      maxWidth: dimension('Maximum Width'),
      minHeight: dimension('Minimum Height'),
      maxHeight: dimension('Maximum Height'),
      anchorX: anchor('Anchor X'),
      anchorY: anchor('Anchor Y'),
    },
  },
  'auto-follow': {
    label: 'Auto Follow',
    params: {
      sourceAnchorX: anchor('Source Anchor X'),
      sourceAnchorY: anchor('Source Anchor Y'),
      targetAnchorX: anchor('Target Anchor X'),
      targetAnchorY: anchor('Target Anchor Y'),
      offsetX: { ...dimension('Offset X'), min: -32768 },
      offsetY: { ...dimension('Offset Y'), min: -32768 },
    },
  },
  'hide-empty': { label: 'Hide on Empty', params: {} },
  'grid-arrange': {
    label: 'Grid Arrange',
    params: {
      columns: count('Columns', 3, 1, 256),
      rows: count('Rows', 0, 0, 256),
      spreadX: dimension('Spread X', 200),
      spreadY: dimension('Spread Y', 100),
    },
  },
  'radial-arrange': {
    label: 'Radial Arrange',
    params: {
      count: count('Count', 0, 0, 1024),
      rings: count('Rings', 1, 1, 64),
      innerRadius: dimension('Inner Radius', 200),
      outerRadius: dimension('Outer Radius', 400),
      startAngle: signed('Start Angle', 0, 720),
      endAngle: signed('End Angle', 360, 720),
      baseRotation: signed('Base Rotation', 0, 360),
    },
  },
  justify: {
    label: 'Justify',
    params: { offsetX: signed('Offset X'), offsetY: signed('Offset Y') },
  },
  'look-at': {
    label: 'Look At',
    params: { rotationOffset: signed('Rotation Offset', 0, 360) },
  },
};
export const isContainerModifier = (modifier: Pick<LayerModifier, 'type'>): boolean =>
  CONTAINER_MODIFIER_TYPES.includes(modifier.type);

export interface LayerModifierPatch {
  name?: string;
  enabled?: boolean;
  params?: Record<string, unknown>;
}
type ModifierHost = Pick<Layer, 'modifiers'>;
function cloneModifierValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map(cloneModifierValue) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneModifierValue(child)]),
    ) as T;
  return value;
}
export type ModifierLayerNode = Pick<Layer, 'id' | 'element'> &
  Partial<
    Pick<
      Layer,
      'name' | 'groupId' | 'modifiers' | 'autoLayout' | 'parentId' | 'motionPath' | 'isGuide'
    >
  >;
export interface ModifierVisualState {
  transform: LayerTransform;
  element: Element;
  isVisible: boolean;
  /** Sampled outer CSS uniform scale, including rule/reveal scale; absent retains 1. */
  scale?: number;
}
export interface ModifierTextFit {
  scaleX: number;
  scaleY: number;
  fontSize: number;
}
export interface ModifierEvaluationInput {
  layers: readonly ModifierLayerNode[];
  states: ReadonlyMap<string, ModifierVisualState>;
  dataByFieldId?: Readonly<Record<string, unknown>>;
  measureText?: (
    layerId: string,
    element: Element,
    transform: LayerTransform,
  ) => { width: number; height: number } | null;
}
export function getLayerModifiers(layer: ModifierHost): LayerModifier[] {
  return layer.modifiers ?? [];
}
export function modifierProperty(
  modifier: Pick<LayerModifier, 'id'> | string,
  param: string,
): ModifierParameterProperty {
  return `modifiers.${typeof modifier === 'string' ? modifier : modifier.id}.${param}`;
}
export function parseModifierProperty(property: string): { id: string; param: string } | null {
  const match = /^modifiers\.([a-zA-Z0-9_-]{1,100})\.([a-zA-Z][a-zA-Z0-9]*)$/.exec(property);
  return match ? { id: match[1]!, param: match[2]! } : null;
}
function entriesOf(layer: ModifierHost | readonly LayerModifier[]): readonly LayerModifier[] {
  return Array.isArray(layer) ? layer : ((layer as ModifierHost).modifiers ?? []);
}
export function modifierParameterSpec(
  layer: ModifierHost | readonly LayerModifier[],
  property: string,
): ModifierParameterSpec | undefined {
  const path = parseModifierProperty(property);
  const modifier = path && entriesOf(layer).find((entry) => entry.id === path.id);
  return modifier ? MODIFIER_CATALOG[modifier.type]?.params[path!.param] : undefined;
}
export function modifierParameterValue(
  layer: ModifierHost | readonly LayerModifier[],
  property: string,
): number | undefined {
  const path = parseModifierProperty(property);
  const modifier = path && entriesOf(layer).find((entry) => entry.id === path.id);
  const value = modifier && (modifier.params as unknown as Record<string, unknown>)[path!.param];
  return typeof value === 'number' ? value : undefined;
}
export function numericModifierProperties(layer: ModifierHost): ModifierParameterProperty[] {
  return getLayerModifiers(layer).flatMap((entry) =>
    Object.keys(MODIFIER_CATALOG[entry.type]?.params ?? {}).map((key) =>
      modifierProperty(entry, key),
    ),
  );
}
export function withModifierParameter<T extends ModifierHost>(
  layer: T,
  property: string,
  value: unknown,
): T {
  const path = parseModifierProperty(property),
    spec = modifierParameterSpec(layer, property);
  if (!path || !spec || typeof value !== 'number' || !Number.isFinite(value)) return layer;
  const entry = getLayerModifiers(layer).find((modifier) => modifier.id === path.id)!;
  const next = {
    ...entry,
    params: { ...entry.params, [path.param]: Math.max(spec.min, Math.min(spec.max, value)) },
  } as LayerModifier;
  // A malformed external bound value must not make a previously valid runtime stack throw.
  if (modifierStackErrors([next]).length) return layer;
  return {
    ...layer,
    modifiers: getLayerModifiers(layer).map((modifier) =>
      modifier.id === path.id ? next : modifier,
    ),
  };
}
export function sampleLayerModifiers(
  layer: ModifierHost,
  sample: (property: AnimatableLayerProperty, fallback: number) => number,
): LayerModifier[] {
  const result = cloneModifierValue(getLayerModifiers(layer));
  for (const modifier of result) {
    const params = modifier.params as unknown as Record<string, unknown>;
    for (const [key, spec] of Object.entries(MODIFIER_CATALOG[modifier.type].params)) {
      const value = sample(modifierProperty(modifier, key), Number(params[key]));
      if (Number.isFinite(value)) params[key] = Math.max(spec.min, Math.min(spec.max, value));
    }
    // Sample related dimensions together. A crossing/overshooting keyed minimum stops at its cap.
    if (modifier.type === 'auto-size') {
      if (modifier.params.maxWidth > 0)
        modifier.params.minWidth = Math.min(modifier.params.minWidth, modifier.params.maxWidth);
      if (modifier.params.maxHeight > 0)
        modifier.params.minHeight = Math.min(modifier.params.minHeight, modifier.params.maxHeight);
    }
  }
  return result;
}
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const simpleId = (value: unknown): value is string =>
  typeof value === 'string' && /^[-a-zA-Z0-9_]{1,100}$/.test(value);
const referenceId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\r\n\0]/.test(value);
const exactKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(value).every((key) => allowed.includes(key));
export function geometryReferenceErrors(value: unknown): string[] {
  if (!object(value)) return ['Geometry reference must be an object.'];
  if (value.kind === 'layer' && exactKeys(value, ['kind', 'layerId']) && referenceId(value.layerId))
    return [];
  if (value.kind === 'group' && exactKeys(value, ['kind', 'groupId']) && referenceId(value.groupId))
    return [];
  return ['Geometry reference needs a layer or group ID.'];
}
const GRID_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
const OTHER_MODIFIER_PARAMS: Record<LayerModifierType, readonly string[]> = {
  'max-text-width': ['mode'],
  'auto-size': ['source', 'width', 'height'],
  'auto-follow': ['source', 'axisX', 'axisY'],
  'hide-empty': ['source', 'target', 'trimWhitespace', 'invert'],
  'grid-arrange': ['startCorner', 'direction'],
  'radial-arrange': ['arrangement', 'startFromOuter', 'orient'],
  justify: ['horizontal', 'vertical'],
  'look-at': ['source', 'axis', 'flip'],
};
const MODIFIER_FLAGS: Record<LayerModifierType, Record<string, unknown>> = {
  'max-text-width': { mode: 'squeeze' },
  'auto-size': { width: true, height: true },
  'auto-follow': { axisX: true, axisY: true },
  'hide-empty': { trimWhitespace: true, invert: false },
  'grid-arrange': { startCorner: 'top-left', direction: 'horizontal' },
  'radial-arrange': { arrangement: 'equal', startFromOuter: false, orient: false },
  justify: { horizontal: 'center', vertical: 'none' },
  'look-at': { axis: 'x', flip: false },
};
export function modifierStackErrors(value: unknown, element?: Element): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return ['Modifiers must be an array.'];
  const errors: string[] = [],
    ids = new Set<string>();
  if (value.length > MAX_LAYER_MODIFIERS)
    errors.push(`Use at most ${MAX_LAYER_MODIFIERS} modifiers per layer.`);
  for (const entry of value) {
    if (!object(entry)) {
      errors.push('Modifier entries must be objects.');
      continue;
    }
    if (!simpleId(entry.id) || ids.has(entry.id))
      errors.push('Modifier IDs must be unique simple identifiers.');
    if (typeof entry.id === 'string') ids.add(entry.id);
    if (!exactKeys(entry, ['id', 'type', 'name', 'enabled', 'params']))
      errors.push('Unknown modifier property.');
    if (
      typeof entry.name !== 'string' ||
      !entry.name.trim() ||
      entry.name.length > 256 ||
      typeof entry.enabled !== 'boolean'
    )
      errors.push('Modifiers need a name and boolean enabled flag.');
    if (!MODIFIER_TYPES.includes(entry.type as LayerModifierType)) {
      errors.push('Unknown modifier type.');
      continue;
    }
    const type = entry.type as LayerModifierType,
      params = entry.params;
    if (!object(params)) {
      errors.push('Modifier params must be an object.');
      continue;
    }
    const numeric = MODIFIER_CATALOG[type].params;
    const other = OTHER_MODIFIER_PARAMS[type];
    if (!exactKeys(params, [...Object.keys(numeric), ...other]))
      errors.push(`Unknown ${type} parameter.`);
    for (const [key, spec] of Object.entries(numeric)) {
      const number = params[key];
      if (
        typeof number !== 'number' ||
        !Number.isFinite(number) ||
        number < spec.min ||
        number > spec.max
      )
        errors.push(`${entry.name}.${key} must be from ${spec.min} to ${spec.max}.`);
    }
    if (type === 'max-text-width') {
      if (!['squeeze', 'shrink'].includes(String(params.mode)))
        errors.push('Max Text Width mode must be squeeze or shrink.');
      if (element && element.type !== 'text')
        errors.push('Max Text Width can only be applied to text.');
    } else if (type === 'auto-size' || type === 'auto-follow') {
      errors.push(...geometryReferenceErrors(params.source));
      const axes = type === 'auto-size' ? ['width', 'height'] : ['axisX', 'axisY'];
      if (axes.some((key) => typeof params[key] !== 'boolean'))
        errors.push(`${type} axes must be boolean.`);
      if (type === 'auto-size')
        for (const axis of ['Width', 'Height']) {
          const min = params[`min${axis}`],
            max = params[`max${axis}`];
          if (typeof min === 'number' && typeof max === 'number' && max > 0 && min > max)
            errors.push(`Auto Size minimum ${axis.toLowerCase()} cannot exceed its maximum.`);
        }
    } else if (type === 'grid-arrange') {
      if (!GRID_CORNERS.includes(String(params.startCorner)))
        errors.push(
          'Grid Arrange startCorner must be top-left, top-right, bottom-left or bottom-right.',
        );
      if (!['horizontal', 'vertical'].includes(String(params.direction)))
        errors.push('Grid Arrange direction must be horizontal or vertical.');
    } else if (type === 'radial-arrange') {
      if (!['equal', 'radiate'].includes(String(params.arrangement)))
        errors.push('Radial Arrange arrangement must be equal or radiate.');
      if (typeof params.startFromOuter !== 'boolean' || typeof params.orient !== 'boolean')
        errors.push('Radial Arrange startFromOuter and orient must be boolean.');
    } else if (type === 'justify') {
      if (!['none', 'left', 'center', 'right'].includes(String(params.horizontal)))
        errors.push('Justify horizontal must be none, left, center or right.');
      if (!['none', 'top', 'center', 'bottom'].includes(String(params.vertical)))
        errors.push('Justify vertical must be none, top, center or bottom.');
    } else if (type === 'look-at') {
      errors.push(...geometryReferenceErrors(params.source));
      if (!['x', 'y'].includes(String(params.axis))) errors.push('Look At axis must be x or y.');
      if (typeof params.flip !== 'boolean') errors.push('Look At flip must be boolean.');
    } else {
      if (typeof params.trimWhitespace !== 'boolean' || typeof params.invert !== 'boolean')
        errors.push('Hide on Empty trimWhitespace and invert must be boolean.');
      if (params.target !== undefined) errors.push(...geometryReferenceErrors(params.target));
      const source = params.source;
      if (!object(source)) errors.push('Hide on Empty needs a value source.');
      else if (source.kind === 'layer') {
        if (
          !exactKeys(source, ['kind', 'layerId', 'property']) ||
          !referenceId(source.layerId) ||
          !['content', 'src'].includes(String(source.property))
        )
          errors.push('Hide on Empty layer source must select text content or image src.');
      } else if (source.kind === 'field') {
        if (
          !exactKeys(source, ['kind', 'fieldId', 'sourcePath']) ||
          !referenceId(source.fieldId) ||
          !Array.isArray(source.sourcePath) ||
          source.sourcePath.length > 32 ||
          source.sourcePath.some(
            (part) =>
              typeof part !== 'string' ||
              !part ||
              part.length > 256 ||
              ['__proto__', 'constructor', 'prototype'].includes(part),
          )
        )
          errors.push('Hide on Empty field source needs an ID and a safe sourcePath.');
      } else errors.push('Unknown Hide on Empty value source.');
    }
  }
  return errors;
}

export function createLayerModifier<T extends LayerModifierType>(
  type: T,
  params: Partial<ModifierParamsByType[T]> = {},
  options: { id?: string; name?: string; enabled?: boolean } = {},
): LayerModifier {
  const defaults = Object.fromEntries(
    Object.entries(MODIFIER_CATALOG[type]?.params ?? {}).map(([key, spec]) => [key, spec.default]),
  );
  const flags = MODIFIER_FLAGS[type] ?? {};
  const modifier = {
    id: options.id ?? createId('modifier'),
    type,
    name: options.name ?? MODIFIER_CATALOG[type]?.label,
    enabled: options.enabled ?? true,
    params: { ...defaults, ...flags, ...params },
  } as unknown as LayerModifier;
  const errors = modifierStackErrors([modifier]);
  if (errors.length) throw new Error(errors.join(' '));
  return modifier;
}
export function addLayerModifier<T extends LayerModifierType>(
  layer: Layer,
  type: T,
  params: Partial<ModifierParamsByType[T]> = {},
  index?: number,
  id?: string,
): LayerModifier {
  const modifier = createLayerModifier(type, params, id ? { id } : {});
  const stack = [...getLayerModifiers(layer)];
  if (index !== undefined && (!Number.isInteger(index) || index < 0 || index > stack.length))
    throw new Error('Modifier insertion index is out of range.');
  stack.splice(index ?? stack.length, 0, modifier);
  const errors = modifierStackErrors(stack, layer.element);
  if (errors.length) throw new Error(errors.join(' '));
  layer.modifiers = stack;
  return modifier;
}
export function updateLayerModifier(
  layer: Layer,
  id: string,
  patch: LayerModifierPatch,
): LayerModifier {
  if (!object(patch) || !exactKeys(patch as Record<string, unknown>, ['name', 'enabled', 'params']))
    throw new Error('Unknown modifier patch property.');
  const stack = cloneModifierValue(getLayerModifiers(layer)),
    modifier = stack.find((entry) => entry.id === id);
  if (!modifier) throw new Error(`Modifier not found: ${id}`);
  if (patch.name !== undefined) {
    if (typeof patch.name !== 'string') throw new Error('Modifier name must be a string.');
    modifier.name = patch.name;
  }
  if (patch.enabled !== undefined) {
    if (typeof patch.enabled !== 'boolean') throw new Error('Modifier enabled must be boolean.');
    modifier.enabled = patch.enabled;
  }
  if (patch.params !== undefined) {
    if (!object(patch.params)) throw new Error('Modifier params patch must be an object.');
    Object.assign(modifier.params, cloneModifierValue(patch.params));
  }
  const errors = modifierStackErrors(stack, layer.element);
  if (errors.length) throw new Error(errors.join(' '));
  layer.modifiers = stack;
  return modifier;
}
export function removeLayerModifier(layer: Layer, id: string): void {
  if (!getLayerModifiers(layer).some((entry) => entry.id === id))
    throw new Error(`Modifier not found: ${id}`);
  const owns = (property: string) => parseModifierProperty(property)?.id === id;
  layer.modifiers = getLayerModifiers(layer).filter((entry) => entry.id !== id);
  for (const tracks of [layer.animationTracks, layer.loop?.tracks])
    for (const property of Object.keys(tracks ?? {}))
      if (owns(property)) delete tracks![property as AnimatableLayerProperty];
  layer.bindings = layer.bindings.filter((binding) => !owns(binding.targetProperty));
  layer.designTokenBindings = layer.designTokenBindings.filter(
    (binding) => !owns(binding.targetProperty),
  );
}
export function reorderLayerModifiers(layer: Layer, ids: string[]): void {
  const stack = getLayerModifiers(layer);
  if (
    ids.length !== stack.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !stack.some((entry) => entry.id === id))
  )
    throw new Error('Reorder must include every modifier ID exactly once.');
  layer.modifiers = ids.map((id) => stack.find((entry) => entry.id === id)!);
}
export function duplicateLayerModifier(
  layer: Layer,
  id: string,
  newId = createId('modifier'),
): LayerModifier {
  const stack = getLayerModifiers(layer),
    source = stack.find((entry) => entry.id === id);
  if (!source) throw new Error(`Modifier not found: ${id}`);
  const copy = {
    ...cloneModifierValue(source),
    id: newId,
    name: `${source.name} copy`,
    enabled: false,
  } as LayerModifier;
  const next = [...stack];
  next.splice(stack.indexOf(source) + 1, 0, copy);
  const errors = modifierStackErrors(next, layer.element);
  if (errors.length) throw new Error(errors.join(' '));
  layer.modifiers = next;
  for (const property of numericModifierProperties({ modifiers: [source] })) {
    const path = parseModifierProperty(property)!,
      target = modifierProperty(copy, path.param);
    for (const tracks of [layer.animationTracks, layer.loop?.tracks])
      if (tracks?.[property])
        tracks[target] = tracks[property]!.map((key) => ({ ...key, id: createId('prop-key') }));
    layer.bindings.push(
      ...layer.bindings
        .filter((binding) => binding.targetProperty === property)
        .map((binding) => ({ ...binding, targetProperty: target })),
    );
  }
  return copy;
}

export function remapLayerModifierReferences(
  modifiers: readonly LayerModifier[] | undefined,
  ids: {
    layers?: ReadonlyMap<string, string> | Readonly<Record<string, string>>;
    groups?: ReadonlyMap<string, string> | Readonly<Record<string, string>>;
    fields?: ReadonlyMap<string, string> | Readonly<Record<string, string>>;
  },
): LayerModifier[] | undefined {
  if (modifiers === undefined) return undefined;
  const lookup = (mapping: typeof ids.layers, id: string): string => {
    if (mapping instanceof Map) return mapping.get(id) ?? id;
    const record = mapping as Readonly<Record<string, string>> | undefined;
    return record && Object.hasOwn(record, id) && typeof record[id] === 'string' ? record[id]! : id;
  };
  const reference = (ref: GeometryReference): GeometryReference =>
    ref.kind === 'layer'
      ? { kind: 'layer', layerId: lookup(ids.layers, ref.layerId) }
      : { kind: 'group', groupId: lookup(ids.groups, ref.groupId) };
  return cloneModifierValue(modifiers).map((modifier) => {
    if (
      modifier.type === 'auto-size' ||
      modifier.type === 'auto-follow' ||
      modifier.type === 'look-at'
    )
      modifier.params.source = reference(modifier.params.source);
    else if (modifier.type === 'hide-empty') {
      if (modifier.params.target) modifier.params.target = reference(modifier.params.target);
      const source = modifier.params.source;
      if (source.kind === 'layer') source.layerId = lookup(ids.layers, source.layerId);
      else source.fieldId = lookup(ids.fields, source.fieldId);
    }
    return modifier;
  });
}

export function layerModifierGeometryReferences(layer: ModifierHost): GeometryReference[] {
  return getLayerModifiers(layer).flatMap((modifier) => {
    if (
      modifier.type === 'auto-size' ||
      modifier.type === 'auto-follow' ||
      modifier.type === 'look-at'
    )
      return [modifier.params.source];
    if (modifier.type === 'hide-empty')
      return [
        ...(modifier.params.target ? [modifier.params.target] : []),
        ...(modifier.params.source.kind === 'layer'
          ? [{ kind: 'layer' as const, layerId: modifier.params.source.layerId }]
          : []),
      ];
    return [];
  });
}
export function layerModifierFieldIds(layer: ModifierHost): string[] {
  return getLayerModifiers(layer).flatMap((modifier) =>
    modifier.type === 'hide-empty' && modifier.params.source.kind === 'field'
      ? [modifier.params.source.fieldId]
      : [],
  );
}

/// Geometry jobs and whole-composition validation are shared with the frame evaluator below.
type GeometryAxis = 'x' | 'y' | 'width' | 'height' | 'rotation';
interface GeometryJob {
  key: string;
  owner: ModifierLayerNode;
  modifier?: LayerModifier;
  axis: GeometryAxis | 'text' | 'anchor-x' | 'anchor-y' | 'container' | 'motion-path';
  reads: string[];
  writes: string[];
  /** Descendant positions moved rigidly with an arranged child; their own drivers run later. */
  translates?: string[];
}
const propertyKey = (id: string, property: GeometryAxis) => `${id}\u0000${property}`;
const BOUNDS_PROPERTIES = ['x', 'y', 'width', 'height', 'rotation'] as const;
function referenceMembers(
  ref: GeometryReference,
  layers: readonly ModifierLayerNode[],
): ModifierLayerNode[] {
  return layers.filter((layer) =>
    ref.kind === 'layer' ? layer.id === ref.layerId : layer.groupId === ref.groupId,
  );
}
/** Direct children in layer order, the same item order Auto Layout uses. */
function childrenByParent(layers: readonly ModifierLayerNode[]): Map<string, ModifierLayerNode[]> {
  const ids = new Set(layers.map((layer) => layer.id));
  const children = new Map<string, ModifierLayerNode[]>();
  for (const layer of layers) {
    if (!layer.parentId || !ids.has(layer.parentId) || layer.parentId === layer.id) continue;
    children.set(layer.parentId, [...(children.get(layer.parentId) ?? []), layer]);
  }
  return children;
}
function descendantIds(
  id: string,
  children: ReadonlyMap<string, readonly ModifierLayerNode[]>,
): string[] {
  const result: string[] = [],
    seen = new Set([id]),
    pending = [...(children.get(id) ?? [])];
  while (pending.length) {
    const next = pending.shift()!;
    if (seen.has(next.id)) continue;
    seen.add(next.id);
    result.push(next.id);
    pending.push(...(children.get(next.id) ?? []));
  }
  return result;
}
const enabledContainerModifiers = (layer: ModifierLayerNode) =>
  getLayerModifiers(layer).filter((modifier) => modifier.enabled && isContainerModifier(modifier));
function geometryJobs(layers: readonly ModifierLayerNode[]): GeometryJob[] {
  const result: GeometryJob[] = [];
  const children = childrenByParent(layers);
  const arranged = new Set(
    layers.flatMap((layer) =>
      enabledContainerModifiers(layer).length
        ? (children.get(layer.id) ?? []).map((child) => child.id)
        : [],
    ),
  );
  for (const owner of layers) {
    if (owner.motionPath) {
      const link = owner.motionPath;
      result.push({
        key: `${owner.id}:motion-path`,
        owner,
        axis: 'motion-path',
        reads: [
          ...BOUNDS_PROPERTIES.map((property) => propertyKey(link.sourceLayerId, property)),
          propertyKey(owner.id, 'width'),
          propertyKey(owner.id, 'height'),
        ],
        writes: [
          propertyKey(owner.id, 'x'),
          propertyKey(owner.id, 'y'),
          ...(link.orientToPath ? [propertyKey(owner.id, 'rotation')] : []),
        ],
      });
    }
    const modifiers = getLayerModifiers(owner).filter((modifier) => modifier.enabled);
    const follow = modifiers.find((modifier) => modifier.type === 'auto-follow');
    const size = modifiers.find((modifier) => modifier.type === 'auto-size');
    for (const modifier of modifiers) {
      if (modifier.type === 'hide-empty' || isContainerModifier(modifier)) continue;
      const add = (axis: GeometryJob['axis'], reads: string[], writes: string[]) =>
        result.push({
          key: `${owner.id}:${modifier.id}:${axis}`,
          owner,
          modifier,
          axis,
          reads,
          writes,
        });
      if (modifier.type === 'max-text-width')
        add('text', [], [propertyKey(owner.id, 'width'), propertyKey(owner.id, 'height')]);
      else if (modifier.type === 'look-at')
        add(
          'rotation',
          [
            ...referenceMembers(modifier.params.source, layers).flatMap((source) =>
              BOUNDS_PROPERTIES.map((property) => propertyKey(source.id, property)),
            ),
            ...(['x', 'y', 'width', 'height'] as const).map((property) =>
              propertyKey(owner.id, property),
            ),
          ],
          [propertyKey(owner.id, 'rotation')],
        );
      else if (modifier.type === 'auto-size' || modifier.type === 'auto-follow') {
        const sources = referenceMembers(modifier.params.source, layers);
        if (modifier.type === 'auto-size')
          for (const axis of ['width', 'height'] as const) {
            if (!modifier.params[axis]) continue;
            const dependencies =
              modifier.params.source.kind === 'group'
                ? ([axis === 'width' ? 'x' : 'y', 'width', 'height', 'rotation'] as const)
                : (['width', 'height', 'rotation'] as const);
            add(
              axis,
              sources.flatMap((source) =>
                dependencies.map((property) => propertyKey(source.id, property)),
              ),
              [propertyKey(owner.id, axis)],
            );
          }
        else
          for (const [axis, enabled] of [
            ['x', modifier.params.axisX],
            ['y', modifier.params.axisY],
          ] as const) {
            if (!enabled) continue;
            add(
              axis,
              [
                ...sources.flatMap((source) =>
                  ([axis, 'width', 'height', 'rotation'] as const).map((property) =>
                    propertyKey(source.id, property),
                  ),
                ),
                propertyKey(owner.id, 'width'),
                propertyKey(owner.id, 'height'),
                propertyKey(owner.id, 'rotation'),
              ],
              [propertyKey(owner.id, axis)],
            );
          }
      }
    }
    const containers = modifiers.filter(isContainerModifier);
    if (containers.length) {
      const items = children.get(owner.id) ?? [];
      const orients = containers.some(
        (modifier) => modifier.type === 'radial-arrange' && modifier.params.orient,
      );
      result.push({
        key: `${owner.id}:container`,
        owner,
        modifier: containers[0]!,
        axis: 'container',
        reads: [owner, ...items].flatMap((layer) =>
          BOUNDS_PROPERTIES.map((property) => propertyKey(layer.id, property)),
        ),
        writes: items.flatMap((item) => [
          propertyKey(item.id, 'x'),
          propertyKey(item.id, 'y'),
          ...(orients ? [propertyKey(item.id, 'rotation')] : []),
        ]),
        translates: items.flatMap((item) =>
          descendantIds(item.id, children).flatMap((id) => [
            propertyKey(id, 'x'),
            propertyKey(id, 'y'),
          ]),
        ),
      });
    }
    // An arranged child is positioned by its container after sizing; it keeps no anchor of its own.
    if (
      size?.type === 'auto-size' &&
      (size.params.width || size.params.height) &&
      !arranged.has(owner.id)
    )
      for (const axis of ['x', 'y'] as const) {
        if (
          follow?.type === 'auto-follow' &&
          (axis === 'x' ? follow.params.axisX : follow.params.axisY)
        )
          continue;
        result.push({
          key: `${owner.id}:${size.id}:anchor-${axis}`,
          owner,
          modifier: size,
          axis: `anchor-${axis}`,
          reads: [propertyKey(owner.id, 'width'), propertyKey(owner.id, 'height')],
          writes: [propertyKey(owner.id, axis)],
        });
      }
  }
  return result;
}
function orderedJobs(layers: readonly ModifierLayerNode[]): {
  jobs: GeometryJob[];
  errors: string[];
} {
  const jobs = geometryJobs(layers),
    writers = new Map<string, GeometryJob>(),
    translators = new Map<string, GeometryJob[]>(),
    errors: string[] = [];
  for (const job of jobs) {
    for (const property of job.writes) {
      const previous = writers.get(property);
      if (previous)
        errors.push(
          `Layer "${job.owner.name ?? job.owner.id}" has conflicting modifier drivers for ${property.split('\u0000')[1]}.`,
        );
      else writers.set(property, job);
    }
    for (const property of job.translates ?? [])
      translators.set(property, [...(translators.get(property) ?? []), job]);
  }
  const pending = new Map<string, number>(),
    dependents = new Map<string, GeometryJob[]>();
  for (const job of jobs) {
    const dependencies = new Set(
      [
        ...job.reads.flatMap((property) => {
          const source = writers.get(property);
          return [...(source ? [source] : []), ...(translators.get(property) ?? [])];
        }),
        // A driver of a translated descendant runs after the rigid move so it keeps the last word.
        ...job.writes.flatMap((property) => translators.get(property) ?? []),
      ]
        .filter((dependency) => dependency.key !== job.key)
        .map((dependency) => dependency.key),
    );
    pending.set(job.key, dependencies.size);
    for (const dependency of dependencies) {
      const consumers = dependents.get(dependency) ?? [];
      consumers.push(job);
      dependents.set(dependency, consumers);
    }
  }
  // Iterative topological ordering also bounds stack use on long externally supplied chains.
  const ordered = jobs.filter((job) => pending.get(job.key) === 0);
  for (let index = 0; index < ordered.length; index++) {
    for (const consumer of dependents.get(ordered[index]!.key) ?? []) {
      const remaining = pending.get(consumer.key)! - 1;
      pending.set(consumer.key, remaining);
      if (remaining === 0) ordered.push(consumer);
    }
  }
  if (ordered.length !== jobs.length) {
    const cycle = jobs.find((job) => pending.get(job.key)! > 0)!;
    errors.push(
      `Modifier dependency cycle at "${cycle.owner.name ?? cycle.owner.id}" (${cycle.modifier?.name ?? 'Spline Path'}).`,
    );
  }
  return { jobs: ordered, errors: [...new Set(errors)] };
}
export function layerModifiersErrors(
  layers: readonly ModifierLayerNode[],
  dataFields?: Iterable<string> | readonly FieldDefinition[],
): string[] {
  const errors: string[] = [];
  for (const layer of layers)
    errors.push(
      ...modifierStackErrors(layer.modifiers, layer.element).map(
        (error) => `Layer "${layer.name ?? layer.id}": ${error}`,
      ),
    );
  if (errors.length) return errors;
  const fields = dataFields === undefined ? undefined : [...dataFields];
  const fieldById = new Map<string, FieldDefinition>();
  const fieldIds =
    fields &&
    new Set(
      fields.map((field) =>
        typeof field === 'string' ? field : (fieldById.set(field.id, field), field.id),
      ),
    );
  const checkReference = (reference: GeometryReference, owner: ModifierLayerNode) => {
    const members = referenceMembers(reference, layers);
    if (!members.length)
      errors.push(
        `Layer "${owner.name ?? owner.id}" modifier references a missing ${reference.kind}.`,
      );
    if (members.some((member) => member.isGuide))
      errors.push(
        `Layer "${owner.name ?? owner.id}" modifier cannot reference guide artwork that is omitted from export.`,
      );
  };
  for (const owner of layers)
    for (const modifier of getLayerModifiers(owner)) {
      if (modifier.type === 'auto-size' || modifier.type === 'auto-follow') {
        checkReference(modifier.params.source, owner);
        if (modifier.enabled && owner.motionPath)
          errors.push(
            `Layer "${owner.name ?? owner.id}" cannot combine a geometry modifier with a motion path.`,
          );
        if (
          modifier.enabled &&
          ((owner.autoLayout?.direction && owner.autoLayout.direction !== 'none') ||
            (owner.parentId &&
              layers.some(
                (layer) =>
                  layer.id === owner.parentId &&
                  layer.autoLayout?.direction &&
                  layer.autoLayout.direction !== 'none',
              )))
        )
          errors.push(
            `Layer "${owner.name ?? owner.id}" has conflicting Auto Layout and modifier geometry drivers.`,
          );
      } else if (modifier.type === 'look-at') {
        checkReference(modifier.params.source, owner);
        if (
          referenceMembers(modifier.params.source, layers).some((member) => member.id === owner.id)
        )
          errors.push(
            `Layer "${owner.name ?? owner.id}" Look At cannot reference itself, including through a group.`,
          );
        if (modifier.enabled && owner.motionPath?.orientToPath)
          errors.push(
            `Layer "${owner.name ?? owner.id}" cannot combine Look At with a motion path that orients to the path.`,
          );
      } else if (isContainerModifier(modifier)) {
        if (!modifier.enabled) continue;
        if (owner.autoLayout?.direction && owner.autoLayout.direction !== 'none')
          errors.push(
            `Layer "${owner.name ?? owner.id}" has conflicting Auto Layout and ${MODIFIER_CATALOG[modifier.type].label} drivers for its children.`,
          );
        for (const child of layers)
          if (child.parentId === owner.id && child.motionPath)
            errors.push(
              `Layer "${child.name ?? child.id}" cannot follow a motion path while ${MODIFIER_CATALOG[modifier.type].label} on "${owner.name ?? owner.id}" arranges it.`,
            );
      } else if (modifier.type === 'hide-empty') {
        if (modifier.params.target) checkReference(modifier.params.target, owner);
        const source = modifier.params.source;
        if (source.kind === 'layer') {
          const target = layers.find((layer) => layer.id === source.layerId);
          if (
            !target ||
            (source.property === 'content'
              ? target.element.type !== 'text'
              : target.element.type !== 'image')
          )
            errors.push(
              `Layer "${owner.name ?? owner.id}" Hide on Empty source must be an existing ${source.property === 'content' ? 'text' : 'image'} layer.`,
            );
          if (target?.isGuide)
            errors.push(
              `Layer "${owner.name ?? owner.id}" Hide on Empty cannot reference a guide omitted from export.`,
            );
        } else {
          if (fieldIds && !fieldIds.has(source.fieldId))
            errors.push(
              `Layer "${owner.name ?? owner.id}" Hide on Empty references a missing field.`,
            );
          let schema = fieldById.get(source.fieldId);
          for (const part of source.sourcePath) {
            if (!schema) break;
            if (schema.type === 'array') schema = schema.items ?? undefined;
            schema =
              schema?.type === 'object'
                ? schema.properties.find((field) => field.key === part)
                : undefined;
            if (!schema)
              errors.push(
                `Layer "${owner.name ?? owner.id}" Hide on Empty sourcePath is not in the field schema.`,
              );
          }
        }
      }
    }
  errors.push(...orderedJobs(layers).errors);
  return [...new Set(errors)];
}
function sourceValue(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const part of path) {
    if (Array.isArray(current)) current = current[0];
    if (!object(current) || !Object.hasOwn(current, part)) return undefined;
    current = current[part];
  }
  return current;
}
export function modifierValueIsEmpty(value: unknown, trimWhitespace = true): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && (trimWhitespace ? value.trim() : value) === '') ||
    (Array.isArray(value) && value.length === 0)
  );
}
export function evaluateModifierVisibility(
  input: Pick<ModifierEvaluationInput, 'layers' | 'states' | 'dataByFieldId'>,
): Map<string, boolean> {
  const visibility = new Map([...input.states].map(([id, state]) => [id, state.isVisible]));
  for (const owner of input.layers)
    for (const modifier of getLayerModifiers(owner)) {
      if (!modifier.enabled || modifier.type !== 'hide-empty') continue;
      const source = modifier.params.source;
      const element =
        source.kind === 'layer' ? input.states.get(source.layerId)?.element : undefined;
      const value =
        source.kind === 'field'
          ? sourceValue(input.dataByFieldId?.[source.fieldId], source.sourcePath)
          : source.property === 'content' && element?.type === 'text'
            ? element.content
            : source.property === 'src' && element?.type === 'image'
              ? element.src
              : undefined;
      const empty = modifierValueIsEmpty(value, modifier.params.trimWhitespace);
      const hidden = modifier.params.invert ? !empty : empty;
      const targets = modifier.params.target
        ? referenceMembers(modifier.params.target, input.layers)
        : [owner];
      // Hidden is a gate: a modifier never unexpectedly unhides a manually/rule-hidden layer.
      if (hidden) for (const target of targets) visibility.set(target.id, false);
    }
  return visibility;
}
export interface ModifierBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
function effectiveModifierScale(scale = 1): number {
  return Number.isFinite(scale) ? Math.max(0, scale) : 1;
}
/** Mirrors CSS translate/rotate/scale around the layer's unscaled transform origin. */
export function modifierTransformBounds(transform: LayerTransform, scale = 1): ModifierBounds {
  const appliedScale = effectiveModifierScale(scale);
  const angle = (transform.rotation * Math.PI) / 180,
    cos = Math.cos(angle),
    sin = Math.sin(angle);
  const ox = transform.transformOriginX * transform.width,
    oy = transform.transformOriginY * transform.height;
  const corners = [
    [0, 0],
    [transform.width, 0],
    [0, transform.height],
    [transform.width, transform.height],
  ].map(([x = 0, y = 0]) => ({
    x: transform.x + ox + appliedScale * ((x - ox) * cos - (y - oy) * sin),
    y: transform.y + oy + appliedScale * ((x - ox) * sin + (y - oy) * cos),
  }));
  const x = Math.min(...corners.map((point) => point.x)),
    y = Math.min(...corners.map((point) => point.y));
  return {
    x,
    y,
    width: Math.max(...corners.map((point) => point.x)) - x,
    height: Math.max(...corners.map((point) => point.y)) - y,
  };
}
function boundsFor(
  reference: GeometryReference,
  layers: readonly ModifierLayerNode[],
  states: ReadonlyMap<string, ModifierVisualState>,
): ModifierBounds | null {
  const bounds = referenceMembers(reference, layers).flatMap((layer) => {
    const state = states.get(layer.id);
    return state && (reference.kind === 'layer' || state.isVisible)
      ? [modifierTransformBounds(state.transform, state.scale)]
      : [];
  });
  if (!bounds.length) return null;
  const x = Math.min(...bounds.map((bound) => bound.x)),
    y = Math.min(...bounds.map((bound) => bound.y));
  return {
    x,
    y,
    width: Math.max(...bounds.map((bound) => bound.x + bound.width)) - x,
    height: Math.max(...bounds.map((bound) => bound.y + bound.height)) - y,
  };
}
function localAnchor(
  transform: LayerTransform,
  x: number,
  y: number,
  scale = 1,
): { x: number; y: number } {
  const appliedScale = effectiveModifierScale(scale);
  const radians = (transform.rotation * Math.PI) / 180;
  const ox = transform.width * transform.transformOriginX,
    oy = transform.height * transform.transformOriginY;
  const dx = transform.width * x - ox,
    dy = transform.height * y - oy;
  return {
    x: transform.x + ox + appliedScale * (dx * Math.cos(radians) - dy * Math.sin(radians)),
    y: transform.y + oy + appliedScale * (dx * Math.sin(radians) + dy * Math.cos(radians)),
  };
}
function translateLayer(
  id: string,
  dx: number,
  dy: number,
  states: Map<string, ModifierVisualState>,
  children: ReadonlyMap<string, readonly ModifierLayerNode[]>,
): void {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (!dx && !dy)) return;
  for (const target of [id, ...descendantIds(id, children)]) {
    const state = states.get(target);
    if (!state) continue;
    state.transform.x += dx;
    state.transform.y += dy;
  }
}
const visualBounds = (state: ModifierVisualState) =>
  modifierTransformBounds(state.transform, state.scale);
/** Applies the owner's enabled Grid/Radial Arrange and Justify entries in stack order. */
function arrangeChildren(
  owner: ModifierLayerNode,
  ownerState: ModifierVisualState,
  items: readonly ModifierLayerNode[],
  states: Map<string, ModifierVisualState>,
  children: ReadonlyMap<string, readonly ModifierLayerNode[]>,
): void {
  const box = visualBounds(ownerState);
  for (const modifier of enabledContainerModifiers(owner)) {
    const visible = items.flatMap((item) => {
      const state = states.get(item.id);
      return state?.isVisible ? [{ item, state }] : [];
    });
    const place = (
      entries: typeof visible,
      limit: number,
      position: (index: number, entry: (typeof visible)[number]) => void,
    ) => {
      entries.forEach((entry, index) => {
        if (index < limit) position(index, entry);
        // Overflow beyond the arrangement's capacity is hidden with its artwork, not stacked.
        else
          for (const id of [entry.item.id, ...descendantIds(entry.item.id, children)]) {
            const hidden = states.get(id);
            if (hidden) hidden.isVisible = false;
          }
      });
    };
    const moveTo = (entry: (typeof visible)[number], x: number, y: number) => {
      const bounds = visualBounds(entry.state);
      translateLayer(entry.item.id, x - bounds.x, y - bounds.y, states, children);
    };
    if (modifier.type === 'grid-arrange') {
      const params = modifier.params;
      const columns = Math.max(1, Math.round(params.columns));
      const fixedRows = Math.max(0, Math.round(params.rows));
      const capacity = fixedRows ? columns * fixedRows : visible.length;
      const rows =
        fixedRows || Math.max(1, Math.ceil(Math.min(capacity, visible.length) / columns));
      const right = params.startCorner.endsWith('right'),
        bottom = params.startCorner.startsWith('bottom');
      place(visible, capacity, (index, entry) => {
        let column = params.direction === 'horizontal' ? index % columns : Math.floor(index / rows);
        let row = params.direction === 'horizontal' ? Math.floor(index / columns) : index % rows;
        if (right) column = columns - 1 - column;
        if (bottom) row = rows - 1 - row;
        moveTo(entry, box.x + column * params.spreadX, box.y + row * params.spreadY);
      });
    } else if (modifier.type === 'radial-arrange') {
      const params = modifier.params;
      const limit = Math.round(params.count) > 0 ? Math.round(params.count) : visible.length;
      const total = Math.min(limit, visible.length);
      const rings = Math.max(1, Math.min(Math.round(params.rings), Math.max(1, total)));
      const span = params.endAngle - params.startAngle;
      const closed = Math.abs(span) >= 360 - 1e-6;
      const angleAt = (index: number, count: number) =>
        params.startAngle + (count <= 1 ? 0 : (span * index) / (closed ? count : count - 1));
      const radiusAt = (ring: number) => {
        const order = params.startFromOuter ? rings - 1 - ring : ring;
        return rings === 1
          ? params.startFromOuter
            ? params.outerRadius
            : params.innerRadius
          : params.innerRadius + ((params.outerRadius - params.innerRadius) * order) / (rings - 1);
      };
      const cx = box.x + box.width / 2,
        cy = box.y + box.height / 2;
      place(visible, limit, (index, entry) => {
        let ring: number, slot: number, slots: number;
        if (params.arrangement === 'radiate') {
          // Spokes: each angle holds one item per ring, inner to outer.
          ring = index % rings;
          slot = Math.floor(index / rings);
          slots = Math.ceil(total / rings);
        } else {
          // Equal: every ring receives an equal share of the items, spread over the full arc.
          ring = Math.min(rings - 1, Math.floor((index * rings) / total));
          const first = Math.ceil((ring * total) / rings);
          slot = index - first;
          slots = Math.ceil(((ring + 1) * total) / rings) - first;
        }
        const angle = angleAt(slot, slots),
          radians = (angle * Math.PI) / 180,
          radius = radiusAt(ring);
        if (params.orient) entry.state.transform.rotation = angle + params.baseRotation;
        const bounds = visualBounds(entry.state);
        moveTo(
          entry,
          cx + Math.cos(radians) * radius - bounds.width / 2,
          cy + Math.sin(radians) * radius - bounds.height / 2,
        );
      });
    } else if (modifier.type === 'justify' && visible.length) {
      const params = modifier.params;
      const bounds = visible.map((entry) => visualBounds(entry.state));
      const left = Math.min(...bounds.map((bound) => bound.x)),
        top = Math.min(...bounds.map((bound) => bound.y)),
        width = Math.max(...bounds.map((bound) => bound.x + bound.width)) - left,
        height = Math.max(...bounds.map((bound) => bound.y + bound.height)) - top;
      const align = (mode: string, start: number, size: number, own: number, ownSize: number) =>
        mode === 'left' || mode === 'top'
          ? start - own
          : mode === 'center'
            ? start + size / 2 - (own + ownSize / 2)
            : mode === 'right' || mode === 'bottom'
              ? start + size - (own + ownSize)
              : 0;
      const dx =
        params.horizontal === 'none'
          ? 0
          : align(params.horizontal, box.x, box.width, left, width) + params.offsetX;
      const dy =
        params.vertical === 'none'
          ? 0
          : align(params.vertical, box.y, box.height, top, height) + params.offsetY;
      for (const entry of visible) translateLayer(entry.item.id, dx, dy, states, children);
    }
  }
}
export function evaluateLayerModifiers(input: ModifierEvaluationInput): {
  states: Map<string, ModifierVisualState>;
  textFits: Map<string, ModifierTextFit>;
} {
  const structural = input.layers.flatMap((layer) =>
    modifierStackErrors(layer.modifiers, layer.element),
  );
  const plan = structural.length ? { jobs: [], errors: structural } : orderedJobs(input.layers);
  if (plan.errors.length) throw new Error(plan.errors.join(' '));
  const visibility = evaluateModifierVisibility(input);
  const states = new Map(
    [...input.states].map(([id, state]) => [
      id,
      {
        ...state,
        transform: { ...state.transform },
        isVisible: visibility.get(id) ?? state.isVisible,
      },
    ]),
  );
  const textFits = new Map<string, ModifierTextFit>();
  const children = childrenByParent(input.layers);
  const measured = new Map<string, { width: number; height: number }>();
  const measure = (id: string, state: ModifierVisualState) => {
    let size = measured.get(id);
    if (!size) {
      const candidate = input.measureText?.(id, state.element, state.transform);
      size =
        candidate &&
        Number.isFinite(candidate.width) &&
        Number.isFinite(candidate.height) &&
        candidate.width > 0 &&
        candidate.height > 0
          ? candidate
          : { width: state.transform.width, height: state.transform.height };
      measured.set(id, size);
    }
    return size;
  };
  const intrinsicSources = new Set(
    input.layers.flatMap((layer) => [
      ...getLayerModifiers(layer)
        .filter((modifier) => modifier.enabled)
        .flatMap((modifier) =>
          modifier.type === 'auto-size' ||
          modifier.type === 'auto-follow' ||
          modifier.type === 'look-at'
            ? referenceMembers(modifier.params.source, input.layers).map((source) => source.id)
            : [],
        ),
      // Arranged children are placed by their natural text extent, like Auto Layout items.
      ...(enabledContainerModifiers(layer).length
        ? (children.get(layer.id) ?? []).map((child) => child.id)
        : []),
    ]),
  );
  for (const id of intrinsicSources) {
    const state = states.get(id);
    if (state?.element.type === 'text' && state.element.autoFit === 'auto-size') {
      const natural = measure(id, state);
      state.transform.width = natural.width;
      state.transform.height = natural.height;
    }
  }
  for (const job of plan.jobs) {
    const state = states.get(job.owner.id);
    if (!state) continue;
    if (job.axis === 'motion-path') {
      const link = job.owner.motionPath!;
      const source = states.get(link.sourceLayerId);
      if (source?.element.type === 'path')
        state.transform = attachTransformToMotionPath(
          state.transform,
          source.transform,
          source.element,
          link,
        );
      continue;
    }
    const modifier = job.modifier,
      transform = state.transform;
    if (!modifier) continue;
    if (modifier.type === 'max-text-width' && state.element.type === 'text') {
      const natural = measure(job.owner.id, state),
        params = modifier.params;
      const required = Math.min(1, params.maxWidth / natural.width);
      const ratio =
        params.mode === 'shrink'
          ? Math.min(1, Math.max(required, params.minFontSize / state.element.fontSize))
          : required;
      const scaleY = params.mode === 'shrink' ? ratio : 1;
      transform.width = Math.max(1, natural.width * ratio);
      transform.height = Math.max(1, natural.height * scaleY);
      textFits.set(job.owner.id, {
        scaleX: ratio,
        scaleY,
        fontSize: state.element.fontSize * scaleY,
      });
    } else if (modifier.type === 'auto-size') {
      const params = modifier.params;
      if (job.axis === 'anchor-x' || job.axis === 'anchor-y') {
        const before = input.states.get(job.owner.id)!.transform;
        const previous = localAnchor(before, params.anchorX, params.anchorY, state.scale),
          current = localAnchor(transform, params.anchorX, params.anchorY, state.scale);
        if (job.axis === 'anchor-x') transform.x += previous.x - current.x;
        else transform.y += previous.y - current.y;
      } else {
        const bounds = boundsFor(params.source, input.layers, states);
        if (!bounds) continue;
        const scale = effectiveModifierScale(state.scale);
        // A collapsed owner cannot fit a world-space source. Retain its safe authored geometry.
        if (scale === 0) continue;
        // Width/Height, padding and clamps stay in the owner's authored local units. Only the
        // referenced composition-space bounds are converted; Follow offsets remain world pixels.
        const desired =
          job.axis === 'width'
            ? bounds.width / scale + params.paddingLeft + params.paddingRight
            : bounds.height / scale + params.paddingTop + params.paddingBottom;
        const minimum = job.axis === 'width' ? params.minWidth : params.minHeight;
        const maximum = job.axis === 'width' ? params.maxWidth : params.maxHeight;
        const nextSize = Math.max(1, minimum, maximum > 0 ? Math.min(maximum, desired) : desired);
        if (Number.isFinite(nextSize))
          transform[job.axis === 'width' ? 'width' : 'height'] = nextSize;
      }
    } else if (job.axis === 'container') {
      arrangeChildren(job.owner, state, children.get(job.owner.id) ?? [], states, children);
    } else if (modifier.type === 'look-at') {
      const bounds = boundsFor(modifier.params.source, input.layers, states);
      if (!bounds) continue;
      const params = modifier.params;
      const dx =
          bounds.x +
          bounds.width / 2 -
          (transform.x + transform.transformOriginX * transform.width),
        dy =
          bounds.y +
          bounds.height / 2 -
          (transform.y + transform.transformOriginY * transform.height);
      // A coincident target has no direction; retain the authored rotation instead of snapping.
      if (Math.hypot(dx, dy) < 1e-6) continue;
      const angle =
        (Math.atan2(dy, dx) * 180) / Math.PI -
        (params.axis === 'y' ? 90 : 0) +
        (params.flip ? 180 : 0) +
        params.rotationOffset;
      transform.rotation = ((((angle + 180) % 360) + 360) % 360) - 180;
    } else if (modifier.type === 'auto-follow') {
      const bounds = boundsFor(modifier.params.source, input.layers, states);
      if (!bounds) continue;
      const params = modifier.params,
        own = modifierTransformBounds({ ...transform, x: 0, y: 0 }, state.scale);
      if (job.axis === 'x')
        transform.x =
          bounds.x +
          bounds.width * params.sourceAnchorX -
          own.x -
          own.width * params.targetAnchorX +
          params.offsetX;
      else
        transform.y =
          bounds.y +
          bounds.height * params.sourceAnchorY -
          own.y -
          own.height * params.targetAnchorY +
          params.offsetY;
    }
  }
  return { states, textFits };
}
