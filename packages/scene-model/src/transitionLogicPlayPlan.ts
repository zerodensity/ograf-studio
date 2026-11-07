import {
  transitionLogicErrors,
  transitionLogicOutSlotIds,
  type TransitionLogicDefinition,
  type TransitionLogicSession,
  type TransitionLogicSlot,
  type TransitionLogicState,
} from './transitionLogic';

/** Each stage finishes completely before the next begins; its members may run concurrently. */
export interface TransitionLogicPlayStage {
  outSlotIds: string[];
  takeSlotIds: string[];
}

export interface TransitionLogicPlayBatchPlan {
  valid: boolean;
  errors: string[];
  stages: TransitionLogicPlayStage[];
}

function orderedSlots(definition: TransitionLogicDefinition): TransitionLogicSlot[] {
  // Array order is the stable tie-breaker used by the rest of coordinated playout.
  return definition.slots
    .map((slot, index) => ({ slot, index }))
    .sort((a, b) => a.slot.order - b.slot.order || a.index - b.index)
    .map(({ slot }) => slot);
}

function conflicts(
  definition: TransitionLogicDefinition,
  left: TransitionLogicState,
  right: TransitionLogicState,
): boolean {
  const slot = (id: string) => definition.slots.find((entry) => entry.id === id);
  const takesOut = (state: TransitionLogicState, id: string) =>
    (state.takeOutSlotIds ?? []).some((target) =>
      transitionLogicOutSlotIds(definition, target).includes(id),
    );
  return (
    !!slot(left.slotId)?.admission?.blockWhileActiveSlotIds?.includes(right.slotId) ||
    !!slot(right.slotId)?.admission?.blockWhileActiveSlotIds?.includes(left.slotId) ||
    takesOut(left, right.slotId) ||
    takesOut(right, left.slotId)
  );
}

/**
 * Safe generated controls, not an authored on-air preset. Guarded children start Off. Other lanes
 * choose their first compatible state in stable lane order; command-form suggestions stay separate.
 */
export function safeTransitionLogicStartupStates(
  definition: TransitionLogicDefinition,
): Record<string, string | null> {
  const slots = orderedSlots(definition);
  const defaults: Record<string, string | null> = Object.fromEntries(
    slots.map((slot) => [slot.id, null]),
  );
  const selected: TransitionLogicState[] = [];
  for (const slot of slots) {
    if (slot.admission?.requireOnSlotIds?.length) continue;
    const candidate = definition.states.find(
      (state) =>
        state.slotId === slot.id &&
        !(state.takeOutSlotIds ?? []).some((id) =>
          transitionLogicOutSlotIds(definition, id).includes(slot.id),
        ) &&
        !selected.some((other) => conflicts(definition, state, other)),
    );
    if (candidate) {
      defaults[slot.id] = candidate.id;
      selected.push(candidate);
    }
  }
  return defaults;
}

function currentIntent(session: TransitionLogicSession, slotId: string): string | null {
  const slot = session.slots[slotId];
  if (!slot) return null;
  if (slot.pending) return slot.pending.request.stateId;
  if (slot.transition) return slot.transition.to?.stateId ?? null;
  return slot.desired?.stateId ?? slot.settled?.stateId ?? null;
}

function occupied(session: TransitionLogicSession, slotId: string): boolean {
  const slot = session.slots[slotId];
  return !!(
    slot?.settled ||
    slot?.desired ||
    slot?.transition ||
    slot?.pending ||
    slot?.takeover ||
    slot?.outCascade
  );
}

/**
 * Preflight a complete final intent before changing output or preparing resources. Omitted lanes
 * retain current/queued intent; explicit null permits canceling their preparation and taking Out.
 * Conflicting Take targets never become a partial batch. Runtime stages resources first, then
 * awaits the Out barrier and each required-parent entry barrier on its shared playout clock.
 */
export function planTransitionLogicPlay(
  definition: TransitionLogicDefinition,
  session: TransitionLogicSession,
  requested: Readonly<Record<string, string | null>>,
  preparedSlotIds: readonly string[] = [],
): TransitionLogicPlayBatchPlan {
  const errors = transitionLogicErrors(definition).map((error) => `Cannot Play: ${error}`);
  const failed = (): TransitionLogicPlayBatchPlan => ({
    valid: false,
    errors: [...new Set(errors)],
    stages: [],
  });
  if (session.definitionId !== definition.id)
    errors.push('Cannot Play: the playout session belongs to another definition.');
  const slots = orderedSlots(definition);
  const slotIds = new Set(slots.map((slot) => slot.id));
  const prepared = new Set(preparedSlotIds);
  for (const id of Object.keys(requested))
    if (!slotIds.has(id)) errors.push(`Cannot Play: unknown lane "${id}".`);
  for (const id of prepared)
    if (!slotIds.has(id)) errors.push(`Cannot Play: preparation references unknown lane "${id}".`);
  const final = new Map<string, TransitionLogicState | null>();
  for (const slot of slots) {
    if (!session.slots[slot.id]) errors.push(`Cannot Play: missing session lane "${slot.id}".`);
    const id = Object.hasOwn(requested, slot.id)
      ? requested[slot.id]
      : currentIntent(session, slot.id);
    if (id === null) {
      final.set(slot.id, null);
      continue;
    }
    const state = definition.states.find((entry) => entry.id === id && entry.slotId === slot.id);
    if (!state)
      errors.push(`Cannot Play: state "${String(id)}" does not belong to lane "${slot.name}".`);
    else final.set(slot.id, state);
  }
  if (errors.length) return failed();

  const selected = slots.flatMap((slot) => (final.get(slot.id) ? [final.get(slot.id)!] : []));
  for (const slot of slots) {
    const state = final.get(slot.id);
    if (!state) continue;
    for (const id of slot.admission?.requireOnSlotIds ?? [])
      if (!final.get(id))
        errors.push(
          `Cannot Play ${slot.name}: required lane "${id}" must be selected On in the final batch.`,
        );
    for (const id of slot.admission?.blockWhileActiveSlotIds ?? []) {
      if (final.get(id))
        errors.push(`Cannot Play ${slot.name}: blocking lane "${id}" is also selected On.`);
      else if (prepared.has(id) && !Object.hasOwn(requested, id))
        errors.push(
          `Cannot Play ${slot.name}: lane "${id}" is prepared; explicitly select it Off before this batch.`,
        );
    }
    for (const id of state.takeOutSlotIds ?? [])
      for (const affected of transitionLogicOutSlotIds(definition, id)) {
        if (final.get(affected))
          errors.push(
            `Cannot Play: state "${state.name}" takes lane "${affected}" Out, but that lane is selected On.`,
          );
        else if (prepared.has(affected) && !Object.hasOwn(requested, affected))
          errors.push(
            `Cannot Play: state "${state.name}" conflicts with preparation in lane "${affected}"; explicitly select it Off.`,
          );
      }
  }
  if (errors.length) return failed();

  const stages: TransitionLogicPlayStage[] = [];
  const out = slots
    .filter(
      (slot) =>
        !final.get(slot.id) &&
        (occupied(session, slot.id) ||
          (prepared.has(slot.id) && Object.hasOwn(requested, slot.id))),
    )
    .map((slot) => slot.id);
  // An Out already covers its explicit lifecycle descendants; avoid racing duplicate requests.
  const outRoots = out.filter(
    (id) =>
      !out.some(
        (parent) => parent !== id && transitionLogicOutSlotIds(definition, parent).includes(id),
      ),
  );
  if (outRoots.length) stages.push({ outSlotIds: outRoots, takeSlotIds: [] });

  const remaining = new Set(selected.map((state) => state.slotId));
  while (remaining.size) {
    const ready = slots
      .filter(
        (slot) =>
          remaining.has(slot.id) &&
          (slot.admission?.requireOnSlotIds ?? []).every((id) => !remaining.has(id)),
      )
      .map((slot) => slot.id);
    if (!ready.length) {
      errors.push(`Cannot Play: required-parent cycle among lanes ${[...remaining].join(', ')}.`);
      return failed();
    }
    stages.push({ outSlotIds: [], takeSlotIds: ready });
    for (const id of ready) remaining.delete(id);
  }
  return { valid: true, errors: [], stages };
}
