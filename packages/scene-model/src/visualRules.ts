import { createScopedUuid } from './id';
import type {
  Composition,
  FieldType,
  Layer,
  LayerVisualRule,
  TimerAlarmTrigger,
  VisualRuleAction,
  VisualRuleCondition,
  VisualRuleMatch,
  VisualRuleOperator,
  VisualRuleTrigger,
  VisualRuleKeyboardTrigger,
  VisualRuleKeyboardInput,
} from './types';
import { createId } from './id';
import { clockTimerActionId, MAX_TIMER_VALUE_MS, remapClockTimerActionId } from './clockTimer';
import { canonicalLayerRuleProperty } from './layerRuleProperties';

export function visualRuleValue(root: unknown, path: string[] = []): unknown {
  let value = root;
  for (const segment of path) {
    if (!value || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

/** Virtual operands in composition pixels; these are not editable or exported data fields. */
export const VISUAL_RULE_MOUSE_X_FIELD_ID = '$mouse.x';
export const VISUAL_RULE_MOUSE_Y_FIELD_ID = '$mouse.y';
export const VISUAL_RULE_MOUSE_FIELD_IDS = [
  VISUAL_RULE_MOUSE_X_FIELD_ID,
  VISUAL_RULE_MOUSE_Y_FIELD_ID,
] as const;

export function isVisualRuleMouseFieldId(
  id: unknown,
): id is (typeof VISUAL_RULE_MOUSE_FIELD_IDS)[number] {
  return id === VISUAL_RULE_MOUSE_X_FIELD_ID || id === VISUAL_RULE_MOUSE_Y_FIELD_ID;
}

/** Derives condition inputs without allowing editorial data to impersonate the mouse. */
export function visualRuleMouseData<D extends Record<string, unknown>>(
  values: D,
  pointer: { x: number; y: number } | null | undefined,
): D {
  const result = { ...values };
  delete result[VISUAL_RULE_MOUSE_X_FIELD_ID];
  delete result[VISUAL_RULE_MOUSE_Y_FIELD_ID];
  if (pointer && Number.isFinite(pointer.x) && Number.isFinite(pointer.y)) {
    Object.assign(result, {
      [VISUAL_RULE_MOUSE_X_FIELD_ID]: pointer.x,
      [VISUAL_RULE_MOUSE_Y_FIELD_ID]: pointer.y,
    });
  }
  return result;
}

/* ------------------------------------------------------------------------------------------------
 * Vocabulary
 * --------------------------------------------------------------------------------------------- */

export const VISUAL_RULE_TRIGGER_VALUES = [
  'data',
  'hover',
  'click',
  'double-click',
  'pointer-enter',
  'pointer-leave',
  'pointer-down',
  'pointer-up',
  'key-down',
  'key-up',
  'play',
  'step',
  'stop',
  'custom-action',
  'timer-alarm',
] as const satisfies readonly VisualRuleTrigger[];

export const VISUAL_RULE_OPERATOR_VALUES = [
  'equals',
  'not-equals',
  'empty',
  'not-empty',
  'greater-than',
  'less-than',
  'greater-or-equal',
  'less-or-equal',
  'between',
  'contains',
  'not-contains',
  'starts-with',
  'ends-with',
  'one-of',
  'not-one-of',
  'changed',
  'increased',
  'decreased',
] as const satisfies readonly VisualRuleOperator[];

// Compile-time guards that the lists above stay complete.
type Missing<All, Listed> = Exclude<All, Listed> extends never ? true : never;
const _triggersComplete: Missing<VisualRuleTrigger, (typeof VISUAL_RULE_TRIGGER_VALUES)[number]> =
  true;
const _operatorsComplete: Missing<
  VisualRuleOperator,
  (typeof VISUAL_RULE_OPERATOR_VALUES)[number]
> = true;
void _triggersComplete;
void _operatorsComplete;

/* ------------------------------------------------------------------------------------------------
 * Comparison
 * --------------------------------------------------------------------------------------------- */

export const VISUAL_RULE_EVENT_OPERATORS: ReadonlySet<VisualRuleOperator> = new Set([
  'changed',
  'increased',
  'decreased',
]);

/** Operators that compare against nothing, so they need no value or comparison field. */
export const VISUAL_RULE_UNARY_OPERATORS: ReadonlySet<VisualRuleOperator> = new Set([
  'empty',
  'not-empty',
  'changed',
  'increased',
  'decreased',
]);

export interface VisualRuleMatchOptions {
  ignoreCase?: boolean;
}

function empty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** A finite number for numbers and numeric text; `null` for anything else, including ''. */
function numeric(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function text(value: unknown, ignoreCase: boolean): string {
  const result =
    value === undefined || value === null
      ? ''
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  return ignoreCase ? result.toLocaleLowerCase() : result;
}

/**
 * Authored comparison values usually arrive as text from an input box while data fields carry
 * numbers and booleans, so equality coerces: numerically when either side is a number, by
 * `true`/`false` spelling when either side is a boolean, and as text otherwise.
 */
function scalarEquals(current: unknown, expected: unknown, ignoreCase: boolean): boolean {
  if (current === expected) return true;
  if (current === undefined || current === null || expected === undefined || expected === null)
    return empty(current) && empty(expected);
  if (typeof current === 'number' || typeof expected === 'number') {
    const a = numeric(current);
    const b = numeric(expected);
    return a !== null && b !== null && a === b;
  }
  if (typeof current === 'boolean' || typeof expected === 'boolean')
    return text(current, true).trim() === text(expected, true).trim();
  return text(current, ignoreCase) === text(expected, ignoreCase);
}

/** A list from an array, or from comma-separated text. */
export function visualRuleList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string')
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '');
  return value === undefined || value === null ? [] : [value];
}

/** An inclusive `[min, max]` range from a pair or from `min, max` text. */
export function visualRuleRange(value: unknown): [number, number] | null {
  const [a, b] = visualRuleList(value).map(numeric);
  if (a === null || a === undefined || b === null || b === undefined) return null;
  return a <= b ? [a, b] : [b, a];
}

function contains(current: unknown, expected: unknown, ignoreCase: boolean): boolean {
  if (Array.isArray(current))
    return current.some((entry) => scalarEquals(entry, expected, ignoreCase));
  const needle = text(expected, ignoreCase);
  return needle !== '' && text(current, ignoreCase).includes(needle);
}

export function visualRuleMatches(
  operator: VisualRuleOperator,
  current: unknown,
  expected?: unknown,
  previous?: unknown,
  options: VisualRuleMatchOptions = {},
): boolean {
  const ignoreCase = options.ignoreCase ?? false;
  const a = numeric(current);
  const b = numeric(expected);
  switch (operator) {
    case 'equals':
      return scalarEquals(current, expected, ignoreCase);
    case 'not-equals':
      return !scalarEquals(current, expected, ignoreCase);
    case 'empty':
      return empty(current);
    case 'not-empty':
      return !empty(current);
    case 'greater-than':
      return a !== null && b !== null && a > b;
    case 'less-than':
      return a !== null && b !== null && a < b;
    case 'greater-or-equal':
      return a !== null && b !== null && a >= b;
    case 'less-or-equal':
      return a !== null && b !== null && a <= b;
    case 'between': {
      const range = visualRuleRange(expected);
      return a !== null && range !== null && a >= range[0] && a <= range[1];
    }
    case 'contains':
      return contains(current, expected, ignoreCase);
    case 'not-contains':
      return !contains(current, expected, ignoreCase);
    case 'starts-with': {
      const needle = text(expected, ignoreCase);
      return needle !== '' && text(current, ignoreCase).startsWith(needle);
    }
    case 'ends-with': {
      const needle = text(expected, ignoreCase);
      return needle !== '' && text(current, ignoreCase).endsWith(needle);
    }
    case 'one-of':
      return visualRuleList(expected).some((entry) => scalarEquals(current, entry, ignoreCase));
    case 'not-one-of':
      return !visualRuleList(expected).some((entry) => scalarEquals(current, entry, ignoreCase));
    case 'changed':
      return previous !== undefined && !scalarEquals(current, previous, false);
    case 'increased': {
      const before = numeric(previous);
      return before !== null && a !== null && a > before;
    }
    case 'decreased': {
      const before = numeric(previous);
      return before !== null && a !== null && a < before;
    }
  }
}

/* ------------------------------------------------------------------------------------------------
 * Trigger and action classification
 * --------------------------------------------------------------------------------------------- */

export const VISUAL_RULE_POINTER_TRIGGERS: ReadonlySet<VisualRuleTrigger> = new Set([
  'hover',
  'click',
  'double-click',
  'pointer-enter',
  'pointer-leave',
  'pointer-down',
  'pointer-up',
]);

export const VISUAL_RULE_LIFECYCLE_TRIGGERS: ReadonlySet<VisualRuleTrigger> = new Set([
  'play',
  'step',
  'stop',
  'custom-action',
]);

export function isVisualRuleKeyboardTrigger(trigger: unknown): trigger is 'key-down' | 'key-up' {
  return trigger === 'key-down' || trigger === 'key-up';
}

/** Keep named DOM keys readable while canonicalizing historic aliases and letter case. */
export function normalizeVisualRuleKeyboardKey(key: string): string {
  // Imported documents are inspectable before full validation; malformed keys must not crash
  // a Rules label or an input handler. Validation still reports the invalid source value.
  if (typeof key !== 'string') return '';
  if (key === ' ' || /^(space|spacebar)$/i.test(key.trim())) return ' ';
  const trimmed = key.trim();
  if (/^(esc|escape)$/i.test(trimmed)) return 'Escape';
  return [...trimmed].length === 1 ? trimmed.toLowerCase() : trimmed;
}

export function visualRuleKeyboardErrors(config: unknown): string[] {
  if (!config || typeof config !== 'object' || Array.isArray(config))
    return ['Keyboard rules require a keyboard key.'];
  const value = config as Record<string, unknown>;
  const errors: string[] = [];
  if (
    typeof value.key !== 'string' ||
    value.key.length > 128 ||
    !normalizeVisualRuleKeyboardKey(value.key)
  )
    errors.push('Keyboard key must be a nonempty DOM key name (at most 128 characters).');
  for (const modifier of ['ctrl', 'alt', 'shift', 'meta', 'repeat'])
    if (value[modifier] !== undefined && typeof value[modifier] !== 'boolean')
      errors.push(`Keyboard ${modifier} must be a boolean.`);
  return errors;
}

export function visualRuleKeyboardMatches(
  config: VisualRuleKeyboardTrigger | undefined,
  input: VisualRuleKeyboardInput | undefined,
): boolean {
  if (!config || !input || input.isComposing || visualRuleKeyboardErrors(config).length)
    return false;
  if (input.repeat && !config.repeat) return false;
  return (
    normalizeVisualRuleKeyboardKey(config.key).toLowerCase() ===
      normalizeVisualRuleKeyboardKey(input.key).toLowerCase() &&
    Boolean(config.ctrl) === Boolean(input.ctrlKey) &&
    Boolean(config.alt) === Boolean(input.altKey) &&
    Boolean(config.shift) === Boolean(input.shiftKey) &&
    Boolean(config.meta) === Boolean(input.metaKey)
  );
}

export type VisualRuleStateAction = Extract<
  VisualRuleAction,
  { type: 'visibility' } | { type: 'toggle-visibility' } | { type: 'property' }
>;
export type VisualRuleSideEffectAction = Exclude<VisualRuleAction, VisualRuleStateAction>;

export function isVisualRuleStateAction(action: VisualRuleAction): action is VisualRuleStateAction {
  return (
    action.type === 'visibility' ||
    action.type === 'toggle-visibility' ||
    action.type === 'property'
  );
}

export function isVisualRuleSideEffectAction(
  action: VisualRuleAction,
): action is VisualRuleSideEffectAction {
  return !isVisualRuleStateAction(action);
}

export const VISUAL_RULE_SET_DATA_MODES = ['set', 'toggle', 'increase', 'decrease'] as const;

export const VISUAL_RULE_PLAYOUT_OPERATIONS = ['take', 'update', 'out', 'clear'] as const;
export const MAX_VISUAL_RULE_PLAYOUT_DATA_BYTES = 64 * 1024;

/** Shape validation only: a composition cannot resolve template-set lane/state references. */
export function visualRulePlayoutActionErrors(action: unknown): string[] {
  if (!action || typeof action !== 'object' || Array.isArray(action))
    return ['Playout action must be an object.'];
  const source = action as Record<string, unknown>;
  const errors: string[] = [];
  if (source.type !== 'playout') errors.push('Playout action type must be "playout".');
  if (!(VISUAL_RULE_PLAYOUT_OPERATIONS as readonly unknown[]).includes(source.operation))
    errors.push('Playout action must use Take, Update, Out or Clear.');
  const validId = (value: unknown) =>
    typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
  if (!validId(source.slotId))
    errors.push('Playout action must choose a lane (at most 256 characters).');
  if (source.operation === 'take' && !validId(source.stateId))
    errors.push('Take must choose a template state (at most 256 characters).');
  if (source.operation === 'update' && source.stateId !== undefined && !validId(source.stateId))
    errors.push('Update template state must be a non-empty ID of at most 256 characters.');
  if (source.operation === 'out' || source.operation === 'clear') {
    if (source.stateId !== undefined)
      errors.push('Out/Clear target a lane; omit the template state.');
    if (source.data !== undefined) errors.push('Out/Clear do not accept data.');
  }
  if (source.data !== undefined) errors.push(...visualRulePlayoutDataErrors(source.data));
  for (const key of Object.keys(source))
    if (!['type', 'operation', 'slotId', 'stateId', 'data'].includes(key))
      errors.push(`Playout action contains an unknown property "${key}".`);
  return errors;
}

/** Bounded JSON data with the same limits as the live playout command bridge. */
export function visualRulePlayoutDataErrors(data: unknown): string[] {
  if (!data || typeof data !== 'object' || Array.isArray(data))
    return ['Playout data must be a JSON object.'];
  let count = 0;
  const ancestors = new Set<object>();
  const visit = (value: unknown, depth: number): boolean => {
    if (++count > 4096 || depth > 16) return false;
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value !== 'object' || ancestors.has(value)) return false;
    if (
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
      return false;
    if (Reflect.ownKeys(value).length > 4097 || Object.getOwnPropertySymbols(value).length)
      return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.values(descriptors).some((descriptor) => !('value' in descriptor))) return false;
    ancestors.add(value);
    let valid = true;
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) {
        if (visit(value[index], depth + 1)) continue;
        valid = false;
        break;
      }
    } else valid = Object.values(value).every((entry) => visit(entry, depth + 1));
    ancestors.delete(value);
    return valid;
  };
  if (!visit(data, 0))
    return ['Playout data must be JSON-safe, with at most 4096 values and 16 nested levels.'];
  if (
    new TextEncoder().encode(JSON.stringify(data)).byteLength > MAX_VISUAL_RULE_PLAYOUT_DATA_BYTES
  )
    return ['Playout data must not exceed 64 KiB.'];
  return [];
}

function truthy(value: unknown): boolean {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized !== '' && normalized !== 'false' && normalized !== '0' && normalized !== 'no';
  }
  return Boolean(value);
}

const NUMERIC_FIELD_TYPES = new Set<FieldType>(['number', 'integer', 'duration-ms', 'percentage']);

/** An authored `set` value (often text from an input box) as the field's own type. */
export function coerceVisualRuleSetDataValue(fieldType: FieldType, value: unknown): unknown {
  if (NUMERIC_FIELD_TYPES.has(fieldType)) {
    const number = numeric(value) ?? 0;
    return fieldType === 'integer' ? Math.round(number) : number;
  }
  if (fieldType === 'boolean') return truthy(value);
  if (value === undefined || value === null) return '';
  return typeof value === 'object' ? value : String(value);
}

/**
 * The next value of a field changed by a `set-data` action. Toggle flips a yes/no value;
 * increase/decrease step a number (missing or non-numeric counts as 0) by `value`, default 1.
 */
export function visualRuleSetDataValue(
  action: Pick<Extract<VisualRuleAction, { type: 'set-data' }>, 'mode' | 'value'>,
  current: unknown,
): unknown {
  if (action.mode === 'set') return action.value;
  if (action.mode === 'toggle') return !truthy(current);
  const step = numeric(action.value) ?? 1;
  const base = numeric(current) ?? 0;
  return action.mode === 'increase' ? base + step : base - step;
}

export interface VisualRuleConditionLike {
  sourcePath: string[];
  operator: VisualRuleOperator;
  value?: unknown;
  compareSourcePath?: string[];
  ignoreCase?: boolean;
}

export interface VisualRuleLike<
  C extends VisualRuleConditionLike = VisualRuleConditionLike,
> extends VisualRuleConditionLike {
  id: string;
  enabled: boolean;
  hostGroupId?: string;
  scopeLayerIds?: string[];
  trigger?: VisualRuleTrigger;
  timerAlarm?: TimerAlarmTrigger;
  keyboard?: VisualRuleKeyboardTrigger;
  conditions?: C[];
  match?: VisualRuleMatch;
  eventId?: string;
  delayFrames?: number;
  actions: VisualRuleAction[];
}

export function visualRuleTrigger(rule: { trigger?: VisualRuleTrigger }): VisualRuleTrigger {
  return rule.trigger ?? 'data';
}

/** The primary condition belongs to data rules only; other triggers use `conditions` as a guard. */
export function visualRuleConditions<C extends VisualRuleConditionLike>(
  rule: VisualRuleLike<C> & C,
): C[] {
  return visualRuleTrigger(rule) === 'data'
    ? [rule, ...(rule.conditions ?? [])]
    : [...(rule.conditions ?? [])];
}

/** A data rule that watches for a change is an event, like a click, rather than a state. */
export function isVisualRuleEdgeDataRule<C extends VisualRuleConditionLike>(
  rule: VisualRuleLike<C> & C,
): boolean {
  return (
    visualRuleTrigger(rule) === 'data' &&
    visualRuleConditions(rule).some((condition) =>
      VISUAL_RULE_EVENT_OPERATORS.has(condition.operator),
    )
  );
}

/** State rules hold their visibility/property actions only while they match. */
export function isVisualRuleState<C extends VisualRuleConditionLike>(
  rule: VisualRuleLike<C> & C,
): boolean {
  const trigger = visualRuleTrigger(rule);
  return trigger === 'hover' || (trigger === 'data' && !isVisualRuleEdgeDataRule(rule));
}

/* ------------------------------------------------------------------------------------------------
 * Engine
 * --------------------------------------------------------------------------------------------- */

/**
 * Reads condition operands from a data snapshot. The editor keys data by field id and the runtime
 * by field key, so each side supplies its own reader; `hostLayerId` lets a runtime-collection row
 * read its own item.
 */
export interface VisualRuleDataReader<C, D> {
  read(condition: C, hostLayerId: string, data: D): unknown;
  /** `null` when the condition compares with its literal value. */
  readCompare(condition: C, hostLayerId: string, data: D): { value: unknown } | null;
}

export interface VisualRuleHost<R> {
  layerId: string;
  rules: readonly R[];
}

export interface VisualRuleEngine<C extends VisualRuleConditionLike, R, D> {
  hosts: readonly VisualRuleHost<R>[];
  reader: VisualRuleDataReader<C, D>;
  /** Maps an authored action target to the rendered layer ids it drives. */
  resolveTarget?: (targetLayerId: string, hostLayerId: string) => string[];
  /** The layers of an editor group; compiled packages expand group targets instead. */
  resolveGroup?: (groupId: string) => string[];
}

/** Paint and visibility produced by rules for one target layer. */
export interface VisualRuleEffect {
  properties: Record<string, unknown>;
  visibility?: boolean;
  /** Transition length in frames per property; `VISUAL_RULE_VISIBILITY_KEY` for visibility. */
  transitionFrames: Record<string, number>;
}

export const VISUAL_RULE_VISIBILITY_KEY = '@visibility';

export type VisualRuleEffects = ReadonlyMap<string, VisualRuleEffect>;

export interface FiredVisualRule<R> {
  hostLayerId: string;
  rule: R;
}

function conditionMatches<C extends VisualRuleConditionLike, D>(
  reader: VisualRuleDataReader<C, D>,
  condition: C,
  hostLayerId: string,
  current: D,
  previous: D | undefined,
): boolean {
  const compare = reader.readCompare(condition, hostLayerId, current);
  const value = reader.read(condition, hostLayerId, current);
  const primaryKey =
    'fieldId' in condition
      ? condition.fieldId
      : 'dataKey' in condition
        ? condition.dataKey
        : undefined;
  const compareKey =
    'compareFieldId' in condition
      ? condition.compareFieldId
      : 'compareDataKey' in condition
        ? condition.compareDataKey
        : undefined;
  const previousValue =
    previous === undefined ? undefined : reader.read(condition, hostLayerId, previous);
  // Virtual mouse operands have no value before entry or after leaving the composition.
  // They must not match even negative/empty comparisons, nor manufacture a first movement.
  if (
    isVisualRuleMouseFieldId(primaryKey) &&
    (typeof value !== 'number' ||
      !Number.isFinite(value) ||
      (VISUAL_RULE_EVENT_OPERATORS.has(condition.operator) &&
        (typeof previousValue !== 'number' || !Number.isFinite(previousValue))))
  )
    return false;
  if (
    isVisualRuleMouseFieldId(compareKey) &&
    (!compare || typeof compare.value !== 'number' || !Number.isFinite(compare.value))
  )
    return false;
  return visualRuleMatches(
    condition.operator,
    value,
    compare ? compare.value : condition.value,
    previousValue,
    { ignoreCase: condition.ignoreCase ?? false },
  );
}

/** Whether a rule's conditions hold; a rule without conditions (an unguarded event) holds. */
export function visualRuleConditionsHold<C extends VisualRuleConditionLike, D>(
  reader: VisualRuleDataReader<C, D>,
  rule: VisualRuleLike<C> & C,
  hostLayerId: string,
  current: D,
  previous?: D,
): boolean {
  const conditions = visualRuleConditions(rule);
  if (conditions.length === 0) return true;
  const test = (condition: C) =>
    conditionMatches(reader, condition, hostLayerId, current, previous);
  return rule.match === 'any' ? conditions.some(test) : conditions.every(test);
}

export function visualRuleActionTargets<C extends VisualRuleConditionLike, R, D>(
  engine: VisualRuleEngine<C, R, D>,
  action: VisualRuleStateAction,
  hostLayerId: string,
  rule?: Pick<VisualRuleLike, 'hostGroupId' | 'scopeLayerIds'>,
): string[] {
  const targets = action.targetGroupId
    ? (engine.resolveGroup?.(action.targetGroupId) ?? [])
    : action.targetLayerId
      ? [action.targetLayerId]
      : visualRuleScopeLayerIds(engine, hostLayerId, rule);
  return engine.resolveTarget
    ? targets.flatMap((target) => engine.resolveTarget!(target, hostLayerId))
    : targets;
}

/** One owner for evaluation, with every member eligible for pointer and implicit object actions. */
export function visualRuleScopeLayerIds<C extends VisualRuleConditionLike, R, D>(
  engine: VisualRuleEngine<C, R, D>,
  hostLayerId: string,
  rule?: Pick<VisualRuleLike, 'hostGroupId' | 'scopeLayerIds'>,
): string[] {
  const members =
    rule?.scopeLayerIds ??
    (rule?.hostGroupId ? engine.resolveGroup?.(rule.hostGroupId) : undefined);
  return [...new Set(members ?? [hostLayerId])];
}

/** Layers of each editor group, for engines and validation that work from the layer list. */
export function visualRuleGroupMembers(
  layers: readonly { id: string; groupId?: string | null }[],
): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const layer of layers)
    if (layer.groupId) groups.set(layer.groupId, [...(groups.get(layer.groupId) ?? []), layer.id]);
  return groups;
}

function withAction(
  effect: VisualRuleEffect | undefined,
  action: Exclude<VisualRuleStateAction, { type: 'toggle-visibility' }>,
  visibility?: boolean,
): VisualRuleEffect {
  const next: VisualRuleEffect = {
    properties: { ...effect?.properties },
    ...(effect?.visibility === undefined ? {} : { visibility: effect.visibility }),
    transitionFrames: { ...effect?.transitionFrames },
  };
  const key =
    action.type === 'property'
      ? canonicalLayerRuleProperty(action.targetProperty)
      : VISUAL_RULE_VISIBILITY_KEY;
  if (action.type === 'property') next.properties[key] = action.value;
  else next.visibility = visibility ?? action.visible;
  if ((action.transitionFrames ?? 0) > 0) next.transitionFrames[key] = action.transitionFrames!;
  else delete next.transitionFrames[key];
  return next;
}

/**
 * Current state-rule output for every target layer. Rules apply in layer order, then rule order,
 * so a later rule wins a property that an earlier one also sets.
 */
export function collectVisualRuleStates<
  C extends VisualRuleConditionLike,
  R extends VisualRuleLike<C> & C,
  D,
>(
  engine: VisualRuleEngine<C, R, D>,
  data: D,
  hovered: ReadonlySet<string> = new Set(),
): Map<string, VisualRuleEffect> {
  const effects = new Map<string, VisualRuleEffect>();
  for (const host of engine.hosts) {
    for (const rule of host.rules) {
      if (!rule.enabled || !isVisualRuleState(rule)) continue;
      if (
        visualRuleTrigger(rule) === 'hover' &&
        !visualRuleScopeLayerIds(engine, host.layerId, rule).some((id) => hovered.has(id))
      )
        continue;
      if (!visualRuleConditionsHold(engine.reader, rule, host.layerId, data)) continue;
      for (const action of rule.actions) {
        if (!isVisualRuleStateAction(action) || action.type === 'toggle-visibility') continue;
        for (const target of visualRuleActionTargets(engine, action, host.layerId, rule))
          effects.set(target, withAction(effects.get(target), action));
      }
    }
  }
  return effects;
}

/**
 * Applies event-rule visibility/property actions to the persistent event overrides. A toggle flips
 * the target's visibility as the viewer currently sees it.
 */
export function applyVisualRuleEventActions<C extends VisualRuleConditionLike, R, D>(
  engine: VisualRuleEngine<C, R, D>,
  overrides: ReadonlyMap<string, VisualRuleEffect>,
  actions: readonly VisualRuleAction[],
  hostLayerId: string,
  visibleOf: (layerId: string) => boolean,
  rule?: Pick<VisualRuleLike, 'hostGroupId' | 'scopeLayerIds'>,
): Map<string, VisualRuleEffect> {
  const next = new Map(overrides);
  for (const action of actions) {
    if (!isVisualRuleStateAction(action)) continue;
    for (const target of visualRuleActionTargets(engine, action, hostLayerId, rule)) {
      if (action.type === 'toggle-visibility') {
        const current = next.get(target)?.visibility ?? visibleOf(target);
        next.set(
          target,
          withAction(
            next.get(target),
            {
              type: 'visibility',
              visible: !current,
              ...(action.transitionFrames ? { transitionFrames: action.transitionFrames } : {}),
            },
            !current,
          ),
        );
      } else next.set(target, withAction(next.get(target), action));
    }
  }
  return next;
}

/** Event overrides sit on top of state output. */
export function mergeVisualRuleEffects(
  state: VisualRuleEffect | undefined,
  override: VisualRuleEffect | undefined,
): VisualRuleEffect | undefined {
  if (!state) return override;
  if (!override) return state;
  const visibility = override.visibility ?? state.visibility;
  return {
    properties: { ...state.properties, ...override.properties },
    ...(visibility === undefined ? {} : { visibility }),
    transitionFrames: { ...state.transitionFrames, ...override.transitionFrames },
  };
}

function stateRuleHolds<C extends VisualRuleConditionLike, R extends VisualRuleLike<C> & C, D>(
  engine: VisualRuleEngine<C, R, D>,
  host: VisualRuleHost<R>,
  rule: R,
  data: D,
  hovered: ReadonlySet<string>,
): boolean {
  if (
    visualRuleTrigger(rule) === 'hover' &&
    !visualRuleScopeLayerIds(engine, host.layerId, rule).some((id) => hovered.has(id))
  )
    return false;
  return visualRuleConditionsHold(engine.reader, rule, host.layerId, data);
}

/**
 * Latest wins: when a state rule starts matching, it takes back the properties and visibility an
 * earlier event wrote for the same targets. Without this, one click or score change would mask a
 * data rule for the rest of the playout.
 */
export function releaseVisualRuleOverrides<
  C extends VisualRuleConditionLike,
  R extends VisualRuleLike<C> & C,
  D,
>(
  engine: VisualRuleEngine<C, R, D>,
  overrides: ReadonlyMap<string, VisualRuleEffect>,
  previous: { data: D; hovered?: ReadonlySet<string> },
  current: { data: D; hovered?: ReadonlySet<string> },
): Map<string, VisualRuleEffect> {
  const next = new Map(overrides);
  if (next.size === 0) return next;
  for (const host of engine.hosts) {
    for (const rule of host.rules) {
      if (!rule.enabled || !isVisualRuleState(rule)) continue;
      const before = stateRuleHolds(
        engine,
        host,
        rule,
        previous.data,
        previous.hovered ?? new Set(),
      );
      const after = stateRuleHolds(engine, host, rule, current.data, current.hovered ?? new Set());
      if (before || !after) continue;
      for (const action of rule.actions) {
        if (!isVisualRuleStateAction(action) || action.type === 'toggle-visibility') continue;
        for (const target of visualRuleActionTargets(engine, action, host.layerId, rule)) {
          const effect = next.get(target);
          if (!effect) continue;
          const released: VisualRuleEffect = {
            properties: { ...effect.properties },
            ...(effect.visibility === undefined ? {} : { visibility: effect.visibility }),
            transitionFrames: { ...effect.transitionFrames },
          };
          if (action.type === 'property')
            delete released.properties[canonicalLayerRuleProperty(action.targetProperty)];
          else delete released.visibility;
          if (Object.keys(released.properties).length === 0 && released.visibility === undefined)
            next.delete(target);
          else next.set(target, released);
        }
      }
    }
  }
  return next;
}

/**
 * Data-driven firing between two snapshots: change-watching rules whose conditions now hold, and
 * state rules that just started matching (their side-effect actions, such as sounds, run once).
 */
export function firedVisualRuleDataRules<
  C extends VisualRuleConditionLike,
  R extends VisualRuleLike<C> & C,
  D,
>(
  engine: VisualRuleEngine<C, R, D>,
  current: D,
  previous: D,
): Array<FiredVisualRule<R> & { entered: boolean }> {
  const fired: Array<FiredVisualRule<R> & { entered: boolean }> = [];
  for (const host of engine.hosts) {
    for (const rule of host.rules) {
      if (!rule.enabled || visualRuleTrigger(rule) !== 'data') continue;
      if (isVisualRuleEdgeDataRule(rule)) {
        if (visualRuleConditionsHold(engine.reader, rule, host.layerId, current, previous))
          fired.push({ hostLayerId: host.layerId, rule, entered: false });
      } else if (
        visualRuleConditionsHold(engine.reader, rule, host.layerId, current) &&
        !visualRuleConditionsHold(engine.reader, rule, host.layerId, previous)
      ) {
        fired.push({ hostLayerId: host.layerId, rule, entered: true });
      }
    }
  }
  return fired;
}

/**
 * Event rules answering one trigger. Pointer triggers belong to the layer under the pointer;
 * lifecycle triggers are global and may name a step or custom action in `eventId`. Timer alarms
 * use the explicit timer source plus the rule id; retargeting the owner never changes the source.
 */
export function firedVisualRuleEventRules<
  C extends VisualRuleConditionLike,
  R extends VisualRuleLike<C> & C,
  D,
>(
  engine: VisualRuleEngine<C, R, D>,
  trigger: Exclude<VisualRuleTrigger, 'data' | 'hover'>,
  data: D,
  scope: {
    hostLayerId?: string;
    relatedHostLayerId?: string;
    eventId?: string;
    /** Timer alarm rule IDs are local to their owner; this disambiguates equal IDs on two hosts. */
    timerAlarmOwnerLayerId?: string;
    keyboard?: VisualRuleKeyboardInput;
  } = {},
): FiredVisualRule<R>[] {
  const fired: FiredVisualRule<R>[] = [];
  for (const host of engine.hosts) {
    for (const rule of host.rules) {
      if (!rule.enabled || visualRuleTrigger(rule) !== trigger) continue;
      if (
        isVisualRuleKeyboardTrigger(trigger) &&
        !visualRuleKeyboardMatches(
          rule.keyboard,
          trigger === 'key-up' && scope.keyboard
            ? { ...scope.keyboard, repeat: false }
            : scope.keyboard,
        )
      )
        continue;
      if (
        trigger === 'timer-alarm' &&
        (!rule.timerAlarm ||
          rule.timerAlarm.sourceLayerId !== scope.hostLayerId ||
          rule.id !== scope.eventId ||
          (scope.timerAlarmOwnerLayerId !== undefined &&
            scope.timerAlarmOwnerLayerId !== host.layerId))
      )
        continue;
      if (
        trigger !== 'timer-alarm' &&
        scope.hostLayerId !== undefined &&
        !visualRuleScopeLayerIds(engine, host.layerId, rule).includes(scope.hostLayerId)
      )
        continue;
      if (
        (trigger === 'pointer-enter' || trigger === 'pointer-leave') &&
        scope.hostLayerId !== undefined &&
        scope.relatedHostLayerId !== undefined &&
        visualRuleScopeLayerIds(engine, host.layerId, rule).includes(scope.relatedHostLayerId)
      )
        continue;
      if (
        (trigger === 'step' || trigger === 'custom-action') &&
        rule.eventId &&
        rule.eventId !== scope.eventId
      )
        continue;
      if (!visualRuleConditionsHold(engine.reader, rule, host.layerId, data)) continue;
      fired.push({ hostLayerId: host.layerId, rule });
    }
  }
  return fired;
}

/* ------------------------------------------------------------------------------------------------
 * Transitions
 * --------------------------------------------------------------------------------------------- */

type Rgba = [number, number, number, number];

function parseHexColor(value: unknown): Rgba | null {
  if (typeof value !== 'string') return null;
  const match = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value.trim());
  if (!match) return null;
  let hex = match[1]!;
  if (hex.length <= 4) hex = [...hex].map((digit) => digit + digit).join('');
  const channel = (index: number) => parseInt(hex.slice(index, index + 2), 16);
  return [channel(0), channel(2), channel(4), hex.length === 8 ? channel(6) : 255];
}

function formatHexColor([r, g, b, a]: Rgba): string {
  const hex = (value: number) =>
    Math.round(Math.min(255, Math.max(0, value)))
      .toString(16)
      .padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}${a >= 255 ? '' : hex(a)}`;
}

/** Smooth start and finish for rule transitions. */
export function visualRuleTransitionEase(progress: number): number {
  const t = Math.min(1, Math.max(0, progress));
  return t * t * (3 - 2 * t);
}

/**
 * Blends two rule values. Numbers, numeric text, hex colours and numeric vectors (shader colours)
 * interpolate; anything else switches to the target immediately.
 */
export function interpolateVisualRuleValue(from: unknown, to: unknown, progress: number): unknown {
  const t = visualRuleTransitionEase(progress);
  if (t >= 1) return to;
  if (typeof from === 'number' && typeof to === 'number') return from + (to - from) * t;
  const fromColor = parseHexColor(from);
  const toColor = parseHexColor(to);
  if (fromColor && toColor)
    return formatHexColor(
      fromColor.map((channel, index) => channel + (toColor[index]! - channel) * t) as Rgba,
    );
  if (
    Array.isArray(from) &&
    Array.isArray(to) &&
    from.length === to.length &&
    from.every((entry) => typeof entry === 'number') &&
    to.every((entry) => typeof entry === 'number')
  )
    return from.map((entry, index) => entry + ((to[index] as number) - entry) * t);
  const a = numeric(from);
  const b = numeric(to);
  if (a !== null && b !== null && typeof to === 'string') return String(a + (b - a) * t);
  return to;
}

/* ------------------------------------------------------------------------------------------------
 * Authoring
 * --------------------------------------------------------------------------------------------- */

export function createVisualRuleCondition(
  overrides: Partial<VisualRuleCondition> = {},
): VisualRuleCondition {
  return {
    fieldId: overrides.fieldId ?? '',
    sourcePath: overrides.sourcePath ?? [],
    operator: overrides.operator ?? 'equals',
    ...(overrides.value !== undefined ? { value: overrides.value } : {}),
    ...(overrides.compareFieldId ? { compareFieldId: overrides.compareFieldId } : {}),
    ...(overrides.compareSourcePath?.length
      ? { compareSourcePath: overrides.compareSourcePath }
      : {}),
    ...(overrides.ignoreCase ? { ignoreCase: true } : {}),
  };
}

export function createLayerVisualRule(overrides: Partial<LayerVisualRule> = {}): LayerVisualRule {
  return {
    id: overrides.id ?? createScopedUuid(),
    name: overrides.name ?? 'Rule #1',
    enabled: overrides.enabled ?? true,
    ...(overrides.hostGroupId ? { hostGroupId: overrides.hostGroupId } : {}),
    trigger: overrides.trigger ?? 'data',
    ...(overrides.timerAlarm ? { timerAlarm: { ...overrides.timerAlarm } } : {}),
    ...(overrides.keyboard
      ? {
          keyboard: {
            ...overrides.keyboard,
            key: normalizeVisualRuleKeyboardKey(overrides.keyboard.key),
          },
        }
      : {}),
    fieldId: overrides.fieldId ?? '',
    sourcePath: overrides.sourcePath ?? [],
    operator: overrides.operator ?? 'equals',
    ...(overrides.value !== undefined ? { value: overrides.value } : {}),
    ...(overrides.compareFieldId ? { compareFieldId: overrides.compareFieldId } : {}),
    ...(overrides.compareSourcePath?.length
      ? { compareSourcePath: overrides.compareSourcePath }
      : {}),
    ...(overrides.ignoreCase ? { ignoreCase: true } : {}),
    ...(overrides.conditions?.length ? { conditions: overrides.conditions } : {}),
    ...(overrides.match ? { match: overrides.match } : {}),
    ...(overrides.eventId ? { eventId: overrides.eventId } : {}),
    ...(overrides.delayFrames ? { delayFrames: overrides.delayFrames } : {}),
    actions: overrides.actions ?? [{ type: 'visibility', visible: true }],
  };
}

/**
 * Fills the keys agents may omit (field, path, operator) so a rule arriving through an operation
 * has the complete document shape.
 */
export function normalizeLayerVisualRule(
  rule: Omit<LayerVisualRule, 'fieldId' | 'sourcePath' | 'operator' | 'conditions'> &
    Partial<Pick<LayerVisualRule, 'fieldId' | 'sourcePath' | 'operator'>> & {
      conditions?: Array<Partial<VisualRuleCondition> & { fieldId?: string }>;
    },
): LayerVisualRule {
  const condition = <C extends Partial<VisualRuleCondition>>(source: C) => ({
    ...source,
    fieldId: source.fieldId ?? '',
    sourcePath: source.sourcePath ?? [],
    operator: source.operator ?? 'equals',
  });
  return {
    ...condition(rule),
    ...(rule.keyboard
      ? {
          keyboard: {
            ...rule.keyboard,
            key: normalizeVisualRuleKeyboardKey(rule.keyboard.key),
          },
        }
      : {}),
    ...(rule.conditions ? { conditions: rule.conditions.map(condition) } : {}),
  } as LayerVisualRule;
}

/** Every data field a rule reads or changes, including comparison fields and extra conditions. */
export function visualRuleFieldIds(rule: LayerVisualRule): string[] {
  const ids = [
    ...visualRuleConditions(rule).flatMap((condition) => [
      condition.fieldId,
      ...(condition.compareFieldId ? [condition.compareFieldId] : []),
    ]),
    ...rule.actions.flatMap((action) => (action.type === 'set-data' ? [action.fieldId] : [])),
  ];
  return [...new Set(ids.filter((id) => Boolean(id) && !isVisualRuleMouseFieldId(id)))];
}

/** Every other layer a rule's actions drive. */
export function visualRuleTargetLayerIds(rule: LayerVisualRule): string[] {
  return [
    ...new Set(
      rule.actions.flatMap((action) =>
        isVisualRuleStateAction(action) && action.targetLayerId ? [action.targetLayerId] : [],
      ),
    ),
  ];
}

/** Every layer a rule refers to, including its timer source and action targets. */
export function visualRuleReferencedLayerIds(rule: LayerVisualRule): string[] {
  return [
    ...new Set([
      ...(rule.trigger === 'timer-alarm' && rule.timerAlarm?.sourceLayerId
        ? [rule.timerAlarm.sourceLayerId]
        : []),
      ...visualRuleTargetLayerIds(rule),
    ]),
  ];
}

/** Validate authored alarm data before it enters a document; playback must not repair thresholds. */
export function validateTimerAlarmTrigger(
  value: unknown,
  layers?: readonly Pick<Layer, 'id' | 'isGuide' | 'element'>[],
): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return ['Timer alarm must specify a source, threshold and direction.'];
  const input = value as Record<string, unknown>;
  const errors: string[] = [];
  if (typeof input.sourceLayerId !== 'string' || !input.sourceLayerId.trim())
    errors.push('Timer alarm sourceLayerId must name a clock/timer layer.');
  else if (layers) {
    const source = layers.find((layer) => layer.id === input.sourceLayerId);
    if (!source || source.isGuide || source.element.type !== 'text' || !source.element.clock)
      errors.push('Timer alarm source must be an existing non-guide clock/timer layer.');
  }
  if (
    typeof input.thresholdMs !== 'number' ||
    !Number.isFinite(input.thresholdMs) ||
    input.thresholdMs < 0 ||
    input.thresholdMs > MAX_TIMER_VALUE_MS
  )
    errors.push(
      'Timer alarm thresholdMs must be a non-negative finite duration of at most 100 years.',
    );
  if (input.direction !== 'up' && input.direction !== 'down')
    errors.push('Timer alarm direction must be up or down.');
  return errors;
}

/**
 * A copy for a duplicated layer or component instance: fresh id, and layer/field references
 * pointed at their copies. References outside the maps are kept.
 */
export function remapVisualRule(
  rule: LayerVisualRule,
  maps: {
    layerIds?: ReadonlyMap<string, string>;
    fieldIds?: ReadonlyMap<string, string>;
    groupIds?: ReadonlyMap<string, string>;
    id?: string;
  } = {},
): LayerVisualRule {
  const field = (id: string) =>
    isVisualRuleMouseFieldId(id) ? id : (maps.fieldIds?.get(id) ?? id);
  const condition = <C extends VisualRuleCondition>(source: C): C => ({
    ...source,
    fieldId: source.fieldId ? field(source.fieldId) : source.fieldId,
    ...(source.compareFieldId ? { compareFieldId: field(source.compareFieldId) } : {}),
  });
  const copy = structuredClone(rule);
  const actionId = (id: string) =>
    maps.layerIds ? remapClockTimerActionId(id, maps.layerIds) : id;
  return {
    ...condition(copy),
    id: maps.id ?? createId('visual-rule'),
    ...(copy.hostGroupId
      ? { hostGroupId: maps.groupIds?.get(copy.hostGroupId) ?? copy.hostGroupId }
      : {}),
    ...(copy.conditions ? { conditions: copy.conditions.map(condition) } : {}),
    ...(copy.timerAlarm
      ? {
          timerAlarm: {
            ...copy.timerAlarm,
            sourceLayerId:
              maps.layerIds?.get(copy.timerAlarm.sourceLayerId) ?? copy.timerAlarm.sourceLayerId,
          },
        }
      : {}),
    ...(copy.trigger === 'custom-action' && copy.eventId
      ? { eventId: actionId(copy.eventId) }
      : {}),
    actions: copy.actions.map((action) =>
      isVisualRuleStateAction(action) && action.targetGroupId
        ? {
            ...action,
            targetGroupId: maps.groupIds?.get(action.targetGroupId) ?? action.targetGroupId,
          }
        : isVisualRuleStateAction(action) && action.targetLayerId
          ? {
              ...action,
              targetLayerId: maps.layerIds?.get(action.targetLayerId) ?? action.targetLayerId,
            }
          : action.type === 'custom-action' || action.type === 'shader-animation'
            ? { ...action, actionId: actionId(action.actionId) }
            : action.type === 'set-data' && action.fieldId
              ? { ...action, fieldId: field(action.fieldId) }
              : action,
    ),
  };
}

/**
 * Removes rule parts that point at deleted layers, fields, custom actions, media cues or steps,
 * then drops rules left without a trigger source or actions. Mutates the composition.
 */
export function pruneVisualRuleReferences(
  composition: Pick<
    Composition,
    'layers' | 'dataFields' | 'customActions' | 'mediaCues' | 'keyframes'
  >,
): void {
  const layerIds = new Set(composition.layers.map((layer) => layer.id));
  const timerIds = new Set(
    composition.layers.flatMap((layer) =>
      !layer.isGuide && layer.element.type === 'text' && layer.element.clock ? [layer.id] : [],
    ),
  );
  const groupIds = new Set(visualRuleGroupMembers(composition.layers).keys());
  const fieldIds = new Set(composition.dataFields.map((field) => field.id));
  const actionIds = new Set(composition.customActions.map((action) => action.actionId));
  for (const layer of composition.layers) {
    if (layer.isGuide || layer.element.type !== 'text' || !layer.element.clock) continue;
    for (const command of ['start', 'pause', 'reset', 'restart'] as const)
      actionIds.add(clockTimerActionId(layer.id, command));
  }
  const cueIds = new Set((composition.mediaCues ?? []).map((cue) => cue.id));
  const stepIds = new Set(
    composition.keyframes
      .filter((keyframe) => keyframe.role === 'step')
      .map((keyframe) => keyframe.id),
  );
  // Blank references are rules still being authored; only references to deleted things go.
  const missing = (id: string | undefined, known: ReadonlySet<string>) =>
    Boolean(id) && !known.has(id!);
  const keepCondition = (condition: VisualRuleCondition): VisualRuleCondition | null => {
    if (!isVisualRuleMouseFieldId(condition.fieldId) && missing(condition.fieldId, fieldIds))
      return null;
    if (
      !isVisualRuleMouseFieldId(condition.compareFieldId) &&
      missing(condition.compareFieldId, fieldIds)
    ) {
      const { compareFieldId: _field, compareSourcePath: _path, ...literal } = condition;
      return literal;
    }
    return condition;
  };
  for (const layer of composition.layers) {
    if (!layer.visualRules?.length) continue;
    layer.visualRules = layer.visualRules.flatMap((rule) => {
      const trigger = visualRuleTrigger(rule);
      let next: LayerVisualRule = rule;
      if (
        trigger === 'timer-alarm' &&
        (!rule.timerAlarm || !timerIds.has(rule.timerAlarm.sourceLayerId))
      )
        return [];
      if (trigger === 'data') {
        const primary = keepCondition(rule);
        if (!primary) return [];
        next = { ...next, ...primary };
        if (!primary.compareFieldId) {
          delete next.compareFieldId;
          delete next.compareSourcePath;
        }
      }
      if (trigger === 'custom-action' && missing(rule.eventId, actionIds)) return [];
      if (trigger === 'step' && missing(rule.eventId, stepIds)) return [];
      if (rule.conditions) {
        const conditions = rule.conditions.flatMap((condition) => {
          const kept = keepCondition(condition);
          return kept ? [kept] : [];
        });
        next = { ...next, conditions };
        if (conditions.length === 0) delete next.conditions;
      }
      // Ungrouping preserves the rule on its canonical object; a deleted group cannot stay its owner.
      if (
        rule.hostGroupId &&
        (!groupIds.has(rule.hostGroupId) || layer.groupId !== rule.hostGroupId)
      ) {
        next = { ...next };
        delete next.hostGroupId;
      }
      const actions = rule.actions.filter((action) => {
        if (isVisualRuleStateAction(action))
          return (
            !missing(action.targetLayerId, layerIds) && !missing(action.targetGroupId, groupIds)
          );
        if (action.type === 'custom-action' || action.type === 'shader-animation')
          return !missing(action.actionId, actionIds);
        if (action.type === 'set-data') return !missing(action.fieldId, fieldIds);
        // Set-level references are resolved when the set is validated, not when local media changes.
        if (action.type === 'playout') return true;
        return !missing(action.cueId, cueIds);
      });
      // Alarm properties can create a linked rule before its actions have been chosen.
      if (actions.length === 0 && !(trigger === 'timer-alarm' && rule.actions.length === 0))
        return [];
      return [actions.length === rule.actions.length ? next : { ...next, actions }];
    });
  }
}

/**
 * Keeps a group-owned rule when deleting its storage object. Call before filtering all removed
 * layers in one batch; deleting the whole group never copies its rules elsewhere.
 */
export function rehomeVisualRuleGroupOwners(
  layers: Layer[],
  removingLayerIds: ReadonlySet<string>,
): void {
  for (const source of layers) {
    if (!removingLayerIds.has(source.id) || !source.groupId || !source.visualRules?.length)
      continue;
    const members = layers.filter(
      (candidate) =>
        !removingLayerIds.has(candidate.id) &&
        !candidate.isGuide &&
        candidate.groupId === source.groupId,
    );
    // Locking protects direct editing, not lifecycle maintenance when another object is removed.
    const destination = members.find((candidate) => !candidate.isLocked) ?? members[0];
    if (!destination) continue;
    const moving = source.visualRules.filter((rule) => rule.hostGroupId === source.groupId);
    if (!moving.length) continue;
    destination.visualRules = [...(destination.visualRules ?? []), ...moving];
    source.visualRules = source.visualRules.filter((rule) => rule.hostGroupId !== source.groupId);
  }
}

/** Follows a custom action's public id when it is renamed. Mutates the layers. */
export function renameVisualRuleCustomAction(
  layers: readonly { visualRules?: LayerVisualRule[] }[],
  previousActionId: string,
  nextActionId: string,
): void {
  for (const layer of layers) {
    for (const rule of layer.visualRules ?? []) {
      if (rule.trigger === 'custom-action' && rule.eventId === previousActionId)
        rule.eventId = nextActionId;
      for (const action of rule.actions) {
        if (
          (action.type === 'custom-action' || action.type === 'shader-animation') &&
          action.actionId === previousActionId
        )
          action.actionId = nextActionId;
      }
    }
  }
}
