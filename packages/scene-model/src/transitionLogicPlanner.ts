import { sha256 } from '@noble/hashes/sha2.js';
import { easedProgress } from './layerAnimation';
import {
  transitionLogicAdmissionError,
  transitionLogicErrors,
  transitionLogicOutSlotIds,
} from './transitionLogic';
import type {
  TransitionLogicData,
  TransitionLogicDefinition,
  TransitionLogicEffect,
  TransitionLogicEvent,
  TransitionLogicPlan,
  TransitionLogicPropertyValue,
  TransitionLogicRecipe,
  TransitionLogicRequest,
  TransitionLogicResult,
  TransitionLogicSample,
  TransitionLogicSelection,
  TransitionLogicSession,
  TransitionLogicSharedValue,
  TransitionLogicSlot,
  TransitionLogicSlotSession,
  TransitionLogicState,
} from './transitionLogic';

const REQUEST_HISTORY_LIMIT = 256;

interface DefinitionContext {
  definition: TransitionLogicDefinition;
  revision: string;
  slots: Map<string, TransitionLogicSlot>;
  states: Map<string, TransitionLogicState>;
  recipes: Map<string, TransitionLogicRecipe>;
  initialBySlot: Map<string, TransitionLogicSharedValue[]>;
  orderedSlots: TransitionLogicSlot[];
  initialSharedEntries: Array<[string, TransitionLogicSharedValue]>;
  sharedKeys: Map<string, Map<string, Map<string, string>>>;
}

// Only snapshots produced by prepareTransitionLogicDefinition enter this cache. Arbitrary frozen
// objects may have mutable descendants, so Object.isFrozen alone is not a safe cache condition.
const preparedDefinitions = new WeakMap<TransitionLogicDefinition, DefinitionContext>();

function fail(message: string): never {
  throw new Error(`Transition Logic: ${message}`);
}

function checkFrame(frame: number): void {
  if (!Number.isFinite(frame) || frame < 0) fail('frame must be a finite, non-negative number.');
}

/** Reject values that would silently change or disappear when a session is saved as JSON. */
function copyJson<T>(value: T, ancestors = new Set<object>()): T {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('data contains a non-finite number.');
    return value;
  }
  if (typeof value !== 'object') fail('data must contain only JSON-safe values.');
  if (ancestors.has(value)) fail('data contains a circular reference.');
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    fail('data objects must be plain objects.');
  }
  if (Object.getOwnPropertySymbols(value).length > 0) fail('data must not contain symbol keys.');
  ancestors.add(value);
  let result: unknown;
  if (Array.isArray(value)) {
    result = Array.from(value, (entry) => copyJson(entry, ancestors));
  } else {
    result = Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, copyJson(entry, ancestors)]),
    );
  }
  ancestors.delete(value);
  return result as T;
}

function copyData(value: TransitionLogicData): TransitionLogicData {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('request data must be a JSON object.');
  }
  return copyJson(value);
}

function valueKey(value: TransitionLogicSharedValue): string {
  return JSON.stringify([value.instanceId, value.sourceLayerId, value.property]);
}

function contextValueKey(context: DefinitionContext, value: TransitionLogicSharedValue): string {
  return (
    context.sharedKeys.get(value.instanceId)?.get(value.sourceLayerId)?.get(value.property) ??
    valueKey(value)
  );
}

function copyValues(values: TransitionLogicSharedValue[]): TransitionLogicSharedValue[] {
  return values.map((value) => ({ ...value }));
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function freezeJson<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeJson(child);
    Object.freeze(value);
  }
  return value;
}

function buildContext(definition: TransitionLogicDefinition): DefinitionContext {
  const errors = transitionLogicErrors(definition);
  if (errors.length) fail(errors.join(' '));
  const revision = [...sha256(new TextEncoder().encode(canonicalJson(definition)))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  const slots = new Map(definition.slots.map((slot) => [slot.id, slot]));
  const states = new Map(definition.states.map((state) => [state.id, state]));
  const recipes = new Map(definition.transitions.map((recipe) => [recipe.id, recipe]));
  const owners = new Map<string, string>();
  for (const instance of definition.sharedInstances) {
    if (instance.slotId) owners.set(instance.id, instance.slotId);
  }
  for (const state of states.values()) {
    for (const value of state.sharedValues ?? []) owners.set(value.instanceId, state.slotId);
  }
  for (const rule of definition.layoutRules ?? []) {
    for (const value of rule.sharedOffsets) owners.set(value.instanceId, rule.slotId);
  }
  const initialBySlot = new Map<string, TransitionLogicSharedValue[]>();
  for (const slot of slots.values()) {
    initialBySlot.set(
      slot.id,
      definition.initialSharedValues.filter((value) => owners.get(value.instanceId) === slot.id),
    );
  }
  const initialSharedEntries = definition.initialSharedValues.map(
    (value): [string, TransitionLogicSharedValue] => [valueKey(value), value],
  );
  const sharedKeys: DefinitionContext['sharedKeys'] = new Map();
  for (const [key, value] of initialSharedEntries) {
    let sources = sharedKeys.get(value.instanceId);
    if (!sources) sharedKeys.set(value.instanceId, (sources = new Map()));
    let properties = sources.get(value.sourceLayerId);
    if (!properties) sources.set(value.sourceLayerId, (properties = new Map()));
    properties.set(value.property, key);
  }
  return {
    definition,
    revision,
    slots,
    states,
    recipes,
    initialBySlot,
    orderedSlots: [...slots.values()].sort(
      (a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    ),
    initialSharedEntries,
    sharedKeys,
  };
}

function contextFor(definition: TransitionLogicDefinition): DefinitionContext {
  return preparedDefinitions.get(definition) ?? buildContext(copyJson(definition));
}

/**
 * Clone, validate, and deeply freeze an authored definition for a playout session. Its private
 * compiled lookup tables are reused by reducers and samplers. Later authoring edits to the input
 * cannot change this snapshot; create a new snapshot and session to adopt a new definition.
 */
export function prepareTransitionLogicDefinition(
  definition: TransitionLogicDefinition,
): TransitionLogicDefinition {
  if (preparedDefinitions.has(definition)) return definition;
  const snapshot = copyJson(definition);
  const context = buildContext(snapshot);
  freezeJson(snapshot);
  preparedDefinitions.set(snapshot, context);
  return snapshot;
}

function initialSession(context: DefinitionContext): TransitionLogicSession {
  return {
    definitionId: context.definition.id,
    definitionRevision: context.revision,
    frame: 0,
    slots: Object.fromEntries(
      [...context.slots.keys()].map((slotId) => [
        slotId,
        {
          desired: null,
          settled: null,
          transition: null,
          pending: null,
          readiness: 'idle' as const,
          error: null,
          sharedValues: copyValues(context.initialBySlot.get(slotId) ?? []),
        },
      ]),
    ),
    recentRequestIds: [],
  };
}

/** Create an empty, off-air session. No preparation, timing, or IDs depend on wall-clock time. */
export function createTransitionLogicSession(
  definition: TransitionLogicDefinition,
): TransitionLogicSession {
  return initialSession(contextFor(definition));
}

function slotSession(
  context: DefinitionContext,
  session: TransitionLogicSession,
  slotId: string,
): TransitionLogicSlotSession {
  if (!context.slots.has(slotId) || !Object.hasOwn(session.slots, slotId)) {
    return fail(`unknown slot "${slotId}".`);
  }
  return session.slots[slotId]!;
}

function checkSession(context: DefinitionContext, session: TransitionLogicSession): void {
  if (session.definitionId !== context.definition.id)
    fail('session belongs to another definition.');
  if (session.definitionRevision !== context.revision) {
    fail('definition changed during playout; prepare a new definition and start a new session.');
  }
  checkFrame(session.frame);
  for (const slotId of context.slots.keys()) slotSession(context, session, slotId);
}

function selectRecipe(
  context: DefinitionContext,
  slotId: string,
  from: TransitionLogicSelection | null,
  to: TransitionLogicSelection | null,
): TransitionLogicRecipe {
  const candidates = context.definition.routes
    .filter(
      (route) =>
        route.slotId === slotId &&
        (route.from === '*' || route.from === (from?.stateId ?? null)) &&
        (route.to === '*' || route.to === (to?.stateId ?? null)),
    )
    .map((route) => ({
      route,
      specificity: Number(route.from !== '*') + Number(route.to !== '*'),
    }))
    .sort((a, b) => b.specificity - a.specificity || b.route.priority - a.route.priority);
  const first = candidates[0];
  const second = candidates[1];
  if (
    first &&
    second &&
    first.specificity === second.specificity &&
    first.route.priority === second.route.priority
  )
    fail(`ambiguous routes "${first.route.id}" and "${second.route.id}" for slot "${slotId}".`);
  const slot = context.slots.get(slotId)!;
  const update = from && to && from.stateId === to.stateId;
  const recipeId =
    first?.route.transitionId ??
    (update ? slot.updateTransitionId : undefined) ??
    slot.defaultTransitionId ??
    context.definition.defaultTransitionId;
  return context.recipes.get(recipeId) ?? fail(`missing transition "${recipeId}".`);
}

/** The recipe a same-state update of this selection would play, resolved like a real Take. */
export function transitionLogicUpdateRecipe(
  definition: TransitionLogicDefinition,
  slotId: string,
  selection: TransitionLogicSelection,
): TransitionLogicRecipe {
  return selectRecipe(contextFor(definition), slotId, selection, selection);
}

function targetSharedValues(
  context: DefinitionContext,
  slotId: string,
  selection: TransitionLogicSelection | null,
): TransitionLogicSharedValue[] {
  const values = new Map(
    (context.initialBySlot.get(slotId) ?? []).map((value) => [valueKey(value), { ...value }]),
  );
  const state = selection ? context.states.get(selection.stateId) : undefined;
  for (const value of state?.sharedValues ?? []) values.set(valueKey(value), { ...value });
  return [...values.values()];
}

function liveInstanceIds(slot: TransitionLogicSlotSession): Set<string> {
  return new Set(
    [slot.settled, slot.transition?.from, slot.transition?.to, slot.pending?.selection]
      .filter((selection): selection is TransitionLogicSelection => !!selection)
      .map((selection) => selection.instanceId),
  );
}

function hasRequestId(session: TransitionLogicSession, requestId: string): boolean {
  if (session.recentRequestIds.includes(requestId)) return true;
  // An old request can remain on air longer than the bounded recent-request journal.
  return Object.values(session.slots).some((slot) =>
    [
      slot.desired?.requestId,
      slot.settled?.requestId,
      slot.transition?.requestId,
      slot.transition?.from?.requestId,
      slot.pending?.request.requestId,
    ].includes(requestId),
  );
}

function releaseUnused(
  slotId: string,
  instanceIds: Iterable<string>,
  slot: TransitionLogicSlotSession,
  effects: TransitionLogicEffect[],
): void {
  const live = liveInstanceIds(slot);
  for (const instanceId of new Set(instanceIds)) {
    if (
      !live.has(instanceId) &&
      !effects.some(
        (effect) =>
          effect.type === 'release' && effect.slotId === slotId && effect.instanceId === instanceId,
      )
    )
      effects.push({ type: 'release', slotId, instanceId });
  }
}

function startPending(
  context: DefinitionContext,
  session: TransitionLogicSession,
  slotId: string,
  slot: TransitionLogicSlotSession,
  frame: number,
  effects: TransitionLogicEffect[],
): void {
  const pending = slot.pending;
  if (slot.transition || !pending?.ready) return;
  const admissionError = transitionLogicAdmissionError(
    context.definition,
    session,
    slotId,
    pending.selection?.stateId ?? null,
  );
  if (admissionError) {
    const instanceId = pending.selection?.instanceId;
    slot.pending = null;
    slot.desired = slot.settled;
    slot.readiness = 'failed';
    slot.error = admissionError;
    delete slot.takeover;
    effects.push({
      type: 'rejected',
      slotId,
      requestId: pending.request.requestId,
      message: admissionError,
    });
    releaseUnused(slotId, instanceId ? [instanceId] : [], slot, effects);
    return;
  }
  if (
    pending.selection &&
    slot.outCascade?.slotIds.some((id) => {
      const dependent = session.slots[id]!;
      return (
        dependent.transition !== null || dependent.pending !== null || dependent.settled !== null
      );
    })
  )
    return;
  const state = pending.selection ? context.states.get(pending.selection.stateId) : undefined;
  if (state?.takeOutSlotIds?.length && slot.settled?.stateId !== state.id) {
    if (!slot.takeover) {
      const outSlotIds = [
        ...new Set(
          state.takeOutSlotIds.flatMap((id) => transitionLogicOutSlotIds(context.definition, id)),
        ),
      ];
      const outRequestIds = outSlotIds.map((id) => {
        const digest = [
          ...sha256(new TextEncoder().encode(JSON.stringify([pending.request.requestId, id]))),
        ]
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join('');
        return `takeover-${digest}`;
      });
      // Nested Out reductions can drain zero-duration transitions. Keep the entry closed until
      // every affected lane has received its Out, including lanes that were only preparing.
      slot.takeover = { requestId: pending.request.requestId, outSlotIds, dispatching: true };
      effects.push({
        type: 'takeover',
        frame,
        slotId,
        requestId: pending.request.requestId,
        outSlotIds: [...outSlotIds],
        outRequestIds,
      });
      for (const [index, id] of outSlotIds.entries()) {
        applyEvent(
          context,
          session,
          {
            type: 'request',
            frame,
            slotId: id,
            stateId: null,
            requestId: outRequestIds[index]!,
          },
          effects,
          true,
        );
      }
      delete slot.takeover.dispatching;
    }
    if (
      slot.takeover.dispatching ||
      slot.takeover.outSlotIds.some((id) => {
        const target = session.slots[id]!;
        return !!(target.desired || target.settled || target.transition || target.pending);
      })
    )
      return;
  }
  delete slot.takeover;
  if (pending.selection) delete slot.outCascade;
  slot.pending = null;
  slot.readiness = 'ready';
  slot.error = null;
  // Off -> Off is already settled; do not manufacture an invisible transition.
  if (!slot.settled && !pending.selection) {
    slot.sharedValues = targetSharedValues(context, slotId, null);
    slot.readiness = 'idle';
    effects.push({ type: 'settled', slotId, selection: null });
    return;
  }
  const recipe = selectRecipe(context, slotId, slot.settled, pending.selection);
  const endFrame = frame + recipe.durationFrames;
  checkFrame(endFrame);
  const plan: TransitionLogicPlan = {
    id: `plan:${JSON.stringify([slotId, pending.request.requestId])}`,
    requestId: pending.request.requestId,
    slotId,
    from: slot.settled ? copyJson(slot.settled) : null,
    to: pending.selection ? copyJson(pending.selection) : null,
    transitionId: recipe.id,
    startFrame: frame,
    endFrame,
    sharedFrom: copyValues(slot.sharedValues),
    sharedTo: targetSharedValues(context, slotId, pending.selection),
  };
  slot.transition = plan;
  effects.push({ type: 'started', slotId, plan: copyJson(plan) });
}

function completeTransition(
  slotId: string,
  slot: TransitionLogicSlotSession,
  effects: TransitionLogicEffect[],
): void {
  const plan = slot.transition!;
  slot.settled = plan.to;
  slot.sharedValues = copyValues(plan.sharedTo);
  slot.transition = null;
  if (slot.readiness !== 'failed') {
    slot.readiness = slot.pending ? (slot.pending.ready ? 'ready' : 'preparing') : 'idle';
  }
  effects.push({
    type: 'settled',
    slotId,
    selection: slot.settled ? copyJson(slot.settled) : null,
  });
  releaseUnused(slotId, plan.from ? [plan.from.instanceId] : [], slot, effects);
}

/** A finished exit barrier must not capture unrelated future child Takes. */
function clearCompletedCascades(session: TransitionLogicSession): void {
  for (const slot of Object.values(session.slots)) {
    if (
      slot.outCascade &&
      !slot.settled &&
      !slot.transition &&
      slot.outCascade.slotIds.every((id) => {
        const dependent = session.slots[id]!;
        return !dependent.settled && !dependent.transition && !dependent.pending;
      })
    )
      delete slot.outCascade;
  }
}

/** Drain completions chronologically across slots, including ready queued requests. */
function advanceTo(
  context: DefinitionContext,
  session: TransitionLogicSession,
  frame: number,
  effects: TransitionLogicEffect[],
): void {
  checkFrame(frame);
  if (frame < session.frame) fail('events cannot move backward; replay the event log to seek.');
  while (true) {
    let nextSlotId: string | null = null;
    let nextFrame = Infinity;
    for (const slotId of context.slots.keys()) {
      const transition = session.slots[slotId]!.transition;
      if (transition && transition.endFrame <= frame && transition.endFrame < nextFrame) {
        nextSlotId = slotId;
        nextFrame = transition.endFrame;
      }
    }
    if (nextSlotId === null) break;
    const slot = session.slots[nextSlotId]!;
    completeTransition(nextSlotId, slot, effects);
    clearCompletedCascades(session);
    // A parent's queued Take may be waiting for a slower dependent's exit. Drain ready
    // Off -> Off requests too: they can release a barrier without creating a transition.
    let started: boolean;
    do {
      started = false;
      for (const id of context.slots.keys()) {
        const entry = session.slots[id]!;
        const pending = entry.pending;
        startPending(context, session, id, entry, nextFrame, effects);
        if (pending && entry.pending !== pending) started = true;
      }
    } while (started);
  }
  clearCompletedCascades(session);
  session.frame = frame;
}

function requestSelection(
  context: DefinitionContext,
  slot: TransitionLogicSlotSession,
  request: TransitionLogicRequest,
): TransitionLogicSelection | null {
  if (request.stateId === null) return null;
  const state = context.states.get(request.stateId);
  if (!state || state.slotId !== request.slotId) {
    return fail(`state "${request.stateId}" does not belong to slot "${request.slotId}".`);
  }
  const predecessor = slot.transition ? slot.transition.to : slot.settled;
  const retainsInstance = predecessor?.stateId === state.id;
  return {
    requestId: request.requestId,
    instanceId: retainsInstance
      ? predecessor.instanceId
      : `instance:${JSON.stringify([request.slotId, request.requestId])}`,
    stateId: state.id,
    templateId: state.templateId,
    data: copyData({
      ...state.dataDefaults,
      ...(request.data === undefined ? (retainsInstance ? predecessor.data : {}) : request.data),
    }),
  };
}

function applyEvent(
  context: DefinitionContext,
  session: TransitionLogicSession,
  event: TransitionLogicEvent,
  effects: TransitionLogicEffect[],
  takeoverOut = false,
): void {
  if (!['request', 'ready', 'failed', 'advance', 'clear'].includes(event.type)) {
    fail('unknown event type.');
  }
  advanceTo(context, session, event.frame, effects);
  if (event.type === 'advance') return;
  if (event.type === 'clear') {
    const slotIds =
      event.slotId === undefined
        ? [...context.slots.keys()]
        : transitionLogicOutSlotIds(context.definition, event.slotId);
    for (const slotId of slotIds) {
      const slot = slotSession(context, session, slotId);
      const previousIds = liveInstanceIds(slot);
      slot.desired = null;
      slot.settled = null;
      slot.transition = null;
      slot.pending = null;
      slot.readiness = 'idle';
      slot.error = null;
      slot.sharedValues = targetSharedValues(context, slotId, null);
      delete slot.outCascade;
      delete slot.takeover;
      releaseUnused(slotId, previousIds, slot, effects);
      if (previousIds.size > 0) effects.push({ type: 'settled', slotId, selection: null });
    }
    // Clearing one of the outgoing lanes can satisfy an already prepared takeover immediately.
    for (const [id, entry] of Object.entries(session.slots))
      startPending(context, session, id, entry, event.frame, effects);
    advanceTo(context, session, event.frame, effects);
    return;
  }
  const slot = slotSession(context, session, event.slotId);
  if (
    typeof event.requestId !== 'string' ||
    !event.requestId.trim() ||
    event.requestId.length > 256
  ) {
    fail('requestId must be a non-empty string of at most 256 characters.');
  }
  if (event.type === 'request') {
    if (hasRequestId(session, event.requestId)) return;
    const admissionError = transitionLogicAdmissionError(
      context.definition,
      session,
      event.slotId,
      event.stateId,
    );
    if (admissionError) fail(admissionError);
    if (event.stateId !== null) {
      const incomingState = context.states.get(event.stateId);
      const replaces = new Set(
        (incomingState?.takeOutSlotIds ?? []).flatMap((id) =>
          transitionLogicOutSlotIds(context.definition, id),
        ),
      );
      for (const [ownerId, owner] of Object.entries(session.slots)) {
        // A reciprocal replacement may prepare while its preceding exit is finishing. The old
        // entry remains blocked by this pending selection until preparation succeeds. Its actual
        // Out is dispatched only then, so a failed replacement leaves working output intact.
        if (owner.takeover?.outSlotIds.includes(event.slotId) && !replaces.has(ownerId))
          fail(
            `slot "${event.slotId}" cannot Take while takeover in slot "${ownerId}" is waiting for it to leave.`,
          );
      }
      for (const [parentId, parent] of Object.entries(session.slots)) {
        if (!parent.outCascade?.slotIds.includes(event.slotId)) continue;
        const exiting = [parentId, ...parent.outCascade.slotIds].some((id) => {
          const entry = session.slots[id]!;
          return (
            (entry.transition !== null && entry.transition.to === null) ||
            (entry.pending !== null && entry.pending.selection === null)
          );
        });
        if (exiting)
          fail(
            `slot "${event.slotId}" cannot Take while parent "${parentId}" is exiting; Take it explicitly after the parent returns.`,
          );
      }
    } else {
      const affected = transitionLogicOutSlotIds(context.definition, event.slotId).slice(1);
      if (affected.length) {
        const alreadyExiting =
          slot.outCascade &&
          ((slot.transition !== null && slot.transition.to === null) ||
            (slot.pending !== null && slot.pending.selection === null));
        const layoutOccupancy = alreadyExiting
          ? slot.outCascade!.layoutOccupancy
          : Object.fromEntries(
              affected.map((id) => [id, slotOccupancy(context, session.slots[id]!, event.frame)]),
            );
        // Descendants receive actual Out requests, replacing pending activation intent.
        slot.outCascade = { slotIds: affected, layoutOccupancy };
        for (const id of (takeoverOut ? [] : affected).filter(
          (id) => context.slots.get(id)!.parentSlotId === event.slotId,
        )) {
          const digest = [
            ...sha256(new TextEncoder().encode(JSON.stringify([event.requestId, id]))),
          ]
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join('');
          applyEvent(
            context,
            session,
            {
              type: 'request',
              frame: event.frame,
              requestId: `cascade-${digest}`,
              slotId: id,
              stateId: null,
            },
            effects,
          );
        }
      }
    }
    const selection = requestSelection(context, slot, event);
    const previousPendingId = slot.pending?.selection?.instanceId;
    const request: TransitionLogicRequest = {
      requestId: event.requestId,
      slotId: event.slotId,
      stateId: event.stateId,
      ...(event.data === undefined ? {} : { data: copyData(event.data) }),
    };
    session.recentRequestIds = [...session.recentRequestIds, event.requestId].slice(
      -REQUEST_HISTORY_LIMIT,
    );
    slot.desired = selection;
    delete slot.takeover;
    slot.pending = { request, selection, ready: selection === null };
    slot.error = null;
    slot.readiness = selection ? 'preparing' : 'ready';
    releaseUnused(event.slotId, previousPendingId ? [previousPendingId] : [], slot, effects);
    if (selection) {
      effects.push({ type: 'prepare', slotId: event.slotId, selection: copyJson(selection) });
    }
    startPending(context, session, event.slotId, slot, event.frame, effects);
    if (event.stateId === null && !takeoverOut) {
      // Off -> Off can cancel a reciprocal preparation after its preceding exit has already
      // settled. No future completion exists to reopen the original ready entry barrier.
      for (const [id, entry] of Object.entries(session.slots))
        if (entry.takeover && !entry.takeover.dispatching)
          startPending(context, session, id, entry, event.frame, effects);
    }
  } else if (slot.pending?.request.requestId === event.requestId) {
    const admissionError =
      event.type === 'ready'
        ? transitionLogicAdmissionError(
            context.definition,
            session,
            event.slotId,
            slot.pending.selection?.stateId ?? null,
          )
        : null;
    if (event.type === 'ready' && !admissionError) {
      slot.pending.ready = true;
      slot.readiness = 'ready';
      startPending(context, session, event.slotId, slot, event.frame, effects);
    } else if (event.type === 'failed' || admissionError) {
      const failedInstance = slot.pending.selection?.instanceId;
      slot.pending = null;
      slot.desired = slot.transition ? slot.transition.to : slot.settled;
      delete slot.takeover;
      slot.readiness = 'failed';
      slot.error =
        admissionError ||
        (event.type === 'failed' ? event.message : '') ||
        'Incoming graphic preparation failed.';
      if (admissionError)
        effects.push({
          type: 'rejected',
          slotId: event.slotId,
          requestId: event.requestId,
          message: admissionError,
        });
      releaseUnused(event.slotId, failedInstance ? [failedInstance] : [], slot, effects);
      // A failed reciprocal preparation no longer holds another lane's ready exit barrier.
      for (const [id, entry] of Object.entries(session.slots))
        startPending(context, session, id, entry, event.frame, effects);
    }
  }
  // Zero-duration recipes settle during the same event, not on a later animation tick.
  advanceTo(context, session, event.frame, effects);
}

/**
 * Pure event reducer. Ready/failed must identify the preparation request; stale callbacks are ignored.
 * Requests replace only the queued request. The current transition always finishes first.
 * A prepare effect never authorizes changing visible content, even if its instanceId is already on
 * air. Stage each data snapshot by requestId and present it only when its started effect arrives.
 */
export function reduceTransitionLogic(
  definition: TransitionLogicDefinition,
  session: TransitionLogicSession,
  event: TransitionLogicEvent,
): TransitionLogicResult {
  const context = contextFor(definition);
  checkSession(context, session);
  const next = copyJson(session);
  const effects: TransitionLogicEffect[] = [];
  applyEvent(context, next, event, effects);
  return { session: next, effects };
}

function phaseProgress(elapsed: number, start: number, duration: number): number {
  if (elapsed < start) return 0;
  return duration === 0 ? 1 : Math.min(1, Math.max(0, (elapsed - start) / duration));
}

function slotOccupancy(
  context: DefinitionContext,
  slot: TransitionLogicSlotSession,
  frame: number,
): number {
  const plan = slot.transition;
  if (!plan) return slot.settled ? 1 : 0;
  if (plan.from && plan.to) return 1;
  const recipe = context.recipes.get(plan.transitionId)!;
  const elapsed = frame - plan.startFrame;
  if (recipe.layoutPhase) {
    const phase = easedProgress(
      phaseProgress(elapsed, recipe.layoutPhase.startFrame, recipe.layoutPhase.durationFrames),
      recipe.easing,
    );
    return plan.to ? phase : plan.from ? 1 - phase : 0;
  }
  return plan.to
    ? easedProgress(
        phaseProgress(elapsed, recipe.incomingStartFrame, recipe.incomingFrames),
        recipe.easing,
      )
    : plan.from
      ? 1 - easedProgress(phaseProgress(elapsed, 0, recipe.outgoingFrames), recipe.easing)
      : 0;
}

function parseColor(value: string): number[] | null {
  const hex = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.exec(value.trim())?.[1];
  if (hex) {
    const expanded = hex.length <= 4 ? [...hex].map((digit) => digit + digit).join('') : hex;
    return [
      parseInt(expanded.slice(0, 2), 16),
      parseInt(expanded.slice(2, 4), 16),
      parseInt(expanded.slice(4, 6), 16),
      expanded.length === 8 ? parseInt(expanded.slice(6, 8), 16) / 255 : 1,
    ];
  }
  if (value.trim().toLowerCase() === 'transparent') return [0, 0, 0, 0];
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(
    value,
  );
  if (!rgb) return null;
  const result = [
    Number(rgb[1]),
    Number(rgb[2]),
    Number(rgb[3]),
    rgb[4] === undefined ? 1 : Number(rgb[4]),
  ];
  return result.every(
    (channel, index) =>
      Number.isFinite(channel) && channel >= 0 && channel <= (index === 3 ? 1 : 255),
  )
    ? result
    : null;
}

function interpolateValue(
  from: TransitionLogicPropertyValue,
  to: TransitionLogicPropertyValue,
  progress: number,
): TransitionLogicPropertyValue {
  if (progress <= 0 || from === to) return from;
  if (progress >= 1) return to;
  if (typeof from === 'number' && typeof to === 'number')
    return from * (1 - progress) + to * progress;
  if (typeof from === 'string' && typeof to === 'string') {
    const a = parseColor(from);
    const b = parseColor(to);
    if (a && b) {
      const channels = a.map((channel, index) => channel * (1 - progress) + b[index]! * progress);
      return `rgba(${Math.round(channels[0]!)}, ${Math.round(channels[1]!)}, ${Math.round(channels[2]!)}, ${Number(channels[3]!.toFixed(5))})`;
    }
  }
  return from;
}

function sampleShared(
  context: DefinitionContext,
  plan: TransitionLogicPlan,
  progress: number,
): TransitionLogicSharedValue[] {
  const previous = new Map(
    plan.sharedFrom.map((value) => [contextValueKey(context, value), value]),
  );
  const recipe = context.recipes.get(plan.transitionId);
  const choice = plan.to ? recipe?.incomingAnimation : recipe?.outgoingAnimation;
  const authoredLifetime =
    (recipe?.contentMotion === 'authored' || choice?.type === 'template') &&
    (!plan.from || !plan.to);
  return plan.sharedTo.map((value) => {
    const from = previous.get(contextValueKey(context, value))?.value ?? value.value;
    return {
      ...value,
      // Authored layer IN/OUT already controls opacity. An aggregate Off pin would otherwise
      // fade the whole component as well, hiding the first bracket and softening its final exit.
      // Other geometry still follows sharedFrames; on-air replacements retain their morph.
      value:
        authoredLifetime && value.property === 'opacity'
          ? plan.to
            ? value.value
            : from
          : interpolateValue(from, value.value, progress),
    };
  });
}

/**
 * Read a pose at or after session.frame without changing the session. Replaying the event log is
 * required for backward seeking: a settled session intentionally does not retain its old history.
 */
export function sampleTransitionLogic(
  definition: TransitionLogicDefinition,
  session: TransitionLogicSession,
  frame: number,
): TransitionLogicSample {
  const context = contextFor(definition);
  checkSession(context, session);
  checkFrame(frame);
  if (frame < session.frame) fail('events cannot move backward; replay the event log to seek.');
  // Ordinary renders read the current session or an unfinished pose. Only a due completion can
  // change planner state. Keep that slower path isolated, without cloning its entire journal,
  // pending preparations and shared tracks on every stable render or operator snapshot.
  const hasCompletion = context.orderedSlots.some((slot) => {
    const plan = session.slots[slot.id]!.transition;
    return plan !== null && plan.endFrame <= frame;
  });
  const snapshot = hasCompletion ? copyJson(session) : session;
  if (hasCompletion) advanceTo(context, snapshot, frame, []);
  const selections = new Map<TransitionLogicSelection, TransitionLogicSelection>();
  const copySelection = (
    selection: TransitionLogicSelection | null,
  ): TransitionLogicSelection | null => {
    if (!selection) return null;
    let copy = selections.get(selection);
    if (!copy) selections.set(selection, (copy = copyJson(selection)));
    return copy;
  };
  const sharedValues = new Map(
    context.initialSharedEntries.map(([key, value]) => [key, { ...value }]),
  );
  const slots = context.orderedSlots.map((definitionSlot) => {
    const slot = snapshot.slots[definitionSlot.id]!;
    const plan = slot.transition;
    const recipe = plan ? context.recipes.get(plan.transitionId)! : null;
    const elapsed = plan ? frame - plan.startFrame : 0;
    const progress = plan && recipe ? phaseProgress(elapsed, 0, recipe.durationFrames) : 1;
    const sampledShared =
      plan && recipe
        ? sampleShared(
            context,
            plan,
            easedProgress(phaseProgress(elapsed, 0, recipe.sharedFrames), recipe.easing),
          )
        : copyValues(slot.sharedValues);
    for (const value of sampledShared)
      sharedValues.set(contextValueKey(context, value), { ...value });
    return {
      slotId: definitionSlot.id,
      desired: copySelection(slot.desired),
      settled: copySelection(slot.settled),
      outgoing: copySelection(plan?.from ?? null),
      incoming: copySelection(plan ? plan.to : slot.settled),
      outgoingOpacity:
        plan?.from && recipe
          ? 1 - easedProgress(phaseProgress(elapsed, 0, recipe.outgoingFrames), recipe.easing)
          : 0,
      incomingOpacity:
        plan?.to && recipe
          ? easedProgress(
              phaseProgress(elapsed, recipe.incomingStartFrame, recipe.incomingFrames),
              recipe.easing,
            )
          : plan || !slot.settled
            ? 0
            : 1,
      progress,
      sharedValues: sampledShared,
      transitionId: plan?.transitionId ?? null,
      readiness: slot.readiness,
      error: slot.error,
    };
  });
  if (context.definition.layoutRules?.length) {
    const slotSamples = new Map(slots.map((slot) => [slot.slotId, slot]));
    const sharedBySlot = new Map(
      slots.map((slot) => [
        slot.slotId,
        new Map(slot.sharedValues.map((value) => [contextValueKey(context, value), value])),
      ]),
    );
    for (const rule of context.definition.layoutRules) {
      const observed = slotSamples.get(rule.whenSlotId)!;
      // A replacement or data update keeps its reserved space even during a content fade gap.
      // Preparation alone never reserves space; only the actual on-air transition contributes.
      let occupancy =
        observed.outgoing && observed.incoming
          ? 1
          : observed.incoming
            ? observed.incomingOpacity
            : observed.outgoingOpacity;
      const plan = snapshot.slots[rule.whenSlotId]!.transition;
      const recipe = plan ? context.recipes.get(plan.transitionId)! : null;
      // Optional occupancy timing reserves room before entry and releases it after exit.
      // Replacements retain full occupancy; neither pending preparation nor a Clear creates a phase.
      if (plan && recipe?.layoutPhase && !(plan.from && plan.to)) {
        const phase = easedProgress(
          phaseProgress(
            frame - plan.startFrame,
            recipe.layoutPhase.startFrame,
            recipe.layoutPhase.durationFrames,
          ),
          recipe.easing,
        );
        occupancy = plan.to ? phase : plan.from ? 1 - phase : 0;
      }
      const target = snapshot.slots[rule.slotId]!;
      if (
        target.transition &&
        !target.transition.to &&
        target.outCascade &&
        Object.hasOwn(target.outCascade.layoutOccupancy, rule.whenSlotId)
      ) {
        // Whole-graphic exits keep the occupied pose until the parent disappears, avoiding
        // a collapse/expand flash while optional content retracts on its own exit timing.
        occupancy = target.outCascade.layoutOccupancy[rule.whenSlotId]!;
      }
      for (const offset of rule.sharedOffsets) {
        const key = contextValueKey(context, offset);
        const base = sharedValues.get(key)!;
        const adjusted = {
          ...base,
          value: (base.value as number) + (offset.value as number) * occupancy,
        };
        sharedValues.set(key, adjusted);
        sharedBySlot.get(rule.slotId)!.set(key, adjusted);
      }
    }
    for (const slot of slots) slot.sharedValues = [...sharedBySlot.get(slot.slotId)!.values()];
  }
  return { frame, slots, sharedValues: [...sharedValues.values()] };
}

/** Replay explicit events from Off. Equal-frame events retain their original input order. */
export function replayTransitionLogic(
  definition: TransitionLogicDefinition,
  events: readonly TransitionLogicEvent[],
  frame: number,
): TransitionLogicSession {
  checkFrame(frame);
  const context = contextFor(definition);
  const ordered = events
    .map((event, index) => {
      checkFrame(event.frame);
      return { event, index };
    })
    .sort((a, b) => a.event.frame - b.event.frame || a.index - b.index);
  const session = initialSession(context);
  for (const { event } of ordered) {
    if (event.frame > frame) break;
    applyEvent(context, session, event, []);
  }
  advanceTo(context, session, frame, []);
  return session;
}
