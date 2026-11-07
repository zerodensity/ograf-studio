import { visualRulePlayoutDataErrors } from './visualRules';
import {
  transitionAnimationCatalogErrors,
  transitionContentAnimationErrors,
} from './transitionContentAnimation';
import type {
  AnimationPresetPluginSnapshot,
  LayerMotionSpec,
  StudioPluginReference,
} from './types';

/** Portable authoring definitions for coordinated template-set playout. */
export const TRANSITION_LOGIC_VERSION = 6 as const;

export type TransitionLogicData = Record<string, unknown>;
/**
 * How a lane applies a data change that keeps its state. `transition` mounts the template again and
 * plays the update recipe. `in-place` changes the content on the mounted template, so it needs no
 * second host; changed layers use their own Data change transition.
 */
export const TRANSITION_LOGIC_UPDATE_MODES = ['transition', 'in-place'] as const;
export type TransitionLogicUpdateMode = (typeof TRANSITION_LOGIC_UPDATE_MODES)[number];
export type TransitionLogicPropertyValue = number | string | boolean;
export const TRANSITION_LOGIC_RESIZE_ANCHORS = [
  'top-left',
  'top-center',
  'top-right',
  'center-left',
  'center',
  'center-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
] as const;
export type TransitionLogicResizeAnchor = (typeof TRANSITION_LOGIC_RESIZE_ANCHORS)[number];

export interface TransitionLogicSharedValue {
  instanceId: string;
  sourceLayerId: string;
  property: string;
  value: TransitionLogicPropertyValue;
  /**
   * Authoring-only: a state value deliberately differs from where its template places the
   * element. Unmarked state values are expected to follow the template layout.
   */
  override?: true;
  /** Authoring choice on a layout width offset; geometry remains encoded in the offsets. */
  resizeAnchor?: TransitionLogicResizeAnchor;
}

export interface TransitionLogicSharedInstance {
  id: string;
  name: string;
  componentAssetId: string;
  continuityKey: string;
  /** Omitted for a shared scene instance that belongs to the whole output. */
  slotId?: string;
}

export interface TransitionLogicSlot {
  id: string;
  name: string;
  order: number;
  defaultTransitionId?: string;
  updateTransitionId?: string;
  /** Requires version 6. Omitted means `transition`, the authored update recipe. */
  updateMode?: TransitionLogicUpdateMode;
  /** Opt-in lifecycle dependency: Out/Clear of this parent also resets this slot. */
  parentSlotId?: string;
  /** Explicit Take admission; independent from the Out/Clear lifecycle dependency above. */
  admission?: {
    /** Every listed lane must have finished entering and must not be leaving. */
    requireOnSlotIds?: string[];
    /** Every listed lane must be fully Off, including preparation and its complete exit. */
    blockWhileActiveSlotIds?: string[];
  };
}

export interface TransitionLogicState {
  id: string;
  name: string;
  slotId: string;
  templateId: string;
  family?: string;
  /** Optional editorial preset for a state; explicit operator data and retained edits win. */
  dataDefaults?: TransitionLogicData;
  sharedValues?: TransitionLogicSharedValue[];
  /** Prepare this state, then take these lanes and their dependents fully out before entering. */
  takeOutSlotIds?: string[];
}

export interface TransitionLogicRecipe {
  id: string;
  name: string;
  durationFrames: number;
  outgoingFrames: number;
  incomingStartFrame: number;
  incomingFrames: number;
  sharedFrames: number;
  easing: 'linear' | 'ease-in-out' | 'ease-out';
  /** Timing of this slot's occupancy for responsive layout rules; omitted follows content opacity. */
  layoutPhase?: { startFrame: number; durationFrames: number };
  /** How template content leaves and arrives; authored preserves each layer's own animation. */
  contentMotion?: TransitionLogicContentMotion;
  /** Overrides only this recipe's non-shared incoming content; omitted preserves legacy style. */
  incomingAnimation?: TransitionLogicContentAnimation;
  /** Overrides only this recipe's non-shared outgoing content; shared objects still morph. */
  outgoingAnimation?: TransitionLogicContentAnimation;
}

export type TransitionLogicContentAnimation =
  | { type: 'template' }
  | { type: 'builtin'; motion: Omit<LayerMotionSpec, 'durationFrames' | 'offsetFrames'> }
  | {
      type: 'plugin';
      reference: StudioPluginReference;
      presetId: string;
      parameters?: Record<string, number>;
    };

export const TRANSITION_LOGIC_CONTENT_MOTIONS = ['fade', 'slide', 'wipe', 'authored'] as const;
export type TransitionLogicContentMotion = (typeof TRANSITION_LOGIC_CONTENT_MOTIONS)[number];

export interface TransitionLogicRoute {
  id: string;
  slotId: string;
  /** null is Off; '*' matches any state, including Off. */
  from: string | null;
  to: string | null;
  transitionId: string;
  priority: number;
}

/** A slot adjusts its own shared layout while another slot occupies the output. */
export interface TransitionLogicLayoutRule {
  id: string;
  name: string;
  slotId: string;
  whenSlotId: string;
  /** Additive x/y/width/height offsets at full occupancy; Off contributes zero. */
  sharedOffsets: TransitionLogicSharedValue[];
}

export interface TransitionLogicDefinition {
  version: 1 | 2 | 3 | 4 | 5 | typeof TRANSITION_LOGIC_VERSION;
  id: string;
  name: string;
  slots: TransitionLogicSlot[];
  states: TransitionLogicState[];
  transitions: TransitionLogicRecipe[];
  routes: TransitionLogicRoute[];
  sharedInstances: TransitionLogicSharedInstance[];
  initialSharedValues: TransitionLogicSharedValue[];
  defaultTransitionId: string;
  layoutRules?: TransitionLogicLayoutRule[];
  /** A rundown to rehearse in the editor; playout ignores it. Steps for removed lanes are skipped. */
  rehearsal?: TransitionLogicRehearsalStep[];
  /** Immutable data-only preset packs pinned once for portable transition-specific animations. */
  animationPresetPlugins?: AnimationPresetPluginSnapshot[];
}

/** Take a template in its lane, or take the lane off (stateId null). */
export interface TransitionLogicRehearsalStep {
  slotId: string;
  stateId: string | null;
}

export interface TransitionLogicSelection {
  requestId: string;
  instanceId: string;
  stateId: string;
  templateId: string;
  data: TransitionLogicData;
}

export interface TransitionLogicRequest {
  requestId: string;
  slotId: string;
  stateId: string | null;
  data?: TransitionLogicData;
}

export interface TransitionLogicPlan {
  id: string;
  requestId: string;
  slotId: string;
  from: TransitionLogicSelection | null;
  to: TransitionLogicSelection | null;
  transitionId: string;
  startFrame: number;
  endFrame: number;
  sharedFrom: TransitionLogicSharedValue[];
  sharedTo: TransitionLogicSharedValue[];
}

export interface TransitionLogicPending {
  request: TransitionLogicRequest;
  selection: TransitionLogicSelection | null;
  ready: boolean;
}

export interface TransitionLogicSlotSession {
  desired: TransitionLogicSelection | null;
  settled: TransitionLogicSelection | null;
  transition: TransitionLogicPlan | null;
  pending: TransitionLogicPending | null;
  readiness: 'idle' | 'preparing' | 'ready' | 'failed';
  error: string | null;
  sharedValues: TransitionLogicSharedValue[];
  /** Exit barrier and occupied layout captured when a parent takes its dependents out. */
  outCascade?: { slotIds: string[]; layoutOccupancy: Record<string, number> };
  /** Entry barrier; leaving this state never restores the lanes it took out. */
  takeover?: { requestId: string; outSlotIds: string[]; dispatching?: true };
}

export interface TransitionLogicSession {
  definitionId: string;
  /** SHA-256 of the definition snapshot; authoring edits require a new session. */
  definitionRevision: string;
  frame: number;
  slots: Record<string, TransitionLogicSlotSession>;
  /** A bounded replay guard; request IDs belong to the caller, never random sampling. */
  recentRequestIds: string[];
}

/** Read-only preflight. A rejected Take never creates preparation, occupancy, or queued intent. */
export function transitionLogicAdmissionError(
  definition: TransitionLogicDefinition,
  session: TransitionLogicSession,
  slotId: string,
  stateId: string | null,
  preparedSlotIds: readonly string[] = [],
): string | null {
  if (stateId === null) return null;
  const slot = definition.slots.find((entry) => entry.id === slotId);
  const guard = slot?.admission;
  if (!guard) return null;
  const label = (id: string) => definition.slots.find((entry) => entry.id === id)?.name ?? id;
  for (const id of guard.requireOnSlotIds ?? []) {
    const required = session.slots[id];
    if (
      !required?.settled ||
      (required.transition !== null && required.transition.to === null) ||
      (required.pending !== null && required.pending.selection === null)
    )
      return `Cannot Take ${slot.name}: ${label(id)} must be On and have finished entering. Take it explicitly after ${label(id)} is On.`;
  }
  for (const id of guard.blockWhileActiveSlotIds ?? []) {
    const blocking = session.slots[id];
    if (
      preparedSlotIds.includes(id) ||
      blocking?.desired ||
      blocking?.settled ||
      blocking?.transition ||
      blocking?.pending
    )
      return `Cannot Take ${slot.name}: ${label(id)} must be fully Off, including preparation and exit. This Take has not been queued.`;
  }
  return null;
}

export type TransitionLogicEvent =
  | ({ type: 'request'; frame: number } & TransitionLogicRequest)
  | { type: 'ready'; frame: number; slotId: string; requestId: string }
  | { type: 'failed'; frame: number; slotId: string; requestId: string; message: string }
  | { type: 'advance'; frame: number }
  | { type: 'clear'; frame: number; slotId?: string };

export type TransitionLogicEffect =
  /**
   * Prepare this request's data snapshot without changing any visible instance. Same-state updates
   * reuse instanceId, so requestId identifies the staged version until a started effect commits it.
   */
  | { type: 'prepare'; slotId: string; selection: TransitionLogicSelection }
  /** Reset prepared activation intent for the actual Out requests before committing this entry. */
  | {
      type: 'takeover';
      frame: number;
      slotId: string;
      requestId: string;
      outSlotIds: string[];
      outRequestIds: string[];
    }
  | { type: 'release'; slotId: string; instanceId: string }
  /** A once-valid preparation lost admission before committing; never retained as queued intent. */
  | { type: 'rejected'; slotId: string; requestId: string; message: string }
  | { type: 'started'; slotId: string; plan: TransitionLogicPlan }
  | { type: 'settled'; slotId: string; selection: TransitionLogicSelection | null };

export interface TransitionLogicResult {
  session: TransitionLogicSession;
  effects: TransitionLogicEffect[];
}

export interface TransitionLogicSlotSample {
  slotId: string;
  desired: TransitionLogicSelection | null;
  settled: TransitionLogicSelection | null;
  outgoing: TransitionLogicSelection | null;
  incoming: TransitionLogicSelection | null;
  outgoingOpacity: number;
  incomingOpacity: number;
  progress: number;
  sharedValues: TransitionLogicSharedValue[];
  transitionId: string | null;
  readiness: TransitionLogicSlotSession['readiness'];
  error: string | null;
}

export interface TransitionLogicSample {
  frame: number;
  slots: TransitionLogicSlotSample[];
  sharedValues: TransitionLogicSharedValue[];
}

export const TRANSITION_LOGIC_SHARED_PROPERTIES = [
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'opacity',
  'transformOriginX',
  'transformOriginY',
] as const;

export interface TransitionLogicReferences {
  templateIds?: readonly string[];
  componentLayers?: Readonly<Record<string, readonly string[]>>;
}

/** Explicit descendants only; layout relationships never imply a lifecycle dependency. */
export function transitionLogicDependentSlotIds(
  definition: TransitionLogicDefinition,
  parentSlotId: string,
): string[] {
  const found = new Set<string>([parentSlotId]);
  const result: string[] = [];
  for (let index = 0; index < found.size; index++) {
    const parent = [...found][index]!;
    for (const slot of definition.slots) {
      if (slot.parentSlotId !== parent || found.has(slot.id)) continue;
      found.add(slot.id);
      result.push(slot.id);
    }
  }
  return result;
}

export function transitionLogicOutSlotIds(
  definition: TransitionLogicDefinition,
  slotId: string,
): string[] {
  return [slotId, ...transitionLogicDependentSlotIds(definition, slotId)];
}

/** Validate persisted definitions before they enter a live planner or archive. */
export function transitionLogicErrors(
  value: unknown,
  references: TransitionLogicReferences = {},
): string[] {
  const errors: string[] = [];
  const object = (entry: unknown): entry is Record<string, unknown> =>
    !!entry && typeof entry === 'object' && !Array.isArray(entry);
  const identifier = (entry: unknown): entry is string =>
    typeof entry === 'string' &&
    entry.length > 0 &&
    entry.length <= 256 &&
    entry.trim() === entry &&
    !['*', '__proto__', 'constructor', 'prototype'].includes(entry);
  const name = (entry: unknown) =>
    typeof entry === 'string' && entry.trim().length > 0 && entry.length <= 256;
  const finite = (entry: unknown): entry is number =>
    typeof entry === 'number' && Number.isFinite(entry);
  const frame = (entry: unknown): entry is number =>
    finite(entry) && Number.isSafeInteger(entry) && entry >= 0 && entry <= 86_400_000;
  if (!object(value)) return ['Transition Logic must be an object.'];
  if (
    value.version !== 1 &&
    value.version !== 2 &&
    value.version !== 3 &&
    value.version !== 4 &&
    value.version !== 5 &&
    value.version !== TRANSITION_LOGIC_VERSION
  )
    errors.push('Unsupported Transition Logic version.');
  const versionAtLeast = (minimum: number) =>
    typeof value.version === 'number' && value.version >= minimum;
  if (!identifier(value.id)) errors.push('Transition Logic needs a valid ID.');
  if (!name(value.name)) errors.push('Transition Logic needs a name of at most 256 characters.');
  const collection = (key: string, limit: number): Record<string, unknown>[] => {
    const entries = value[key];
    if (
      !Array.isArray(entries) ||
      entries.length > limit ||
      entries.some((entry) => !object(entry))
    ) {
      errors.push(`Transition Logic ${key} must contain at most ${limit} objects.`);
      return [];
    }
    return entries as Record<string, unknown>[];
  };
  const slots = collection('slots', 64);
  const states = collection('states', 1024);
  const recipes = collection('transitions', 1024);
  const routes = collection('routes', 4096);
  const shared = collection('sharedInstances', 512);
  const initial = collection('initialSharedValues', 8192);
  const layoutRules = value.layoutRules === undefined ? [] : collection('layoutRules', 256);
  const animationCatalogErrors = transitionAnimationCatalogErrors(value.animationPresetPlugins);
  errors.push(...animationCatalogErrors);
  const animationCatalog = animationCatalogErrors.length
    ? []
    : ((value.animationPresetPlugins ?? []) as AnimationPresetPluginSnapshot[]);
  if (value.animationPresetPlugins !== undefined && !versionAtLeast(5))
    errors.push('Transition animation catalogs require Transition Logic version 5.');
  if (value.rehearsal !== undefined) {
    const steps = value.rehearsal;
    if (!Array.isArray(steps) || steps.length > 1024)
      errors.push('Rehearsal must be a list of at most 1024 steps.');
    else if (
      steps.some(
        (step) =>
          !object(step) ||
          !identifier(step.slotId) ||
          !(step.stateId === null || identifier(step.stateId)),
      )
    )
      errors.push('Each rehearsal step needs a lane and a template or null.');
  }
  if (layoutRules.length && !versionAtLeast(2))
    errors.push('Shared layout rules require Transition Logic version 2 or later.');
  const index = (entries: Record<string, unknown>[], label: string) => {
    const map = new Map<string, Record<string, unknown>>();
    for (const entry of entries) {
      if (!identifier(entry.id)) errors.push(`${label} has an invalid ID.`);
      else if (map.has(entry.id)) errors.push(`${label} has duplicate ID ${entry.id}.`);
      else map.set(entry.id, entry);
      if (label !== 'Transition route' && !name(entry.name))
        errors.push(`${label} ${String(entry.id)} needs a name.`);
    }
    return map;
  };
  const slotIndex = index(slots, 'Playout slot');
  const stateIndex = index(states, 'Playout state');
  const recipeIndex = index(recipes, 'Transition recipe');
  const sharedIndex = index(shared, 'Shared instance');
  index(routes, 'Transition route');
  index(layoutRules, 'Shared layout rule');
  if (!slots.length) errors.push('Transition Logic needs at least one playout slot.');
  if (!identifier(value.defaultTransitionId) || !recipeIndex.has(value.defaultTransitionId))
    errors.push('Transition Logic default transition is missing.');
  for (const slot of slots) {
    if (!finite(slot.order) || !Number.isSafeInteger(slot.order))
      errors.push(`Slot ${String(slot.id)} order must be an integer.`);
    for (const key of ['defaultTransitionId', 'updateTransitionId']) {
      if (slot[key] !== undefined && (typeof slot[key] !== 'string' || !recipeIndex.has(slot[key])))
        errors.push(`Slot ${String(slot.id)} references an unknown ${key}.`);
    }
    if (slot.updateMode !== undefined) {
      if (!versionAtLeast(6))
        errors.push(`Slot ${String(slot.id)} updateMode requires Transition Logic version 6.`);
      if (!(TRANSITION_LOGIC_UPDATE_MODES as readonly unknown[]).includes(slot.updateMode))
        errors.push(`Slot ${String(slot.id)} has an unsupported updateMode.`);
    }
    if (slot.parentSlotId !== undefined) {
      if (!identifier(slot.parentSlotId) || !slotIndex.has(slot.parentSlotId))
        errors.push(`Slot ${String(slot.id)} references an unknown parent slot.`);
      else if (slot.parentSlotId === slot.id)
        errors.push(`Slot ${String(slot.id)} cannot depend on itself.`);
    }
    if (slot.admission !== undefined) {
      if (!versionAtLeast(4))
        errors.push(`Slot ${String(slot.id)} Take admission requires Transition Logic version 4.`);
      if (
        !object(slot.admission) ||
        Object.keys(slot.admission).some(
          (key) => !['requireOnSlotIds', 'blockWhileActiveSlotIds'].includes(key),
        )
      ) {
        errors.push(`Slot ${String(slot.id)} admission must contain supported Take conditions.`);
      } else {
        for (const key of ['requireOnSlotIds', 'blockWhileActiveSlotIds']) {
          const ids = slot.admission[key];
          if (ids === undefined) continue;
          if (!Array.isArray(ids) || ids.length > 64 || ids.some((id) => !identifier(id))) {
            errors.push(
              `Slot ${String(slot.id)} admission ${key} must contain at most 64 lane IDs.`,
            );
            continue;
          }
          const seen = new Set<string>();
          for (const id of ids as string[]) {
            if (seen.has(id)) errors.push(`Slot ${String(slot.id)} repeats admission lane ${id}.`);
            seen.add(id);
            if (!slotIndex.has(id))
              errors.push(`Slot ${String(slot.id)} references unknown admission lane ${id}.`);
            if (id === slot.id)
              errors.push(`Slot ${String(slot.id)} admission cannot reference its own lane.`);
          }
        }
        const required = slot.admission.requireOnSlotIds;
        const blocked = slot.admission.blockWhileActiveSlotIds;
        if (
          Array.isArray(required) &&
          Array.isArray(blocked) &&
          required.some((id) => blocked.includes(id))
        )
          errors.push(`Slot ${String(slot.id)} admission cannot require the same lane On and Off.`);
      }
    }
    const visited = new Set<unknown>([slot.id]);
    let parent = slot.parentSlotId;
    while (typeof parent === 'string' && slotIndex.has(parent)) {
      if (visited.has(parent)) {
        errors.push(`Slot ${String(slot.id)} has a cyclic parent dependency.`);
        break;
      }
      visited.add(parent);
      parent = slotIndex.get(parent)!.parentSlotId;
    }
  }
  for (const slot of slots) {
    const visited = new Set<unknown>();
    const walk = (id: unknown, ancestors: Set<unknown>): boolean => {
      if (ancestors.has(id)) return true;
      if (visited.has(id)) return false;
      visited.add(id);
      const candidate = typeof id === 'string' ? slotIndex.get(id) : undefined;
      const admission = candidate?.admission;
      if (!object(admission) || !Array.isArray(admission.requireOnSlotIds)) return false;
      return admission.requireOnSlotIds.some((required) =>
        walk(required, new Set([...ancestors, id])),
      );
    };
    if (walk(slot.id, new Set()))
      errors.push(`Slot ${String(slot.id)} has a cyclic require-On admission condition.`);
  }
  for (const recipe of recipes) {
    for (const key of [
      'durationFrames',
      'outgoingFrames',
      'incomingStartFrame',
      'incomingFrames',
      'sharedFrames',
    ]) {
      if (!frame(recipe[key]))
        errors.push(`Transition ${String(recipe.id)} ${key} must be a nonnegative frame count.`);
    }
    if (frame(recipe.durationFrames)) {
      for (const key of ['outgoingFrames', 'sharedFrames'])
        if (frame(recipe[key]) && recipe[key] > recipe.durationFrames)
          errors.push(`Transition ${String(recipe.id)} ${key} exceeds its duration.`);
      if (
        frame(recipe.incomingStartFrame) &&
        frame(recipe.incomingFrames) &&
        recipe.incomingStartFrame + recipe.incomingFrames > recipe.durationFrames
      )
        errors.push(`Transition ${String(recipe.id)} incoming phase exceeds its duration.`);
    }
    if (!['linear', 'ease-in-out', 'ease-out'].includes(String(recipe.easing)))
      errors.push(`Transition ${String(recipe.id)} has unsupported easing.`);
    if (
      recipe.contentMotion !== undefined &&
      !(TRANSITION_LOGIC_CONTENT_MOTIONS as readonly unknown[]).includes(recipe.contentMotion)
    )
      errors.push(`Transition ${String(recipe.id)} has unsupported content motion.`);
    for (const [property, side, duration] of [
      ['incomingAnimation', 'in', recipe.incomingFrames],
      ['outgoingAnimation', 'out', recipe.outgoingFrames],
    ] as const) {
      if (recipe[property] !== undefined && !versionAtLeast(5))
        errors.push(
          `Transition ${String(recipe.id)} ${property} requires Transition Logic version 5.`,
        );
      errors.push(
        ...transitionContentAnimationErrors(
          recipe[property],
          side,
          frame(duration) ? duration : 0,
          animationCatalog,
        ).map((error) => `Transition ${String(recipe.id)} ${property}: ${error}`),
      );
    }
    if (recipe.layoutPhase !== undefined) {
      if (!versionAtLeast(3))
        errors.push(
          `Transition ${String(recipe.id)} layout phase requires Transition Logic version 3.`,
        );
      if (!object(recipe.layoutPhase)) {
        errors.push(`Transition ${String(recipe.id)} layout phase must be an object.`);
      } else {
        const { startFrame, durationFrames } = recipe.layoutPhase;
        if (!frame(startFrame) || !frame(durationFrames))
          errors.push(
            `Transition ${String(recipe.id)} layout phase needs nonnegative start and duration frame counts.`,
          );
        else if (
          frame(recipe.durationFrames) &&
          startFrame + durationFrames > recipe.durationFrames
        )
          errors.push(`Transition ${String(recipe.id)} layout phase exceeds its duration.`);
      }
    }
  }
  const continuity = new Set<string>();
  for (const instance of shared) {
    if (!identifier(instance.componentAssetId))
      errors.push(`Shared instance ${String(instance.id)} needs a component asset ID.`);
    else if (
      references.componentLayers &&
      !Object.hasOwn(references.componentLayers, instance.componentAssetId)
    )
      errors.push(
        `Shared instance ${String(instance.id)} references missing component ${instance.componentAssetId}.`,
      );
    if (
      instance.slotId !== undefined &&
      (typeof instance.slotId !== 'string' || !slotIndex.has(instance.slotId))
    )
      errors.push(`Shared instance ${String(instance.id)} references an unknown slot.`);
    if (!identifier(instance.continuityKey))
      errors.push(`Shared instance ${String(instance.id)} needs a continuity key.`);
    else if (continuity.has(instance.continuityKey))
      errors.push(`Duplicate shared continuity key ${instance.continuityKey}.`);
    else continuity.add(instance.continuityKey);
  }
  const propertyKey = (entry: Record<string, unknown>) =>
    JSON.stringify([entry.instanceId, entry.sourceLayerId, entry.property]);
  const checkValues = (
    entries: Record<string, unknown>[],
    owner: string,
    slotId?: string,
    offsets = false,
  ) => {
    const keys = new Set<string>();
    const properties: readonly unknown[] = offsets
      ? ['x', 'y', 'width', 'height']
      : TRANSITION_LOGIC_SHARED_PROPERTIES;
    for (const entry of entries) {
      const instance =
        typeof entry.instanceId === 'string' ? sharedIndex.get(entry.instanceId) : undefined;
      if (!instance)
        errors.push(`${owner} references unknown shared instance ${String(entry.instanceId)}.`);
      if (!identifier(entry.sourceLayerId))
        errors.push(`${owner} needs a valid shared source layer ID.`);
      else if (
        instance &&
        references.componentLayers &&
        typeof instance.componentAssetId === 'string' &&
        !references.componentLayers[instance.componentAssetId]?.includes(entry.sourceLayerId)
      )
        errors.push(`${owner} references unknown shared source layer ${entry.sourceLayerId}.`);
      if (slotId && instance?.slotId !== undefined && instance.slotId !== slotId)
        errors.push(`${owner} cannot control a shared instance belonging to another slot.`);
      if (!properties.includes(entry.property))
        errors.push(`${owner} uses unsupported shared property ${String(entry.property)}.`);
      if (
        entry.resizeAnchor !== undefined &&
        (!offsets ||
          entry.property !== 'width' ||
          !(TRANSITION_LOGIC_RESIZE_ANCHORS as readonly unknown[]).includes(entry.resizeAnchor))
      )
        errors.push(`${owner} has an invalid resize anchor.`);
      if (!finite(entry.value)) errors.push(`${owner} shared property value must be finite.`);
      else if (
        !offsets &&
        (entry.property === 'width' || entry.property === 'height') &&
        entry.value < 0
      )
        errors.push(`${owner} shared dimensions cannot be negative.`);
      else if (entry.property === 'opacity' && (entry.value < 0 || entry.value > 1))
        errors.push(`${owner} shared opacity must be between 0 and 1.`);
      const key = propertyKey(entry);
      if (keys.has(key)) errors.push(`${owner} repeats a shared property.`);
      keys.add(key);
    }
    return keys;
  };
  const baseline = checkValues(initial, 'Initial shared values');
  const writers = new Map<string, string>();
  for (const state of states) {
    if (typeof state.slotId !== 'string' || !slotIndex.has(state.slotId))
      errors.push(`State ${String(state.id)} references an unknown slot.`);
    if (!identifier(state.templateId))
      errors.push(`State ${String(state.id)} needs a template ID.`);
    else if (references.templateIds && !references.templateIds.includes(state.templateId))
      errors.push(`State ${String(state.id)} references missing template ${state.templateId}.`);
    if (state.family !== undefined && !name(state.family))
      errors.push(`State ${String(state.id)} family must be a nonempty name.`);
    if (state.dataDefaults !== undefined)
      if (!versionAtLeast(4))
        errors.push(`State ${String(state.id)} defaults require Transition Logic version 4.`);
    if (state.dataDefaults !== undefined)
      errors.push(
        ...visualRulePlayoutDataErrors(state.dataDefaults).map(
          (error) => `State ${String(state.id)} defaults: ${error}`,
        ),
      );
    if (state.takeOutSlotIds !== undefined) {
      if (
        !Array.isArray(state.takeOutSlotIds) ||
        state.takeOutSlotIds.length > 64 ||
        state.takeOutSlotIds.some((id) => !identifier(id))
      ) {
        errors.push(`State ${String(state.id)} takeOutSlotIds must contain at most 64 lane IDs.`);
      } else {
        const seen = new Set<string>();
        for (const targetId of state.takeOutSlotIds as string[]) {
          if (seen.has(targetId))
            errors.push(`State ${String(state.id)} repeats takeover lane ${targetId}.`);
          seen.add(targetId);
          if (!slotIndex.has(targetId)) {
            errors.push(`State ${String(state.id)} references unknown takeover lane ${targetId}.`);
            continue;
          }
          const affected = new Set<string>([targetId]);
          for (const id of affected) {
            for (const dependent of slots) {
              if (dependent.parentSlotId === id && typeof dependent.id === 'string')
                affected.add(dependent.id);
            }
          }
          if (typeof state.slotId !== 'string') continue;
          if (affected.has(state.slotId))
            errors.push(`State ${String(state.id)} takeover cannot take out its own lane.`);
        }
      }
    }
    if (state.sharedValues === undefined) continue;
    if (
      !Array.isArray(state.sharedValues) ||
      state.sharedValues.length > 8192 ||
      state.sharedValues.some((entry) => !object(entry))
    ) {
      errors.push(`State ${String(state.id)} sharedValues must be an array of property targets.`);
      continue;
    }
    const targets = state.sharedValues as Record<string, unknown>[];
    checkValues(
      targets,
      `State ${String(state.id)}`,
      typeof state.slotId === 'string' ? state.slotId : undefined,
    );
    for (const target of targets) {
      if (!baseline.has(propertyKey(target)))
        errors.push(`State ${String(state.id)} shared target has no initial value.`);
      if (target.override !== undefined && target.override !== true)
        errors.push(`State ${String(state.id)} shared override marker must be true.`);
      if (typeof target.instanceId !== 'string' || typeof state.slotId !== 'string') continue;
      const writer = writers.get(target.instanceId);
      if (writer && writer !== state.slotId)
        errors.push(`Shared instance ${target.instanceId} has conflicting slot owners.`);
      writers.set(target.instanceId, state.slotId);
    }
  }
  // Takeover sends Out, never another Take. Reciprocal policies are intentional replacements,
  // not recursive activation edges; each request has its own readiness and exit barrier.
  const layoutBounds = new Map<string, { property: unknown; minimum: number; maximum: number }>();
  const minimumValues = new Map<string, number>();
  const maximumValues = new Map<string, number>();
  for (const target of initial) {
    if (finite(target.value)) {
      minimumValues.set(propertyKey(target), target.value);
      maximumValues.set(propertyKey(target), target.value);
    }
  }
  for (const state of states) {
    if (!Array.isArray(state.sharedValues)) continue;
    for (const target of state.sharedValues) {
      if (!object(target) || !finite(target.value)) continue;
      const key = propertyKey(target);
      minimumValues.set(key, Math.min(minimumValues.get(key) ?? target.value, target.value));
      maximumValues.set(key, Math.max(maximumValues.get(key) ?? target.value, target.value));
    }
  }
  for (const rule of layoutRules) {
    const owner = `Shared layout rule ${String(rule.id)}`;
    if (typeof rule.slotId !== 'string' || !slotIndex.has(rule.slotId))
      errors.push(`${owner} references an unknown target slot.`);
    if (typeof rule.whenSlotId !== 'string' || !slotIndex.has(rule.whenSlotId))
      errors.push(`${owner} references an unknown observed slot.`);
    if (rule.slotId === rule.whenSlotId) errors.push(`${owner} must observe another slot.`);
    if (
      !Array.isArray(rule.sharedOffsets) ||
      rule.sharedOffsets.length > 8192 ||
      rule.sharedOffsets.some((entry) => !object(entry))
    ) {
      errors.push(`${owner} sharedOffsets must be an array of at most 8192 property offsets.`);
      continue;
    }
    const offsets = rule.sharedOffsets as Record<string, unknown>[];
    checkValues(offsets, owner, typeof rule.slotId === 'string' ? rule.slotId : undefined, true);
    for (const offset of offsets) {
      const key = propertyKey(offset);
      if (!baseline.has(key)) errors.push(`${owner} shared offset has no initial value.`);
      if (typeof offset.instanceId === 'string' && typeof rule.slotId === 'string') {
        const writer = writers.get(offset.instanceId);
        if (writer && writer !== rule.slotId)
          errors.push(`Shared instance ${offset.instanceId} has conflicting slot owners.`);
        writers.set(offset.instanceId, rule.slotId);
      }
      if (finite(offset.value)) {
        const bounds = layoutBounds.get(key) ?? {
          property: offset.property,
          minimum: minimumValues.get(key) ?? 0,
          maximum: maximumValues.get(key) ?? 0,
        };
        // Every observed lane can independently occupy any fraction of its reservation. Check
        // the complete envelope, including a partial exit while positive contributions are Off.
        bounds.minimum += Math.min(0, offset.value);
        bounds.maximum += Math.max(0, offset.value);
        layoutBounds.set(key, bounds);
      }
    }
  }
  for (const bounds of layoutBounds.values()) {
    if ((bounds.property === 'width' || bounds.property === 'height') && bounds.minimum < 0)
      errors.push('Combined shared layout offsets can produce a negative shared dimension.');
    if (!Number.isFinite(bounds.minimum) || !Number.isFinite(bounds.maximum))
      errors.push('Combined shared layout offsets can produce a non-finite shared value.');
  }
  for (const route of routes) {
    if (typeof route.slotId !== 'string' || !slotIndex.has(route.slotId))
      errors.push(`Route ${String(route.id)} references an unknown slot.`);
    for (const key of ['from', 'to']) {
      const selector = route[key];
      if (selector === '*' || selector === null) continue;
      if (typeof selector !== 'string' || stateIndex.get(selector)?.slotId !== route.slotId)
        errors.push(`Route ${String(route.id)} ${key} is not a state in its slot.`);
    }
    if (typeof route.transitionId !== 'string' || !recipeIndex.has(route.transitionId))
      errors.push(`Route ${String(route.id)} references an unknown transition.`);
    if (!finite(route.priority) || !Number.isSafeInteger(route.priority))
      errors.push(`Route ${String(route.id)} priority must be an integer.`);
  }
  // Equal-specificity routes only conflict within one slot and priority. Exact pairs and
  // repeated wildcard selectors can be indexed, avoiding a quadratic scan of large packages.
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const route of routes) {
    const specificity = Number(route.from !== '*') + Number(route.to !== '*');
    const key = JSON.stringify([route.slotId, route.priority, specificity]);
    const entries = groups.get(key) ?? [];
    entries.push(route);
    groups.set(key, entries);
  }
  for (const group of groups.values()) {
    const selectors = new Map<string, Record<string, unknown>>();
    let sourceWildcard: Record<string, unknown> | undefined;
    let destinationWildcard: Record<string, unknown> | undefined;
    for (const route of group) {
      const selector = JSON.stringify([route.from, route.to]);
      const previous = selectors.get(selector);
      if (previous)
        errors.push(`Routes ${String(previous.id)} and ${String(route.id)} are ambiguous.`);
      else selectors.set(selector, route);
      if (route.from === '*' && route.to !== '*') sourceWildcard ??= route;
      if (route.to === '*' && route.from !== '*') destinationWildcard ??= route;
    }
    if (sourceWildcard && destinationWildcard)
      errors.push(
        `Routes ${String(sourceWildcard.id)} and ${String(destinationWildcard.id)} are ambiguous.`,
      );
  }
  return [...new Set(errors)];
}
