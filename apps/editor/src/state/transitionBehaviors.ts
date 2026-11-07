import {
  createId,
  TRANSITION_LOGIC_VERSION,
  transitionLogicErrors,
  type ComponentDefinition,
  type TransitionLogicDefinition,
  type TransitionLogicLayoutRule,
  type TransitionLogicRecipe,
  type TransitionLogicReferences,
  type TransitionLogicRoute,
  type TransitionLogicSharedValue,
  type TransitionLogicState,
} from '@ograf-editor/scene-model';

export type TransitionBehaviorPhase = 'enter' | 'update' | 'exit';
export type MakeRoomProperty = 'x' | 'y' | 'width' | 'height';

export interface TransitionBehaviorSummary {
  phase: TransitionBehaviorPhase;
  title: string;
  recipe: TransitionLogicRecipe | null;
  routeId?: string;
  summary: string;
  issue?: string;
}

export interface MakeRoomOffset {
  instanceId: string;
  sourceLayerId: string;
  property: MakeRoomProperty;
  value: number;
}

export interface MakeRoomBehaviorInput {
  triggerStateId: string;
  affectedStateId: string;
  ruleId?: string;
  offsets: MakeRoomOffset[];
  enter: { layoutFrames: number; gapFrames: number; inFrames: number };
  exit: { outFrames: number; gapFrames: number; layoutFrames: number };
}

export interface MakeRoomTargetOption {
  key: string;
  instanceId: string;
  sourceLayerId: string;
  property: MakeRoomProperty;
  label: string;
  instanceName: string;
  layerName: string;
  componentName: string;
  baseValue: number;
}

export interface MakeRoomInspection {
  input: MakeRoomBehaviorInput;
  existing: boolean;
  errors: string[];
  canSeparateSlot: boolean;
  separationMessage?: string;
  preservedTiming: Record<'enter' | 'exit', { sharedFrames: number; tailFrames: number }>;
}

const properties: readonly MakeRoomProperty[] = ['x', 'y', 'width', 'height'];
const propertyKey = (
  value: Pick<TransitionLogicSharedValue, 'instanceId' | 'sourceLayerId' | 'property'>,
) => JSON.stringify([value.instanceId, value.sourceLayerId, value.property]);

/** A template can deliberately have several states; the designer chooses rather than losing one. */
export function transitionBehaviorStates(
  definition: TransitionLogicDefinition,
  templateId: string,
): TransitionLogicState[] {
  return definition.states.filter((state) => state.templateId === templateId);
}

function effectiveRecipe(
  definition: TransitionLogicDefinition,
  state: TransitionLogicState,
  phase: TransitionBehaviorPhase,
): { recipe: TransitionLogicRecipe | null; routeId?: string; issue?: string } {
  const from = phase === 'enter' ? null : state.id;
  const to = phase === 'exit' ? null : state.id;
  // Match the planner: specificity precedes priority, including same-state update routes.
  const candidates = definition.routes
    .filter(
      (route) =>
        route.slotId === state.slotId &&
        (route.from === '*' || route.from === from) &&
        (route.to === '*' || route.to === to),
    )
    .map((route) => ({ route, specificity: Number(route.from !== '*') + Number(route.to !== '*') }))
    .sort((a, b) => b.specificity - a.specificity || b.route.priority - a.route.priority);
  const first = candidates[0];
  const second = candidates[1];
  if (
    first &&
    second &&
    first.specificity === second.specificity &&
    first.route.priority === second.route.priority
  ) {
    return {
      recipe: null,
      issue: 'Two behaviors have the same priority. Resolve their routes in Advanced details.',
    };
  }
  const slot = definition.slots.find((entry) => entry.id === state.slotId);
  const id =
    first?.route.transitionId ??
    (phase === 'update' ? slot?.updateTransitionId : undefined) ??
    slot?.defaultTransitionId ??
    definition.defaultTransitionId;
  const recipe = definition.transitions.find((entry) => entry.id === id) ?? null;
  return {
    recipe,
    ...(first ? { routeId: first.route.id } : {}),
    ...(!recipe
      ? { issue: 'This behavior references a missing transition. Choose it in Advanced details.' }
      : {}),
  };
}

/** Read the actual effective routes, including advanced overrides, without changing the graph. */
export function transitionBehaviorSummaries(
  definition: TransitionLogicDefinition,
  stateId: string,
): TransitionBehaviorSummary[] {
  const state = definition.states.find((entry) => entry.id === stateId);
  if (!state) return [];
  return (['enter', 'update', 'exit'] as const).map((phase) => {
    const selected = effectiveRecipe(definition, state, phase);
    const title =
      phase === 'enter'
        ? 'When it enters'
        : phase === 'exit'
          ? 'When it leaves'
          : 'When its content changes';
    const recipe = selected.recipe;
    return {
      phase,
      title,
      ...selected,
      summary: recipe
        ? `${recipe.name} · ${recipe.durationFrames} frames`
        : 'Choose a transition in Advanced details',
    };
  });
}

function instanceOwner(
  definition: TransitionLogicDefinition,
  instanceId: string,
): string | undefined {
  const explicit = definition.sharedInstances.find((entry) => entry.id === instanceId)?.slotId;
  if (explicit) return explicit;
  // Ownership can also be implicit through state targets or a responsive layout rule.
  return (
    definition.states.find((state) =>
      state.sharedValues?.some((value) => value.instanceId === instanceId),
    )?.slotId ??
    definition.layoutRules?.find((rule) =>
      rule.sharedOffsets.some((value) => value.instanceId === instanceId),
    )?.slotId
  );
}

/** Only real shared instance identities are eligible. A matching component asset is insufficient. */
export function makeRoomTargetOptions(
  definition: TransitionLogicDefinition,
  components: readonly ComponentDefinition[],
  affectedStateId: string,
): MakeRoomTargetOption[] {
  const state = definition.states.find((entry) => entry.id === affectedStateId);
  if (!state) return [];
  const baseline = new Map(
    definition.initialSharedValues.map((value) => [propertyKey(value), value.value]),
  );
  const stateValues = new Map(
    (state.sharedValues ?? []).map((value) => [propertyKey(value), value.value]),
  );
  return definition.sharedInstances.flatMap((instance) => {
    const owner = instanceOwner(definition, instance.id);
    if (owner !== undefined && owner !== state.slotId) return [];
    const component = components.find((entry) => entry.id === instance.componentAssetId);
    if (!component) return [];
    return component.layers.flatMap((layer) =>
      properties.flatMap((property) => {
        const identity = { instanceId: instance.id, sourceLayerId: layer.id, property };
        const key = propertyKey(identity);
        // Never fabricate a baseline from an asset: the authored instance may have an override.
        if (!baseline.has(key)) return [];
        const value = stateValues.get(key) ?? baseline.get(key);
        if (typeof value !== 'number' || !Number.isFinite(value)) return [];
        const propertyName =
          property === 'x'
            ? 'Horizontal position'
            : property === 'y'
              ? 'Vertical position'
              : property === 'width'
                ? 'Width'
                : 'Height';
        return [
          {
            key,
            ...identity,
            label: `${instance.name} / ${layer.name} · ${propertyName}`,
            instanceName: instance.name,
            layerName: layer.name,
            componentName: component.name,
            baseValue: value,
          },
        ];
      }),
    );
  });
}

interface RoomContext {
  trigger: TransitionLogicState | undefined;
  affected: TransitionLogicState | undefined;
  rule: TransitionLogicLayoutRule | undefined;
  entranceRoute: TransitionLogicRoute | undefined;
  exitRoute: TransitionLogicRoute | undefined;
  errors: string[];
  canSeparateSlot: boolean;
}

function safeToSeparate(
  definition: TransitionLogicDefinition,
  trigger: TransitionLogicState,
): boolean {
  const slot = definition.slots.find((entry) => entry.id === trigger.slotId);
  if (!slot || (trigger.sharedValues?.length ?? 0) > 0) return false;
  // A new independent graphic must not alter existing state-specific choreography or ownership.
  if (
    definition.routes.some(
      (route) =>
        route.slotId === slot.id &&
        ((route.from !== '*' && route.from !== null) || (route.to !== '*' && route.to !== null)),
    )
  )
    return false;
  if (
    definition.layoutRules?.some((rule) => rule.slotId === slot.id || rule.whenSlotId === slot.id)
  )
    return false;
  // Slot-owned instances can remain with the affected graphic only when other states actually own them.
  if (
    definition.sharedInstances.some(
      (instance) =>
        instance.slotId === slot.id &&
        !definition.states.some(
          (state) =>
            state.id !== trigger.id &&
            state.slotId === slot.id &&
            state.sharedValues?.some((value) => value.instanceId === instance.id),
        ),
    )
  )
    return false;
  return true;
}

function roomContext(
  definition: TransitionLogicDefinition,
  triggerStateId: string,
  affectedStateId: string,
  ruleId?: string,
): RoomContext {
  const trigger = definition.states.find((state) => state.id === triggerStateId);
  const affected = definition.states.find((state) => state.id === affectedStateId);
  const errors: string[] = [];
  if (!trigger) errors.push('Choose the template that needs room.');
  if (!affected) errors.push('Choose the graphic that should make room.');
  if (trigger && affected && trigger.id === affected.id)
    errors.push('Choose a different graphic to make room.');
  const matches =
    definition.layoutRules?.filter(
      (rule) => rule.whenSlotId === trigger?.slotId && rule.slotId === affected?.slotId,
    ) ?? [];
  const rule = ruleId ? definition.layoutRules?.find((entry) => entry.id === ruleId) : matches[0];
  if (ruleId && !rule) errors.push('This Make room behavior was removed. Reopen the builder.');
  if (rule && (rule.whenSlotId !== trigger?.slotId || rule.slotId !== affected?.slotId))
    errors.push(
      'This Make room behavior belongs to different graphics. Reopen it from its template.',
    );
  if (matches.length > 1)
    errors.push(
      'These graphics have several layout behaviors. Edit their separate rules in Advanced details.',
    );
  let canSeparateSlot = false;
  if (trigger && affected && trigger.id !== affected.id && trigger.slotId === affected.slotId) {
    canSeparateSlot = safeToSeparate(definition, trigger);
    if (!canSeparateSlot)
      errors.push(
        'These graphics share a group with custom transitions or shared ownership. Put the entering graphic in a separate slot in Advanced details first.',
      );
  }
  const slotRoutes = definition.routes.filter((route) => route.slotId === trigger?.slotId);
  const entranceRoutes = slotRoutes.filter((route) => route.from === null && route.to === '*');
  const exitRoutes = slotRoutes.filter((route) => route.from === '*' && route.to === null);
  const onlyTriggerState =
    !!trigger && definition.states.filter((state) => state.slotId === trigger.slotId).length === 1;
  const exactEntranceRoutes = slotRoutes.filter(
    (route) => route.from === null && route.to === trigger?.id,
  );
  const exactExitRoutes = slotRoutes.filter(
    (route) => route.from === trigger?.id && route.to === null,
  );
  if (
    entranceRoutes.length > 1 ||
    exitRoutes.length > 1 ||
    (onlyTriggerState && (exactEntranceRoutes.length > 1 || exactExitRoutes.length > 1))
  )
    errors.push(
      'Several entrance or exit routes apply to this graphic. Resolve them in Advanced details before using Make room.',
    );
  if (
    slotRoutes.some((route) => {
      // A singleton's exact Off/On boundaries are equivalent to its generic boundaries.
      // Keep wildcard fallbacks intact and edit the exact winning route, allowing a simple
      // phase edit followed by Make room without relaxing multi-state custom-route checks.
      if (
        onlyTriggerState &&
        ((route.from === null && route.to === trigger.id) ||
          (route.from === trigger.id && route.to === null))
      )
        return false;
      return (
        ((route.from === null || route.from === '*') && route.to !== '*' && route.to !== null) ||
        ((route.to === null || route.to === '*') && route.from !== '*' && route.from !== null)
      );
    })
  )
    errors.push(
      'This graphic has state-specific entrance or exit routes. Keep those routes in Advanced details, or simplify them before using Make room.',
    );
  return {
    trigger,
    affected,
    rule,
    entranceRoute: (onlyTriggerState ? exactEntranceRoutes[0] : undefined) ?? entranceRoutes[0],
    exitRoute: (onlyTriggerState ? exactExitRoutes[0] : undefined) ?? exitRoutes[0],
    errors,
    canSeparateSlot,
  };
}

function preservedRecipeTiming(recipe: TransitionLogicRecipe | null | undefined) {
  if (!recipe) return { sharedFrames: 0, tailFrames: 0 };
  const phaseEnd = Math.max(
    recipe.outgoingFrames,
    recipe.incomingStartFrame + recipe.incomingFrames,
    recipe.sharedFrames,
    recipe.layoutPhase ? recipe.layoutPhase.startFrame + recipe.layoutPhase.durationFrames : 0,
  );
  return {
    sharedFrames: recipe.sharedFrames,
    tailFrames: Math.max(0, recipe.durationFrames - phaseEnd),
  };
}

/** Inspect an existing news-style rule, or seed a new builder without adding hidden metadata. */
export function inspectMakeRoomBehavior(
  definition: TransitionLogicDefinition,
  triggerStateId: string,
  affectedStateId: string,
  frameRate = 50,
): MakeRoomInspection {
  const context = roomContext(definition, triggerStateId, affectedStateId);
  const fps = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 50;
  const entrance = context.trigger
    ? effectiveRecipe(definition, context.trigger, 'enter').recipe
    : null;
  const exit = context.trigger ? effectiveRecipe(definition, context.trigger, 'exit').recipe : null;
  const sequentialEntrance =
    entrance?.layoutPhase?.startFrame === 0 &&
    entrance.layoutPhase.durationFrames <= entrance.incomingStartFrame;
  const sequentialExit = exit?.layoutPhase && exit.layoutPhase.startFrame >= exit.outgoingFrames;
  const errors = [...context.errors];
  if (context.rule && entrance?.layoutPhase && !sequentialEntrance)
    errors.push(
      'This entrance overlaps layout and content animation. Adjust its exact timing in Advanced details; the guided builder uses make room, then enter.',
    );
  if (context.rule && exit?.layoutPhase && !sequentialExit)
    errors.push(
      'This exit overlaps layout and content animation. Adjust its exact timing in Advanced details; the guided builder uses leave, then restore.',
    );
  return {
    input: {
      triggerStateId,
      affectedStateId,
      ...(context.rule ? { ruleId: context.rule.id } : {}),
      offsets: (context.rule?.sharedOffsets ?? []).map((offset) => ({
        instanceId: offset.instanceId,
        sourceLayerId: offset.sourceLayerId,
        property: offset.property as MakeRoomProperty,
        value: offset.value as number,
      })),
      enter:
        sequentialEntrance && entrance
          ? {
              layoutFrames: entrance.layoutPhase!.durationFrames,
              gapFrames: entrance.incomingStartFrame - entrance.layoutPhase!.durationFrames,
              inFrames: entrance.incomingFrames,
            }
          : {
              layoutFrames: Math.round(fps * 0.6),
              gapFrames: Math.round(fps * 0.08),
              inFrames: Math.round(fps),
            },
      exit:
        sequentialExit && exit
          ? {
              outFrames: exit.outgoingFrames,
              gapFrames: exit.layoutPhase!.startFrame - exit.outgoingFrames,
              layoutFrames: exit.layoutPhase!.durationFrames,
            }
          : {
              outFrames: Math.round(fps * 0.7),
              gapFrames: Math.round(fps * 0.08),
              layoutFrames: Math.round(fps * 0.6),
            },
    },
    existing: !!context.rule,
    errors,
    canSeparateSlot: context.canSeparateSlot,
    preservedTiming: { enter: preservedRecipeTiming(entrance), exit: preservedRecipeTiming(exit) },
    ...(context.canSeparateSlot
      ? {
          separationMessage: `“${context.trigger!.name}” will get its own independent group so both graphics can stay on screen. Existing graphics keep their group.`,
        }
      : {}),
  };
}

function recipeUsedElsewhere(
  definition: TransitionLogicDefinition,
  recipeId: string,
  routeId?: string,
): boolean {
  return (
    definition.defaultTransitionId === recipeId ||
    definition.slots.some(
      (slot) => slot.defaultTransitionId === recipeId || slot.updateTransitionId === recipeId,
    ) ||
    definition.routes.some((route) => route.id !== routeId && route.transitionId === recipeId)
  );
}

function makeRecipe(
  definition: TransitionLogicDefinition,
  trigger: TransitionLogicState,
  route: TransitionLogicRoute | undefined,
  phase: 'enter' | 'exit',
  input: MakeRoomBehaviorInput,
): TransitionLogicRecipe {
  const old = route
    ? definition.transitions.find((recipe) => recipe.id === route.transitionId)
    : undefined;
  const fallback = effectiveRecipe(definition, trigger, phase).recipe;
  const source = old ?? fallback;
  const { tailFrames } = preservedRecipeTiming(source);
  const recipe: TransitionLogicRecipe = source
    ? structuredClone(source)
    : {
        id: '',
        name: '',
        durationFrames: 0,
        outgoingFrames: 0,
        incomingStartFrame: 0,
        incomingFrames: 0,
        sharedFrames: 0,
        easing: 'ease-in-out',
      };
  recipe.id =
    old && !recipeUsedElsewhere(definition, old.id, route?.id)
      ? old.id
      : createId(`behavior-${phase}`);
  if (!old || recipe.id !== old.id)
    recipe.name = (
      phase === 'enter'
        ? `Make room, then show ${trigger.name}`
        : `Hide ${trigger.name}, then restore room`
    ).slice(0, 256);
  if (phase === 'enter') {
    recipe.outgoingFrames = 0;
    recipe.incomingStartFrame = input.enter.layoutFrames + input.enter.gapFrames;
    recipe.incomingFrames = input.enter.inFrames;
    recipe.layoutPhase = { startFrame: 0, durationFrames: input.enter.layoutFrames };
    recipe.durationFrames = Math.max(
      recipe.incomingStartFrame + recipe.incomingFrames,
      recipe.sharedFrames,
    );
  } else {
    recipe.outgoingFrames = input.exit.outFrames;
    recipe.incomingStartFrame = 0;
    recipe.incomingFrames = 0;
    recipe.layoutPhase = {
      startFrame: input.exit.outFrames + input.exit.gapFrames,
      durationFrames: input.exit.layoutFrames,
    };
    recipe.durationFrames = Math.max(
      recipe.layoutPhase.startFrame + recipe.layoutPhase.durationFrames,
      recipe.sharedFrames,
    );
  }
  // Keep an intentionally authored hold after the active phases; changing an offset must not shorten it.
  recipe.durationFrames += tailFrames;
  const index = definition.transitions.findIndex((entry) => entry.id === recipe.id);
  if (index < 0) definition.transitions.push(recipe);
  else definition.transitions[index] = recipe;
  return recipe;
}

/** Patch only the chosen rule and its entrance/exit routes. The caller publishes one undoable draft. */
export function upsertMakeRoomBehavior(
  definition: TransitionLogicDefinition,
  input: MakeRoomBehaviorInput,
  references: TransitionLogicReferences = {},
): TransitionLogicDefinition {
  const originalErrors = transitionLogicErrors(definition, references);
  if (originalErrors.length)
    throw new Error(
      `Resolve the existing playout transition errors first: ${originalErrors.join(' ')}`,
    );
  const context = roomContext(
    definition,
    input.triggerStateId,
    input.affectedStateId,
    input.ruleId,
  );
  if (context.errors.length) throw new Error(context.errors.join(' '));
  if (!input.offsets.length)
    throw new Error('Choose at least one element and how it should move or resize.');
  for (const value of [...Object.values(input.enter), ...Object.values(input.exit)]) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 86_400_000)
      throw new Error('Timing must use whole, nonnegative frame counts.');
  }
  const keys = new Set<string>();
  for (const offset of input.offsets) {
    if (!properties.includes(offset.property) || !Number.isFinite(offset.value))
      throw new Error('Choose a position or size property and a finite offset.');
    const key = propertyKey(offset);
    if (keys.has(key)) throw new Error('Choose each element property only once.');
    keys.add(key);
    const conflict = definition.layoutRules?.find(
      (rule) =>
        rule.id !== context.rule?.id &&
        rule.sharedOffsets.some((other) => propertyKey(other) === key),
    );
    if (conflict)
      throw new Error(
        `“${conflict.name}” already changes this element property. Edit that behavior or choose another property.`,
      );
  }
  const updated = structuredClone(definition);
  updated.version = TRANSITION_LOGIC_VERSION;
  const trigger = updated.states.find((state) => state.id === input.triggerStateId)!;
  const affected = updated.states.find((state) => state.id === input.affectedStateId)!;
  let entranceRoute = updated.routes.find((route) => route.id === context.entranceRoute?.id);
  let exitRoute = updated.routes.find((route) => route.id === context.exitRoute?.id);
  if (context.canSeparateSlot) {
    const originalSlot = updated.slots.find((slot) => slot.id === trigger.slotId)!;
    const newSlotId = createId('behavior-slot');
    updated.slots.push({
      ...originalSlot,
      id: newSlotId,
      name: trigger.name,
      order: Math.max(...updated.slots.map((slot) => slot.order)) + 1,
    });
    trigger.slotId = newSlotId;
    // Copy generic routes so custom fallback behavior in the original group remains untouched.
    for (const route of [...updated.routes].filter((entry) => entry.slotId === originalSlot.id)) {
      const copy = { ...route, id: createId('behavior-route'), slotId: newSlotId };
      updated.routes.push(copy);
      if (route.id === entranceRoute?.id) entranceRoute = copy;
      if (route.id === exitRoute?.id) exitRoute = copy;
    }
  }
  const entrance = makeRecipe(updated, trigger, entranceRoute, 'enter', input);
  const exit = makeRecipe(updated, trigger, exitRoute, 'exit', input);
  const unusedPriority = (preferred: number) => {
    const priorities = new Set(
      updated.routes
        .filter((route) => route.slotId === trigger.slotId)
        .map((route) => route.priority),
    );
    let priority = preferred;
    while (priorities.has(priority)) priority += 1;
    return priority;
  };
  if (entranceRoute) entranceRoute.transitionId = entrance.id;
  else
    updated.routes.push({
      id: createId('behavior-route'),
      slotId: trigger.slotId,
      from: null,
      to: '*',
      transitionId: entrance.id,
      priority: unusedPriority(10),
    });
  if (exitRoute) exitRoute.transitionId = exit.id;
  else
    updated.routes.push({
      id: createId('behavior-route'),
      slotId: trigger.slotId,
      from: '*',
      to: null,
      transitionId: exit.id,
      priority: unusedPriority(20),
    });
  const rule: TransitionLogicLayoutRule = {
    ...(context.rule
      ? structuredClone(context.rule)
      : { id: createId('behavior-room'), name: `Make room for ${trigger.name}`.slice(0, 256) }),
    slotId: affected.slotId,
    whenSlotId: trigger.slotId,
    sharedOffsets: structuredClone(input.offsets),
  };
  updated.layoutRules ??= [];
  const ruleIndex = updated.layoutRules.findIndex((entry) => entry.id === rule.id);
  if (ruleIndex < 0) updated.layoutRules.push(rule);
  else updated.layoutRules[ruleIndex] = rule;
  const errors = transitionLogicErrors(updated, references);
  if (errors.length) throw new Error(errors.join(' '));
  return updated;
}
