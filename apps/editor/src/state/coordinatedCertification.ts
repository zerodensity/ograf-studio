import {
  getElementShaderPaints,
  type TransitionLogicDefinition,
  type TransitionLogicState,
} from '@ograf-editor/scene-model';
import type {
  CompiledGraphicDescriptor,
  CompiledTransitionLogicDescriptor,
  CoordinatedPlayoutSnapshot,
} from '@ograf-editor/ograf-types';

/** Match the runtime's shared-only template optimization: its retained sources own every pixel,
 * so no second invisible proxy canvases are allocated. Mixed scenes still retain their proxies. */
export function coordinatedCertificationCanvasCounts(
  template: Pick<
    CompiledTransitionLogicDescriptor['templates'][number],
    'descriptor' | 'sharedLayers'
  >,
  sharedDescriptors: CompiledGraphicDescriptor[],
) {
  const proxies = new Set(template.sharedLayers.map((layer) => layer.layerId));
  const sharedOnly =
    !template.descriptor.collections?.length &&
    template.descriptor.layers.length > 0 &&
    template.descriptor.layers.every((layer) => proxies.has(layer.id));
  const descriptors = [...(sharedOnly ? [] : [template.descriptor]), ...sharedDescriptors];
  let canvases = 0;
  let shaders = 0;
  for (const descriptor of descriptors) {
    const groups = [
      { layers: descriptor.layers, copies: 1 },
      ...(descriptor.collections ?? []).map((collection) => ({
        layers: collection.prototypeLayers,
        copies: collection.capacity,
      })),
    ];
    for (const { layers, copies } of groups)
      for (const layer of layers) {
        const paints = getElementShaderPaints(layer.element).length;
        shaders += paints * copies;
        canvases +=
          (paints + (layer.element.type === 'lottie' && layer.element.animationData ? 1 : 0)) *
          copies;
      }
  }
  return { canvases, shaders };
}

/** This Studio-specific gate checks execution success in addition to the OGraf payload validator. */
export function coordinatedCertificationSuccessErrors(payload: unknown): string[] {
  return payload &&
    typeof payload === 'object' &&
    (payload as { statusCode?: unknown }).statusCode === 200
    ? []
    : ['Expected successful statusCode 200.'];
}

export function coordinatedCertificationStateErrors(
  expected: Readonly<Record<string, string | null>>,
  snapshot: CoordinatedPlayoutSnapshot | null,
): string[] {
  if (!snapshot) return ['Coordinated runtime did not expose its actual playout state.'];
  const errors: string[] = [];
  if (!snapshot.loaded) errors.push('Coordinated runtime is not loaded.');
  if (snapshot.error) errors.push(`Coordinated runtime failed: ${snapshot.error}`);
  for (const [id, stateId] of Object.entries(expected)) {
    const slot = snapshot.slots[id];
    if (!slot) {
      errors.push(`Startup lane ${id} is missing.`);
      continue;
    }
    if ((slot.current?.stateId ?? null) !== stateId || slot.pending || slot.transition)
      errors.push(
        `Startup lane ${id} did not settle ${stateId === null ? 'Off' : `on state ${stateId}`}.`,
      );
  }
  return errors;
}

/** A settled baseline must actually be witnessed; later authored Rules may then change it. */
export function createCoordinatedStartupEvidence(
  expected: Readonly<Record<string, string | null>>,
) {
  let entered = false;
  return {
    get entered() {
      return entered;
    },
    observe(snapshot: CoordinatedPlayoutSnapshot | null) {
      if (!coordinatedCertificationStateErrors(expected, snapshot).length) entered = true;
    },
    errors(snapshot: CoordinatedPlayoutSnapshot | null): string[] {
      return coordinatedCertificationStateErrors(entered ? {} : expected, snapshot);
    },
  };
}

/** Wall-clock frame/transport progression is excluded; retained output and preparation must match. */
export function coordinatedCertificationOutputIdentity(
  snapshot: CoordinatedPlayoutSnapshot,
): string {
  return JSON.stringify({
    slots: snapshot.slots,
    prepared: snapshot.prepared,
    error: snapshot.error,
  });
}

/** Follow actual startup transitions, never an unrelated recipe or a later timer/Rules horizon. */
export function coordinatedCertificationNextTransitionFrame(
  snapshot: CoordinatedPlayoutSnapshot | null,
): number | null {
  if (!snapshot || snapshot.error) return null;
  const boundaries = Object.values(snapshot.slots).flatMap((slot) =>
    slot.transition &&
    Number.isFinite(slot.transition.endFrame) &&
    slot.transition.endFrame > snapshot.frame
      ? [slot.transition.endFrame]
      : [],
  );
  return boundaries.length ? Math.min(...boundaries) : null;
}

export function coordinatedCertificationRejectionErrors(
  payload: unknown,
  before: CoordinatedPlayoutSnapshot | null,
  after: CoordinatedPlayoutSnapshot | null,
): string[] {
  const status =
    payload && typeof payload === 'object'
      ? (payload as { statusCode?: unknown }).statusCode
      : undefined;
  const errors =
    typeof status === 'number' && status >= 400
      ? []
      : ['Conflicting Play did not return an explicit error status.'];
  if (!before || !after) errors.push('Could not inspect output before and after conflicting Play.');
  else if (
    coordinatedCertificationOutputIdentity(before) !== coordinatedCertificationOutputIdentity(after)
  )
    errors.push('Conflicting Play changed retained output or resource preparation.');
  return errors;
}

/** Invalid complete intents exercise admission without changing the graph or its validators. */
export function coordinatedCertificationConflicts(definition: TransitionLogicDefinition) {
  const baseline = Object.fromEntries(definition.slots.map((slot) => [slot.id, null])) as Record<
    string,
    string | null
  >;
  const cases = new Map<string, { name: string; states: Record<string, string | null> }>();
  const first = (id: string) => definition.states.find((state) => state.slotId === id);
  const add = (name: string, states: Record<string, string | null>) => {
    const value = { ...baseline, ...states };
    cases.set(JSON.stringify(value), { name, states: value });
  };
  for (const slot of definition.slots) {
    const state = first(slot.id);
    if (!state) continue;
    for (const parent of slot.admission?.requireOnSlotIds ?? [])
      add(`${slot.name} with required lane ${parent} Off`, { [slot.id]: state.id, [parent]: null });
    for (const blocked of slot.admission?.blockWhileActiveSlotIds ?? []) {
      const blocker = first(blocked);
      if (blocker)
        add(`${slot.name} with blocking lane ${blocked} On`, {
          [slot.id]: state.id,
          [blocked]: blocker.id,
        });
    }
  }
  for (const state of definition.states)
    for (const out of state.takeOutSlotIds ?? []) {
      const other = first(out);
      if (other)
        add(`${state.name} with takeover target ${out} On`, {
          [state.slotId]: state.id,
          [out]: other.id,
        });
    }
  return [...cases.values()];
}

/** Each case starts Off and establishes only explicit required lanes before the target Take. */
export function coordinatedCertificationCases(definition: TransitionLogicDefinition) {
  const slots = new Map(definition.slots.map((slot) => [slot.id, slot]));
  return definition.states.map((target) => {
    const visiting = new Set<string>();
    const selected = new Map<string, TransitionLogicState>();
    const prerequisites: TransitionLogicState[] = [];
    const take = (state: TransitionLogicState) => {
      if (selected.has(state.slotId)) return;
      if (visiting.has(state.slotId)) throw new Error(`Cyclic Take admission for ${state.name}.`);
      visiting.add(state.slotId);
      const slot = slots.get(state.slotId);
      for (const requiredId of slot?.admission?.requireOnSlotIds ?? []) {
        const required = definition.states.find((candidate) => candidate.slotId === requiredId);
        if (!required)
          throw new Error(
            `Cannot certify ${state.name}: required lane ${requiredId} has no state.`,
          );
        take(required);
      }
      const blocked = slot?.admission?.blockWhileActiveSlotIds?.find((id) => selected.has(id));
      if (blocked)
        throw new Error(
          `Cannot certify ${state.name}: its required lane ${blocked} must also be Off.`,
        );
      const removed = state.takeOutSlotIds?.find((id) => selected.has(id));
      if (removed)
        throw new Error(`Cannot certify ${state.name}: it takes required lane ${removed} Out.`);
      selected.set(state.slotId, state);
      visiting.delete(state.slotId);
      if (state.id !== target.id) prerequisites.push(state);
    };
    take(target);
    return { state: target, prerequisites };
  });
}
