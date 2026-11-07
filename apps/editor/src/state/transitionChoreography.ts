import {
  computeKeyframeFrames,
  createId,
  getLayerTransformAtFrame,
  TRANSITION_LOGIC_VERSION,
  transitionLogicDependentSlotIds,
  transitionLogicErrors,
  type Project,
  type TransitionLogicDefinition,
  type TransitionLogicLayoutRule,
  type TransitionLogicRecipe,
  type TransitionLogicReferences,
  type TransitionLogicRoute,
  type TransitionLogicSharedInstance,
  type TransitionLogicSharedValue,
  type TransitionLogicState,
  type TransitionLogicUpdateMode,
} from '@ograf-editor/scene-model';

/**
 * Designer-facing view of Transition Logic. Slots read as layers, routes and recipes as the timing
 * of four playout moments in their real order: take in, update, switch, take out. Every edit here
 * returns a complete, validated definition and keeps every other moment's behavior unchanged.
 */
export type ChoreographyPhase = 'enter' | 'update' | 'switch' | 'exit';

export const CHOREOGRAPHY_PHASES: ReadonlyArray<{
  phase: ChoreographyPhase;
  label: string;
  hint: string;
}> = [
  { phase: 'enter', label: 'Take in', hint: 'From off to on air' },
  { phase: 'update', label: 'Update', hint: 'Same template, new data' },
  { phase: 'switch', label: 'Switch', hint: 'Another template replaces it in this layer' },
  { phase: 'exit', label: 'Take out', hint: 'From on air to off' },
];

/** What a timing editor changes: the layer-wide moment, or one template-specific exception. */
export type ChoreographyTarget =
  | { kind: 'layer'; slotId: string; phase: ChoreographyPhase }
  | { kind: 'route'; routeId: string; phase: ChoreographyPhase };

export interface PhaseResolution {
  recipe: TransitionLogicRecipe | null;
  route?: TransitionLogicRoute;
  issue?: string;
}

export interface PhaseException {
  route: TransitionLogicRoute;
  label: string;
  recipe: TransitionLogicRecipe | null;
  /** Wildcard exceptions also steer other moments; they are edited but not quietly removed. */
  broad: boolean;
}

export interface TimingPatch {
  outgoingFrames?: number;
  incomingStartFrame?: number;
  incomingFrames?: number;
  sharedFrames?: number;
  easing?: TransitionLogicRecipe['easing'];
  holdFrames?: number;
  layoutPhase?: { startFrame: number; durationFrames: number } | null;
  /** Slide or wipe the content; null (or 'fade') fades it, the default. */
  contentMotion?: TransitionLogicRecipe['contentMotion'] | null;
  /** Content-only overrides; null restores the selected transition style. */
  incomingAnimation?: TransitionLogicRecipe['incomingAnimation'] | null;
  outgoingAnimation?: TransitionLogicRecipe['outgoingAnimation'] | null;
}

// Probe values that only wildcard selectors match: "a template" without naming one.
const ANY_A = '\u0000any-a';
const ANY_B = '\u0000any-b';

const matches = (selector: string | null, value: string | null) =>
  selector === '*' || selector === value;

function probe(phase: ChoreographyPhase, a: string, b: string): [string | null, string | null] {
  if (phase === 'enter') return [null, a];
  if (phase === 'exit') return [a, null];
  if (phase === 'update') return [a, a];
  return [a, b];
}

/** Same selection as the runtime planner: specificity, then priority, then layer fallbacks. */
export function resolveTransition(
  definition: TransitionLogicDefinition,
  slotId: string,
  from: string | null,
  to: string | null,
): PhaseResolution {
  const candidates = definition.routes
    .filter(
      (route) => route.slotId === slotId && matches(route.from, from) && matches(route.to, to),
    )
    .map((route) => ({ route, specificity: Number(route.from !== '*') + Number(route.to !== '*') }))
    .sort((a, b) => b.specificity - a.specificity || b.route.priority - a.route.priority);
  const [first, second] = candidates;
  if (
    first &&
    second &&
    first.specificity === second.specificity &&
    first.route.priority === second.route.priority
  )
    return { recipe: null, issue: 'Two timings claim this moment. Remove one of them.' };
  const slot = definition.slots.find((entry) => entry.id === slotId);
  const sameState = from !== null && from === to;
  const id =
    first?.route.transitionId ??
    (sameState ? slot?.updateTransitionId : undefined) ??
    slot?.defaultTransitionId ??
    definition.defaultTransitionId;
  const recipe = definition.transitions.find((entry) => entry.id === id) ?? null;
  return {
    recipe,
    ...(first ? { route: first.route } : {}),
    ...(recipe ? {} : { issue: 'This moment points at a missing timing.' }),
  };
}

export function resolveLayerPhase(
  definition: TransitionLogicDefinition,
  slotId: string,
  phase: ChoreographyPhase,
): PhaseResolution {
  const [from, to] = probe(phase, ANY_A, ANY_B);
  return resolveTransition(definition, slotId, from, to);
}

export function resolveTarget(
  definition: TransitionLogicDefinition,
  target: ChoreographyTarget,
): PhaseResolution {
  if (target.kind === 'layer') return resolveLayerPhase(definition, target.slotId, target.phase);
  const route = definition.routes.find((entry) => entry.id === target.routeId);
  if (!route) return { recipe: null, issue: 'This exception was removed.' };
  const recipe = definition.transitions.find((entry) => entry.id === route.transitionId) ?? null;
  return {
    recipe,
    route,
    ...(recipe ? {} : { issue: 'This exception points at a missing timing.' }),
  };
}

export function layerStates(
  definition: TransitionLogicDefinition,
  slotId: string,
): TransitionLogicState[] {
  return definition.states.filter((state) => state.slotId === slotId);
}

/** Slots sorted the way they draw: the top layer first. */
export function layersTopFirst(definition: TransitionLogicDefinition) {
  return [...definition.slots].sort((a, b) => b.order - a.order);
}

export function selectorLabel(definition: TransitionLogicDefinition, selector: string | null) {
  if (selector === null) return 'Off';
  if (selector === '*') return 'Any';
  return definition.states.find((state) => state.id === selector)?.name ?? 'Missing template';
}

function routePhase(route: TransitionLogicRoute): ChoreographyPhase {
  if (route.from === null) return 'enter';
  if (route.to === null) return 'exit';
  if (route.from !== '*' && route.from === route.to) return 'update';
  return 'switch';
}

/** Routes that make one template (or pair) behave differently from the layer-wide moment. */
export function phaseExceptions(
  definition: TransitionLogicDefinition,
  slotId: string,
  phase: ChoreographyPhase,
): PhaseException[] {
  const layerRoute = resolveLayerPhase(definition, slotId, phase).route;
  return definition.routes
    .filter(
      (route) =>
        route.slotId === slotId &&
        route.id !== layerRoute?.id &&
        (route.from !== '*' || route.to !== '*') &&
        !(route.from === null && route.to === '*') &&
        !(route.from === '*' && route.to === null) &&
        routePhase(route) === phase,
    )
    .map((route) => {
      const recipe =
        definition.transitions.find((entry) => entry.id === route.transitionId) ?? null;
      const from = selectorLabel(definition, route.from);
      const to = selectorLabel(definition, route.to);
      const label =
        phase === 'enter' ? to : phase === 'exit' || phase === 'update' ? from : `${from} → ${to}`;
      return { route, label, recipe, broad: route.from === '*' || route.to === '*' };
    });
}

export function phaseEnd(recipe: TransitionLogicRecipe): number {
  return Math.max(
    recipe.outgoingFrames,
    recipe.incomingStartFrame + recipe.incomingFrames,
    recipe.sharedFrames,
    recipe.layoutPhase ? recipe.layoutPhase.startFrame + recipe.layoutPhase.durationFrames : 0,
  );
}

export function holdFrames(recipe: TransitionLogicRecipe): number {
  return Math.max(0, recipe.durationFrames - phaseEnd(recipe));
}

function recipeReferences(definition: TransitionLogicDefinition, recipeId: string): number {
  return (
    Number(definition.defaultTransitionId === recipeId) +
    definition.slots.reduce(
      (count, slot) =>
        count +
        Number(slot.defaultTransitionId === recipeId) +
        Number(slot.updateTransitionId === recipeId),
      0,
    ) +
    definition.routes.filter((route) => route.transitionId === recipeId).length
  );
}

/** Recipes are an implementation detail in this editor; drop the ones nothing uses. */
function collectUnusedRecipes(definition: TransitionLogicDefinition) {
  definition.transitions = definition.transitions.filter(
    (recipe) => recipeReferences(definition, recipe.id) > 0,
  );
}

function slotPriorities(definition: TransitionLogicDefinition, slotId: string) {
  return definition.routes
    .filter((route) => route.slotId === slotId)
    .map((route) => route.priority);
}

function phaseName(phase: ChoreographyPhase) {
  return CHOREOGRAPHY_PHASES.find((entry) => entry.phase === phase)!.label;
}

/**
 * Give each layer-wide moment its own binding without changing behavior: generic take-in and
 * take-out routes, plus the layer's switch and update defaults. A catch-all route can't separate a
 * same-template update from a switch, so it is replaced by those two equal defaults.
 */
function pinLayerPhases(definition: TransitionLogicDefinition, slotId: string) {
  const slot = definition.slots.find((entry) => entry.id === slotId);
  if (!slot) throw new Error('This layer was removed.');
  const current = Object.fromEntries(
    CHOREOGRAPHY_PHASES.map(({ phase }) => [phase, resolveLayerPhase(definition, slotId, phase)]),
  ) as Record<ChoreographyPhase, PhaseResolution>;
  for (const { phase } of CHOREOGRAPHY_PHASES)
    if (!current[phase].recipe)
      throw new Error(current[phase].issue ?? 'Resolve this layer’s timing first.');
  // Lower than every existing route, so template-specific routes keep winning ties.
  let lowest = Math.min(0, ...slotPriorities(definition, slotId));
  for (const [phase, from, to] of [
    ['enter', null, '*'],
    ['exit', '*', null],
  ] as const) {
    const winner = current[phase].route;
    if (winner?.from === from && winner.to === to) continue;
    definition.routes.push({
      id: createId('route'),
      slotId,
      from,
      to,
      transitionId: current[phase].recipe!.id,
      priority: --lowest,
    });
  }
  definition.routes = definition.routes.filter(
    (route) => !(route.slotId === slotId && route.from === '*' && route.to === '*'),
  );
  slot.defaultTransitionId = current.switch.recipe!.id;
  slot.updateTransitionId = current.update.recipe!.id;
}

function binding(
  definition: TransitionLogicDefinition,
  target: ChoreographyTarget,
): { get: () => string; set: (id: string) => void } {
  if (target.kind === 'route') {
    const route = definition.routes.find((entry) => entry.id === target.routeId);
    if (!route) throw new Error('This exception was removed.');
    return { get: () => route.transitionId, set: (id) => (route.transitionId = id) };
  }
  const slot = definition.slots.find((entry) => entry.id === target.slotId)!;
  if (target.phase === 'switch')
    return { get: () => slot.defaultTransitionId!, set: (id) => (slot.defaultTransitionId = id) };
  if (target.phase === 'update')
    return { get: () => slot.updateTransitionId!, set: (id) => (slot.updateTransitionId = id) };
  const [from, to] = target.phase === 'enter' ? [null, '*'] : ['*', null];
  const route = definition.routes.find(
    (entry) => entry.slotId === slot.id && entry.from === from && entry.to === to,
  )!;
  return { get: () => route.transitionId, set: (id) => (route.transitionId = id) };
}

function validated(
  definition: TransitionLogicDefinition,
  references: TransitionLogicReferences,
): TransitionLogicDefinition {
  const errors = transitionLogicErrors(definition, references);
  if (errors.length) throw new Error(errors.join(' '));
  return definition;
}

function nonnegativeFrames(value: number | undefined, label: string) {
  if (value === undefined) return;
  if (!Number.isSafeInteger(value) || value < 0 || value > 86_400_000)
    throw new Error(`${label} must be a whole, nonnegative number of frames.`);
}

/** Change one moment's timing. Shared recipes are copied so no other moment moves with it. */
export function setPhaseTiming(
  source: TransitionLogicDefinition,
  target: ChoreographyTarget,
  patch: TimingPatch,
  references: TransitionLogicReferences = {},
): TransitionLogicDefinition {
  for (const key of [
    'outgoingFrames',
    'incomingStartFrame',
    'incomingFrames',
    'sharedFrames',
    'holdFrames',
  ] as const)
    nonnegativeFrames(patch[key], 'Timing');
  if (patch.layoutPhase) {
    nonnegativeFrames(patch.layoutPhase.startFrame, 'Room timing');
    nonnegativeFrames(patch.layoutPhase.durationFrames, 'Room timing');
  }
  const definition = structuredClone(source);
  if (target.kind === 'layer') pinLayerPhases(definition, target.slotId);
  const bound = binding(definition, target);
  const original = definition.transitions.find((recipe) => recipe.id === bound.get());
  if (!original) throw new Error('This moment points at a missing timing.');
  const hold = patch.holdFrames ?? holdFrames(original);
  let recipe = original;
  if (recipeReferences(definition, original.id) > 1) {
    const slotId =
      target.kind === 'layer'
        ? target.slotId
        : definition.routes.find((route) => route.id === target.routeId)!.slotId;
    const layer = definition.slots.find((slot) => slot.id === slotId)?.name ?? 'Layer';
    recipe = {
      ...structuredClone(original),
      id: createId('transition'),
      name: `${layer} · ${phaseName(target.phase)}`.slice(0, 256),
    };
    definition.transitions.push(recipe);
    bound.set(recipe.id);
  }
  for (const key of [
    'outgoingFrames',
    'incomingStartFrame',
    'incomingFrames',
    'sharedFrames',
  ] as const)
    if (patch[key] !== undefined) recipe[key] = patch[key];
  if (patch.easing) recipe.easing = patch.easing;
  if (patch.contentMotion === null || patch.contentMotion === 'fade') delete recipe.contentMotion;
  else if (patch.contentMotion) recipe.contentMotion = patch.contentMotion;
  for (const key of ['incomingAnimation', 'outgoingAnimation'] as const) {
    if (patch[key] === null) delete recipe[key];
    else if (patch[key] !== undefined) {
      recipe[key] = structuredClone(patch[key]);
      definition.version = TRANSITION_LOGIC_VERSION;
    }
  }
  const layoutPhase = patch.layoutPhase;
  if (layoutPhase === null) delete recipe.layoutPhase;
  else if (layoutPhase) {
    recipe.layoutPhase = { ...layoutPhase };
    definition.version = TRANSITION_LOGIC_VERSION;
  }
  recipe.durationFrames = phaseEnd(recipe) + hold;
  collectUnusedRecipes(definition);
  return validated(definition, references);
}

/** Exact selectors for one template (or one ordered pair) in its layer. */
function exactSelectors(
  phase: ChoreographyPhase,
  stateId: string,
  otherStateId?: string,
): [string | null, string | null] {
  if (phase === 'switch') {
    if (!otherStateId || otherStateId === stateId)
      throw new Error('Choose two different templates for a switch.');
    return [stateId, otherStateId];
  }
  return probe(phase, stateId, stateId);
}

/** Start an exception from the timing that currently applies, so nothing changes until edited. */
export function addPhaseException(
  source: TransitionLogicDefinition,
  slotId: string,
  phase: ChoreographyPhase,
  stateId: string,
  otherStateId?: string,
  references: TransitionLogicReferences = {},
): { definition: TransitionLogicDefinition; routeId: string } {
  const definition = structuredClone(source);
  const [from, to] = exactSelectors(phase, stateId, otherStateId);
  if (
    definition.routes.some(
      (route) => route.slotId === slotId && route.from === from && route.to === to,
    )
  )
    throw new Error('This template already has its own timing here.');
  const current = resolveTransition(definition, slotId, from, to);
  if (!current.recipe) throw new Error(current.issue ?? 'Resolve this layer’s timing first.');
  const state = definition.states.find((entry) => entry.id === stateId);
  const recipe: TransitionLogicRecipe = {
    ...structuredClone(current.recipe),
    id: createId('transition'),
    name: `${state?.name ?? 'Template'} · ${phaseName(phase)}`.slice(0, 256),
  };
  definition.transitions.push(recipe);
  const routeId = createId('route');
  definition.routes.push({
    id: routeId,
    slotId,
    from,
    to,
    transitionId: recipe.id,
    priority: Math.max(0, ...slotPriorities(definition, slotId)) + 1,
  });
  return { definition: validated(definition, references), routeId };
}

export function removePhaseException(
  source: TransitionLogicDefinition,
  routeId: string,
  references: TransitionLogicReferences = {},
): TransitionLogicDefinition {
  const definition = structuredClone(source);
  definition.routes = definition.routes.filter((route) => route.id !== routeId);
  collectUnusedRecipes(definition);
  return validated(definition, references);
}

/* Layers */

export function addLayer(
  source: TransitionLogicDefinition,
  name: string,
  references: TransitionLogicReferences = {},
): { definition: TransitionLogicDefinition; slotId: string } {
  const definition = structuredClone(source);
  const slotId = createId('slot');
  definition.slots.push({
    id: slotId,
    name: name.trim().slice(0, 256) || `Layer ${definition.slots.length + 1}`,
    order: Math.max(-1, ...definition.slots.map((slot) => slot.order)) + 1,
    defaultTransitionId: definition.defaultTransitionId,
  });
  return { definition: validated(definition, references), slotId };
}

export function renameLayer(
  source: TransitionLogicDefinition,
  slotId: string,
  name: string,
  references: TransitionLogicReferences = {},
): TransitionLogicDefinition {
  const definition = structuredClone(source);
  const slot = definition.slots.find((entry) => entry.id === slotId);
  if (!slot) throw new Error('This layer was removed.');
  if (!name.trim()) throw new Error('Give the layer a name.');
  slot.name = name.trim().slice(0, 256);
  return validated(definition, references);
}

/** A dependent lane can follow any lane except itself or one of its descendants. */
export function layerParentOptions(definition: TransitionLogicDefinition, slotId: string) {
  const excluded = new Set([slotId, ...transitionLogicDependentSlotIds(definition, slotId)]);
  return layersTopFirst(definition).filter((slot) => !excluded.has(slot.id));
}

/** Assign the lane whose Take out/Clear also takes this lane and its descendants off air. */
export function setLayerParent(
  source: TransitionLogicDefinition,
  slotId: string,
  parentSlotId: string | null,
  references: TransitionLogicReferences = {},
): TransitionLogicDefinition {
  const definition = structuredClone(source);
  const slot = definition.slots.find((entry) => entry.id === slotId);
  if (!slot) throw new Error('This layer was removed.');
  if (parentSlotId === null) delete slot.parentSlotId;
  else slot.parentSlotId = parentSlotId;
  return validated(definition, references);
}

/** How the lane shows new data while its template stays on air; `transition` is the default. */
export function setLayerUpdateMode(
  source: TransitionLogicDefinition,
  slotId: string,
  mode: TransitionLogicUpdateMode,
  references: TransitionLogicReferences = {},
): TransitionLogicDefinition {
  const definition = structuredClone(source);
  const slot = definition.slots.find((entry) => entry.id === slotId);
  if (!slot) throw new Error('This lane was removed.');
  if (mode === 'transition') delete slot.updateMode;
  else {
    slot.updateMode = mode;
    definition.version = TRANSITION_LOGIC_VERSION;
  }
  return validated(definition, references);
}

/** Take admission is explicit and does not alter a lane's Out/Clear dependency. */
export function setLayerAdmission(
  source: TransitionLogicDefinition,
  slotId: string,
  admission: import('@ograf-editor/scene-model').TransitionLogicSlot['admission'] | null,
  references: TransitionLogicReferences = {},
): TransitionLogicDefinition {
  const definition = structuredClone(source);
  const slot = definition.slots.find((entry) => entry.id === slotId);
  if (!slot) throw new Error('This lane was removed.');
  if (admission !== null) {
    slot.admission = structuredClone(admission!);
    // Validate raw JSON before pruning an empty guard, including unknown members.
    validated({ ...definition, version: TRANSITION_LOGIC_VERSION }, references);
  }
  if (!admission?.requireOnSlotIds?.length && !admission?.blockWhileActiveSlotIds?.length)
    delete slot.admission;
  else {
    slot.admission = structuredClone(admission!);
    definition.version = TRANSITION_LOGIC_VERSION;
  }
  return validated(definition, references);
}

/** A named state can supply data defaults while sharing the same editable template. */
export function setTemplateDataDefaults(
  source: TransitionLogicDefinition,
  stateId: string,
  defaults: Record<string, unknown> | null,
  references: TransitionLogicReferences = {},
): TransitionLogicDefinition {
  const definition = structuredClone(source);
  const state = definition.states.find((entry) => entry.id === stateId);
  if (!state) throw new Error('This template state was removed.');
  if (!defaults || !Object.keys(defaults).length) delete state.dataDefaults;
  else {
    state.dataDefaults = structuredClone(defaults);
    definition.version = TRANSITION_LOGIC_VERSION;
  }
  return validated(definition, references);
}

/** Swap draw order with the neighbor above (+1) or below (-1). */
export function moveLayer(
  source: TransitionLogicDefinition,
  slotId: string,
  direction: 1 | -1,
  references: TransitionLogicReferences = {},
): TransitionLogicDefinition {
  const definition = structuredClone(source);
  const ordered = [...definition.slots].sort((a, b) => a.order - b.order);
  const index = ordered.findIndex((slot) => slot.id === slotId);
  const neighbor = ordered[index + direction];
  if (index < 0 || !neighbor) return definition;
  // Normalize to distinct orders first so a swap always changes the drawing order.
  ordered.forEach((slot, position) => (slot.order = position));
  const slot = ordered[index]!;
  [slot.order, neighbor.order] = [neighbor.order, slot.order];
  return validated(definition, references);
}

export function layerRemovalBlocker(
  definition: TransitionLogicDefinition,
  slotId: string,
): string | undefined {
  if (definition.slots.length === 1) return 'Keep at least one layer.';
  if (layerStates(definition, slotId).length) return 'Move or remove its templates first.';
  if (definition.sharedInstances.some((instance) => instance.slotId === slotId))
    return 'Remove its on-screen elements first.';
  if (definition.slots.some((slot) => slot.parentSlotId === slotId))
    return 'Set its dependent lanes to Independent first.';
  if (
    definition.slots.some(
      (slot) =>
        slot.admission?.requireOnSlotIds?.includes(slotId) ||
        slot.admission?.blockWhileActiveSlotIds?.includes(slotId),
    )
  )
    return 'Remove references to this lane from Take conditions first.';
  if (
    (definition.layoutRules ?? []).some(
      (rule) => rule.slotId === slotId || rule.whenSlotId === slotId,
    )
  )
    return 'Remove its make-room settings first.';
  return undefined;
}

export function removeLayer(
  source: TransitionLogicDefinition,
  slotId: string,
  references: TransitionLogicReferences = {},
): TransitionLogicDefinition {
  const blocker = layerRemovalBlocker(source, slotId);
  if (blocker) throw new Error(blocker);
  const definition = structuredClone(source);
  definition.slots = definition.slots.filter((slot) => slot.id !== slotId);
  definition.routes = definition.routes.filter((route) => route.slotId !== slotId);
  for (const state of definition.states) {
    if (!state.takeOutSlotIds?.includes(slotId)) continue;
    state.takeOutSlotIds = state.takeOutSlotIds.filter((id) => id !== slotId);
    if (!state.takeOutSlotIds.length) delete state.takeOutSlotIds;
  }
  collectUnusedRecipes(definition);
  return validated(definition, references);
}

/* Templates in layers */

/** Lanes that may leave before this template enters, excluding its own lifetime ancestors. */
export function templateTakeOutOptions(definition: TransitionLogicDefinition, stateId: string) {
  const state = definition.states.find((entry) => entry.id === stateId);
  if (!state) return [];
  return layersTopFirst(definition).filter(
    (slot) =>
      slot.id !== state.slotId &&
      !transitionLogicDependentSlotIds(definition, slot.id).includes(state.slotId),
  );
}

/** Cross-lane takeover is part of the incoming template, independent of its transition recipe. */
export function setTemplateTakeOutSlots(
  source: TransitionLogicDefinition,
  stateId: string,
  slotIds: string[],
  references: TransitionLogicReferences = {},
): TransitionLogicDefinition {
  const definition = structuredClone(source);
  const state = definition.states.find((entry) => entry.id === stateId);
  if (!state) throw new Error('This template was removed from the lane.');
  const unique = [...new Set(slotIds)];
  if (unique.length) state.takeOutSlotIds = unique;
  else delete state.takeOutSlotIds;
  return validated(definition, references);
}

/** With templates, the layer's on-screen elements also pick up where the new template puts them. */
export function addTemplateToLayer(
  source: TransitionLogicDefinition,
  slotId: string,
  templateId: string,
  templateName: string,
  references: TransitionLogicReferences = {},
  templates?: TemplateLookup,
): TransitionLogicDefinition {
  const definition = structuredClone(source);
  if (!definition.slots.some((slot) => slot.id === slotId))
    throw new Error('This layer was removed.');
  definition.states.push({
    id: createId('state'),
    name: templateName.slice(0, 256) || 'Template',
    slotId,
    templateId,
  });
  if (templates) fillLayerFromTemplates(definition, slotId, templates, references);
  return validated(definition, references);
}

/** Its template-specific timings and on-screen element positions belong to the old layer. */
function detachState(definition: TransitionLogicDefinition, stateId: string) {
  definition.routes = definition.routes.filter(
    (route) => route.from !== stateId && route.to !== stateId,
  );
  collectUnusedRecipes(definition);
}

export function removeTemplateFromLayer(
  source: TransitionLogicDefinition,
  stateId: string,
  references: TransitionLogicReferences = {},
): TransitionLogicDefinition {
  const definition = structuredClone(source);
  detachState(definition, stateId);
  definition.states = definition.states.filter((state) => state.id !== stateId);
  return validated(definition, references);
}

export function moveTemplateToLayer(
  source: TransitionLogicDefinition,
  stateId: string,
  slotId: string,
  references: TransitionLogicReferences = {},
  templates?: TemplateLookup,
): TransitionLogicDefinition {
  const definition = structuredClone(source);
  const state = definition.states.find((entry) => entry.id === stateId);
  if (!state) throw new Error('This template was removed from the layer.');
  if (state.slotId === slotId) return definition;
  detachState(definition, stateId);
  state.slotId = slotId;
  state.takeOutSlotIds = state.takeOutSlotIds?.filter((id) => id !== slotId);
  if (!state.takeOutSlotIds?.length) delete state.takeOutSlotIds;
  delete state.sharedValues;
  if (templates) fillLayerFromTemplates(definition, slotId, templates, references);
  return validated(definition, references);
}

/* Elements that stay on screen (shared instances) */

const valueKey = (
  value: Pick<TransitionLogicSharedValue, 'instanceId' | 'sourceLayerId' | 'property'>,
) => JSON.stringify([value.instanceId, value.sourceLayerId, value.property]);

/** The layer that moves an element: explicit, or implied by templates and make-room offsets. */
export function elementOwner(
  definition: TransitionLogicDefinition,
  instance: TransitionLogicSharedInstance,
): string | undefined {
  return (
    instance.slotId ??
    definition.states.find((state) =>
      state.sharedValues?.some((value) => value.instanceId === instance.id),
    )?.slotId ??
    definition.layoutRules?.find((rule) =>
      rule.sharedOffsets.some((value) => value.instanceId === instance.id),
    )?.slotId
  );
}

/* Template layouts: where each template places an element is where the element morphs to. */

/** What a template's own layout decides. Origins and the Off pose stay authored here. */
export const TEMPLATE_POSE_PROPERTIES = [
  'x',
  'y',
  'width',
  'height',
  'opacity',
  'rotation',
] as const;

/** A template's project by ID, normally from the set snapshot that includes unsaved edits. */
export type TemplateLookup = (templateId: string) => Project | undefined;

/** Closer than this is the same placement; editing math leaves tiny residues. */
export const sameElementValue = (a: number, b: number) => Math.abs(a - b) <= 1e-3;

function restingValue(property: string, value: number) {
  if (property === 'opacity') return Math.min(1, Math.max(0, value));
  if (property === 'width' || property === 'height') return Math.max(0, value);
  return value;
}

const identityOf = ({
  instanceId,
  sourceLayerId,
  property,
}: ElementPropertyIdentity): ElementPropertyIdentity => ({ instanceId, sourceLayerId, property });

/**
 * Where a template places a shared element: the resting pose of its linked layers at the
 * template's first on-air step, the pose the coordinator holds. A placement under the shared
 * instance's own ID wins, otherwise the template's first placement of the component counts. A
 * template that doesn't place the component has no values.
 */
export function templateSharedValues(
  instance: Pick<TransitionLogicSharedInstance, 'id' | 'componentAssetId'>,
  project: Project,
): TransitionLogicSharedValue[] {
  const composition = project.compositions.find((entry) => entry.id === project.mainCompositionId);
  if (!composition) return [];
  const placed = composition.layers.filter(
    (layer) => !layer.isGuide && layer.componentLink?.componentId === instance.componentAssetId,
  );
  const placement = (
    placed.find((layer) => layer.componentLink!.instanceId === instance.id) ?? placed[0]
  )?.componentLink!.instanceId;
  const hold =
    composition.keyframes.find((keyframe) => keyframe.role === 'step') ??
    composition.keyframes.find((keyframe) => keyframe.role === 'start');
  const frame =
    computeKeyframeFrames(composition).find((entry) => entry.keyframeId === hold?.id)?.frame ?? 0;
  const seen = new Set<string>();
  return placed.flatMap((layer) => {
    const { instanceId, sourceLayerId } = layer.componentLink!;
    if (instanceId !== placement || seen.has(sourceLayerId)) return [];
    seen.add(sourceLayerId);
    const pose = getLayerTransformAtFrame(layer, frame);
    return TEMPLATE_POSE_PROPERTIES.filter((property) => Number.isFinite(pose[property])).map(
      (property) => ({
        instanceId: instance.id,
        sourceLayerId,
        property,
        value: restingValue(property, pose[property]),
      }),
    );
  });
}

export interface ElementTemplateLayout {
  /** Per state in the element's layer whose template places it: its pose by property key. */
  poses: Map<string, Map<string, TransitionLogicSharedValue & { value: number }>>;
  /** Property keys that morph: the templates disagree with each other or with the Off value. */
  morphing: Set<string>;
}

export function elementTemplateLayout(
  definition: TransitionLogicDefinition,
  instanceId: string,
  templates: TemplateLookup,
  references: TransitionLogicReferences = {},
): ElementTemplateLayout {
  const layout: ElementTemplateLayout = { poses: new Map(), morphing: new Set() };
  const instance = definition.sharedInstances.find((entry) => entry.id === instanceId);
  const slotId = instance && elementOwner(definition, instance);
  if (!instance || !slotId) return layout;
  const sourceLayers = references.componentLayers?.[instance.componentAssetId];
  for (const state of layerStates(definition, slotId)) {
    const project = templates(state.templateId);
    const values = project
      ? templateSharedValues(instance, project).filter(
          (value) => !sourceLayers || sourceLayers.includes(value.sourceLayerId),
        )
      : [];
    if (values.length)
      layout.poses.set(
        state.id,
        new Map(
          values.map((value) => [valueKey(value), value as typeof value & { value: number }]),
        ),
      );
  }
  // Without an Off value, the first template sets the bar the others are compared with.
  const reference = new Map(
    definition.initialSharedValues.flatMap((value) =>
      typeof value.value === 'number' ? [[valueKey(value), value.value] as const] : [],
    ),
  );
  for (const pose of layout.poses.values())
    for (const [key, { value }] of pose) {
      const bar = reference.get(key);
      if (bar === undefined) reference.set(key, value);
      else if (!sameElementValue(bar, value)) layout.morphing.add(key);
    }
  return layout;
}

/**
 * Write template poses into the states of an element's layer. 'fill' adds the morphing properties
 * a template has no value for; 'sync' also puts drifted values back on the layout. Overrides are
 * never touched. A morphing property without an Off value starts at the first template's pose,
 * hidden for a layer-owned element's opacity.
 */
function applyTemplateLayout(
  definition: TransitionLogicDefinition,
  instanceId: string,
  templates: TemplateLookup,
  references: TransitionLogicReferences,
  mode: 'fill' | 'sync',
) {
  const layout = elementTemplateLayout(definition, instanceId, templates, references);
  const instance = definition.sharedInstances.find((entry) => entry.id === instanceId);
  for (const [stateId, pose] of layout.poses) {
    const state = definition.states.find((entry) => entry.id === stateId)!;
    const values = state.sharedValues ?? [];
    for (const [key, derived] of pose) {
      const index = values.findIndex((entry) => valueKey(entry) === key);
      const stored = values[index];
      if (!layout.morphing.has(key) && !(mode === 'sync' && stored)) continue;
      if (stored && (stored.override || mode === 'fill')) continue;
      if (!definition.initialSharedValues.some((entry) => valueKey(entry) === key))
        definition.initialSharedValues.push({
          ...identityOf(derived),
          value: derived.property === 'opacity' && instance?.slotId ? 0 : derived.value,
        });
      const value = { ...identityOf(derived), value: derived.value };
      if (stored) values[index] = value;
      else values.push(value);
    }
    if (values.length) state.sharedValues = values;
  }
}

function fillLayerFromTemplates(
  definition: TransitionLogicDefinition,
  slotId: string,
  templates: TemplateLookup,
  references: TransitionLogicReferences,
) {
  for (const instance of definition.sharedInstances)
    if (elementOwner(definition, instance) === slotId)
      applyTemplateLayout(definition, instance.id, templates, references, 'fill');
}

/** Put every value of an element that drifted from its template layout back on it. */
export function syncElementToTemplates(
  source: TransitionLogicDefinition,
  instanceId: string,
  templates: TemplateLookup,
  references: TransitionLogicReferences = {},
): TransitionLogicDefinition {
  const definition = structuredClone(source);
  applyTemplateLayout(definition, instanceId, templates, references, 'sync');
  return validated(definition, references);
}

/** How one template's value of an element property relates to that template's layout. */
export type ElementCellStatus =
  /** The template doesn't place the element; a value typed here, or the Off value, applies. */
  | { kind: 'manual'; value?: number }
  | { kind: 'template'; value: number }
  | { kind: 'override'; value: number; template: number }
  /** A stored value, or the Off value it falls back to, no longer matches the layout. */
  | { kind: 'drift'; value: number; template: number };

export function elementCellStatus(
  definition: TransitionLogicDefinition,
  layout: ElementTemplateLayout,
  identity: ElementPropertyIdentity,
  stateId: string,
  resting: number,
): ElementCellStatus {
  const key = valueKey(identity);
  const stored = definition.states
    .find((state) => state.id === stateId)
    ?.sharedValues?.find((entry) => valueKey(entry) === key);
  const value = typeof stored?.value === 'number' ? stored.value : undefined;
  const template = layout.poses.get(stateId)?.get(key)?.value;
  if (template === undefined)
    return value === undefined ? { kind: 'manual' } : { kind: 'manual', value };
  if (stored?.override && value !== undefined) return { kind: 'override', value, template };
  const effective = value ?? resting;
  return sameElementValue(effective, template)
    ? { kind: 'template', value: template }
    : { kind: 'drift', value: effective, template };
}

/**
 * Keep a component on screen. With templates, each template in its layer gets the pose where it
 * places the component for every property that differs, so the element morphs with no typing.
 */
export function addElement(
  source: TransitionLogicDefinition,
  instance: Omit<TransitionLogicSharedInstance, 'id' | 'continuityKey'>,
  baseline: TransitionLogicSharedValue[],
  references: TransitionLogicReferences = {},
  templates?: TemplateLookup,
): { definition: TransitionLogicDefinition; instanceId: string } {
  const definition = structuredClone(source);
  const instanceId = createId('shared-instance');
  definition.sharedInstances.push({
    ...instance,
    id: instanceId,
    continuityKey: createId('continuity'),
  });
  definition.initialSharedValues.push(...baseline.map((value) => ({ ...value, instanceId })));
  if (templates) applyTemplateLayout(definition, instanceId, templates, references, 'fill');
  return { definition: validated(definition, references), instanceId };
}

export function removeElement(
  source: TransitionLogicDefinition,
  instanceId: string,
  references: TransitionLogicReferences = {},
): TransitionLogicDefinition {
  const definition = structuredClone(source);
  definition.sharedInstances = definition.sharedInstances.filter(
    (instance) => instance.id !== instanceId,
  );
  definition.initialSharedValues = definition.initialSharedValues.filter(
    (value) => value.instanceId !== instanceId,
  );
  for (const state of definition.states) {
    if (!state.sharedValues) continue;
    state.sharedValues = state.sharedValues.filter((value) => value.instanceId !== instanceId);
    if (!state.sharedValues.length) delete state.sharedValues;
  }
  for (const rule of definition.layoutRules ?? [])
    rule.sharedOffsets = rule.sharedOffsets.filter((value) => value.instanceId !== instanceId);
  return validated(definition, references);
}

export function renameElement(
  source: TransitionLogicDefinition,
  instanceId: string,
  name: string,
  references: TransitionLogicReferences = {},
): TransitionLogicDefinition {
  const definition = structuredClone(source);
  const instance = definition.sharedInstances.find((entry) => entry.id === instanceId);
  if (!instance) throw new Error('This element was removed.');
  if (!name.trim()) throw new Error('Give the element a name.');
  instance.name = name.trim().slice(0, 256);
  return validated(definition, references);
}

export type ElementPropertyIdentity = Pick<
  TransitionLogicSharedValue,
  'instanceId' | 'sourceLayerId' | 'property'
>;

/**
 * Set an element property for one template (stateId) or its off/resting value (null). A template
 * value of undefined clears that template's value so it falls back to the resting value. An
 * override marks a value that deliberately differs from where the template places the element;
 * setting a value without it means the value follows the template layout.
 */
export function setElementValue(
  source: TransitionLogicDefinition,
  identity: ElementPropertyIdentity,
  stateId: string | null,
  value: number | undefined,
  fallbackBaseline: number,
  references: TransitionLogicReferences = {},
  options: { override?: boolean } = {},
): TransitionLogicDefinition {
  if (value !== undefined && !Number.isFinite(value)) throw new Error('Enter a number.');
  const definition = structuredClone(source);
  const key = valueKey(identity);
  let baseline = definition.initialSharedValues.find((entry) => valueKey(entry) === key);
  if (!baseline) {
    baseline = { ...identity, value: fallbackBaseline };
    definition.initialSharedValues.push(baseline);
  }
  if (stateId === null) {
    if (value === undefined) throw new Error('The off value needs a number.');
    baseline.value = value;
    return validated(definition, references);
  }
  const state = definition.states.find((entry) => entry.id === stateId);
  if (!state) throw new Error('This template was removed from the layer.');
  const values = (state.sharedValues ??= []);
  const index = values.findIndex((entry) => valueKey(entry) === key);
  if (value === undefined) {
    if (index >= 0) values.splice(index, 1);
    if (!values.length) delete state.sharedValues;
    return validated(definition, references);
  }
  const entry: TransitionLogicSharedValue = {
    ...identityOf(identity),
    value,
    ...(options.override ? { override: true as const } : {}),
  };
  if (index >= 0) values[index] = entry;
  else values.push(entry);
  return validated(definition, references);
}

/** Stop animating a property: every template follows the resting value again. */
export function clearElementProperty(
  source: TransitionLogicDefinition,
  identity: ElementPropertyIdentity,
  references: TransitionLogicReferences = {},
): TransitionLogicDefinition {
  const definition = structuredClone(source);
  const key = valueKey(identity);
  for (const state of definition.states) {
    if (!state.sharedValues) continue;
    state.sharedValues = state.sharedValues.filter((entry) => valueKey(entry) !== key);
    if (!state.sharedValues.length) delete state.sharedValues;
  }
  return validated(definition, references);
}

/* Make room: while this layer is on air, another layer's elements move or resize. */

export function roomRules(
  definition: TransitionLogicDefinition,
  triggerSlotId: string,
): TransitionLogicLayoutRule[] {
  return (definition.layoutRules ?? []).filter((rule) => rule.whenSlotId === triggerSlotId);
}

export function addRoomRule(
  source: TransitionLogicDefinition,
  triggerSlotId: string,
  affectedSlotId: string,
  references: TransitionLogicReferences = {},
): { definition: TransitionLogicDefinition; ruleId: string } {
  if (triggerSlotId === affectedSlotId) throw new Error('Choose another layer to make room in.');
  const definition = structuredClone(source);
  const trigger = definition.slots.find((slot) => slot.id === triggerSlotId);
  const ruleId = createId('room');
  definition.version = TRANSITION_LOGIC_VERSION;
  (definition.layoutRules ??= []).push({
    id: ruleId,
    name: `Make room for ${trigger?.name ?? 'layer'}`.slice(0, 256),
    slotId: affectedSlotId,
    whenSlotId: triggerSlotId,
    sharedOffsets: [],
  });
  return { definition: validated(definition, references), ruleId };
}

export function removeRoomRule(
  source: TransitionLogicDefinition,
  ruleId: string,
  references: TransitionLogicReferences = {},
): TransitionLogicDefinition {
  const definition = structuredClone(source);
  definition.layoutRules = (definition.layoutRules ?? []).filter((rule) => rule.id !== ruleId);
  if (!definition.layoutRules.length) delete definition.layoutRules;
  return validated(definition, references);
}

/** Add, change (value) or remove (value undefined) one offset of a make-room rule. */
export function setRoomOffset(
  source: TransitionLogicDefinition,
  ruleId: string,
  identity: ElementPropertyIdentity,
  value: number | undefined,
  fallbackBaseline: number,
  references: TransitionLogicReferences = {},
): TransitionLogicDefinition {
  if (value !== undefined && !Number.isFinite(value)) throw new Error('Enter a number.');
  const definition = structuredClone(source);
  const rule = definition.layoutRules?.find((entry) => entry.id === ruleId);
  if (!rule) throw new Error('This make-room setting was removed.');
  const key = valueKey(identity);
  const index = rule.sharedOffsets.findIndex((entry) => valueKey(entry) === key);
  if (value === undefined) {
    if (index >= 0) rule.sharedOffsets.splice(index, 1);
  } else {
    if (!definition.initialSharedValues.some((entry) => valueKey(entry) === key))
      definition.initialSharedValues.push({ ...identity, value: fallbackBaseline });
    if (index >= 0) rule.sharedOffsets[index]!.value = value;
    else rule.sharedOffsets.push({ ...identity, value });
  }
  return validated(definition, references);
}
