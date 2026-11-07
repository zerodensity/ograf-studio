import {
  createId,
  TRANSITION_LOGIC_VERSION,
  transitionLogicErrors,
  type TransitionLogicDefinition,
  type TransitionLogicRecipe,
  type TransitionLogicReferences,
  type TransitionLogicRoute,
} from '@ograf-editor/scene-model';
import { transitionBehaviorSummaries, type TransitionBehaviorPhase } from './transitionBehaviors';

/** Authoring choices for the existing coordinator; these are not layer-rule runtime triggers. */
export const TRANSITION_RULE_TRIGGERS = [
  { value: 'transition-enter', label: 'Template enters', phase: 'enter' },
  { value: 'transition-update', label: 'Template content changes', phase: 'update' },
  { value: 'transition-exit', label: 'Template leaves', phase: 'exit' },
] as const;

export type TransitionRuleTrigger = (typeof TRANSITION_RULE_TRIGGERS)[number]['value'];
export type TransitionRuleAction =
  'animate-in' | 'make-room' | 'update-content' | 'animate-out' | 'restore-space';

export interface TransitionRuleActionOption {
  value: TransitionRuleAction;
  label: string;
  phase: TransitionBehaviorPhase;
  openMakeRoom: boolean;
}

export function isTransitionRuleTrigger(value: string): value is TransitionRuleTrigger {
  return TRANSITION_RULE_TRIGGERS.some((entry) => entry.value === value);
}

export function transitionRulePhase(trigger: TransitionRuleTrigger): TransitionBehaviorPhase {
  return TRANSITION_RULE_TRIGGERS.find((entry) => entry.value === trigger)!.phase;
}

export function transitionRuleActions(
  trigger: TransitionRuleTrigger,
): TransitionRuleActionOption[] {
  const phase = transitionRulePhase(trigger);
  if (phase === 'enter')
    return [
      { value: 'animate-in', label: 'Animate template in', phase, openMakeRoom: false },
      { value: 'make-room', label: 'Make room, then enter', phase, openMakeRoom: true },
    ];
  if (phase === 'exit')
    return [
      { value: 'animate-out', label: 'Animate template out', phase, openMakeRoom: false },
      { value: 'restore-space', label: 'Restore space after exit', phase, openMakeRoom: true },
    ];
  return [
    { value: 'update-content', label: 'Update template content', phase, openMakeRoom: false },
  ];
}

export interface TransitionPhaseRuleInput {
  stateId: string;
  phase: TransitionBehaviorPhase;
  outgoingFrames: number;
  incomingStartFrame: number;
  incomingFrames: number;
  incomingAnimation?: TransitionLogicRecipe['incomingAnimation'] | null;
  outgoingAnimation?: TransitionLogicRecipe['outgoingAnimation'] | null;
}

export interface TransitionPhaseRuleInspection {
  input: TransitionPhaseRuleInput;
  recipe: TransitionLogicRecipe | null;
  routeId?: string;
  errors: string[];
  tailFrames: number;
}

function endOfRecipePhases(recipe: TransitionLogicRecipe): number {
  return Math.max(
    recipe.outgoingFrames,
    recipe.incomingStartFrame + recipe.incomingFrames,
    recipe.sharedFrames,
    recipe.layoutPhase ? recipe.layoutPhase.startFrame + recipe.layoutPhase.durationFrames : 0,
  );
}

/** Uses the same effective route selection as the Rules editor and runtime planner. */
export function inspectTransitionPhaseRule(
  definition: TransitionLogicDefinition,
  stateId: string,
  phase: TransitionBehaviorPhase,
): TransitionPhaseRuleInspection {
  const card = transitionBehaviorSummaries(definition, stateId).find(
    (entry) => entry.phase === phase,
  );
  const recipe = card?.recipe ?? null;
  const errors = transitionLogicErrors(definition);
  if (!definition.states.some((state) => state.id === stateId))
    errors.push('Connect this template to a state in Advanced details first.');
  if (card?.issue) errors.push(card.issue);
  else if (!recipe) errors.push('Choose a valid transition in Advanced details first.');
  return {
    input: {
      stateId,
      phase,
      outgoingFrames: recipe?.outgoingFrames ?? 0,
      incomingStartFrame: recipe?.incomingStartFrame ?? 0,
      incomingFrames: recipe?.incomingFrames ?? 0,
      ...(recipe?.incomingAnimation
        ? { incomingAnimation: structuredClone(recipe.incomingAnimation) }
        : {}),
      ...(recipe?.outgoingAnimation
        ? { outgoingAnimation: structuredClone(recipe.outgoingAnimation) }
        : {}),
    },
    recipe,
    ...(card?.routeId ? { routeId: card.routeId } : {}),
    errors: [...new Set(errors)],
    tailFrames: recipe ? Math.max(0, recipe.durationFrames - endOfRecipePhases(recipe)) : 0,
  };
}

function recipeIsShared(
  definition: TransitionLogicDefinition,
  recipeId: string,
  routeId: string,
): boolean {
  return (
    definition.defaultTransitionId === recipeId ||
    definition.slots.some(
      (slot) => slot.defaultTransitionId === recipeId || slot.updateTransitionId === recipeId,
    ) ||
    definition.routes.some((route) => route.id !== routeId && route.transitionId === recipeId)
  );
}

/**
 * Edit content phases for one state without changing neighboring states or their fallback routes.
 * Existing easing, shared movement, responsive layout and an intentional final hold are retained.
 */
export function upsertTransitionPhaseRule(
  definition: TransitionLogicDefinition,
  input: TransitionPhaseRuleInput,
  references: TransitionLogicReferences = {},
): TransitionLogicDefinition {
  const inspection = inspectTransitionPhaseRule(definition, input.stateId, input.phase);
  const existingErrors = [...inspection.errors, ...transitionLogicErrors(definition, references)];
  if (existingErrors.length)
    throw new Error(
      `Resolve this behavior in Advanced details first: ${[...new Set(existingErrors)].join(' ')}`,
    );
  for (const frames of [input.outgoingFrames, input.incomingStartFrame, input.incomingFrames]) {
    if (!Number.isSafeInteger(frames) || frames < 0 || frames > 86_400_000)
      throw new Error('Use whole, nonnegative frame counts for transition timing.');
  }
  const source = inspection.recipe!;
  const recipe = structuredClone(source);
  if (input.phase !== 'enter') recipe.outgoingFrames = input.outgoingFrames;
  if (input.phase !== 'enter') {
    if (input.outgoingAnimation === null) delete recipe.outgoingAnimation;
    else if (input.outgoingAnimation !== undefined)
      recipe.outgoingAnimation = structuredClone(input.outgoingAnimation);
  }
  if (input.phase !== 'exit') {
    recipe.incomingStartFrame = input.incomingStartFrame;
    recipe.incomingFrames = input.incomingFrames;
    if (input.incomingAnimation === null) delete recipe.incomingAnimation;
    else if (input.incomingAnimation !== undefined)
      recipe.incomingAnimation = structuredClone(input.incomingAnimation);
  }
  const layout = source.layoutPhase;
  if (
    layout &&
    input.phase === 'enter' &&
    source.incomingStartFrame >= layout.startFrame + layout.durationFrames &&
    recipe.incomingStartFrame < layout.startFrame + layout.durationFrames
  )
    throw new Error(
      'The graphic would enter before space is ready. Use Make room to adjust the paired layout and entrance timing.',
    );
  if (
    layout &&
    input.phase === 'exit' &&
    source.outgoingFrames <= layout.startFrame &&
    recipe.outgoingFrames > layout.startFrame
  )
    throw new Error(
      'Space would restore before the graphic leaves. Use Restore space to adjust the paired exit and layout timing.',
    );
  recipe.durationFrames = endOfRecipePhases(recipe) + inspection.tailFrames;
  // A no-op must not create a new route or silently change precedence.
  if (
    recipe.outgoingFrames === source.outgoingFrames &&
    recipe.incomingStartFrame === source.incomingStartFrame &&
    recipe.incomingFrames === source.incomingFrames &&
    JSON.stringify(recipe.incomingAnimation) === JSON.stringify(source.incomingAnimation) &&
    JSON.stringify(recipe.outgoingAnimation) === JSON.stringify(source.outgoingAnimation)
  )
    return structuredClone(definition);
  const state = definition.states.find((entry) => entry.id === input.stateId)!;
  const from = input.phase === 'enter' ? null : state.id;
  const to = input.phase === 'exit' ? null : state.id;
  const currentRoute = definition.routes.find((route) => route.id === inspection.routeId);
  const exact = currentRoute?.from === from && currentRoute.to === to;
  // A boundary route in a one-state slot is already specific to this template. Retaining it
  // also keeps its paired Make room builder editable without manufacturing an exception.
  const onlyState = definition.states.filter((entry) => entry.slotId === state.slotId).length === 1;
  const singleStateBoundary =
    onlyState &&
    !!currentRoute &&
    ((input.phase === 'enter' && currentRoute.from === null && currentRoute.to === '*') ||
      (input.phase === 'exit' && currentRoute.from === '*' && currentRoute.to === null));
  const ownsRoute = exact || singleStateBoundary;
  const updated = structuredClone(definition);
  if (recipe.incomingAnimation || recipe.outgoingAnimation)
    updated.version = TRANSITION_LOGIC_VERSION;
  let route: TransitionLogicRoute;
  if (ownsRoute) route = updated.routes.find((entry) => entry.id === currentRoute!.id)!;
  else {
    // An existing exact route would have won selection; never duplicate or override one invisibly.
    if (
      updated.routes.some(
        (entry) => entry.slotId === state.slotId && entry.from === from && entry.to === to,
      )
    )
      throw new Error(
        'An exact route already controls this behavior. Resolve its priority in Advanced details.',
      );
    route = {
      id: createId('behavior-route'),
      slotId: state.slotId,
      from,
      to,
      transitionId: '',
      priority: 0,
    };
    updated.routes.push(route);
  }
  if (!ownsRoute || recipeIsShared(definition, source.id, route.id)) {
    recipe.id = createId('behavior-transition');
    recipe.name =
      `${state.name} / ${input.phase === 'enter' ? 'Enter' : input.phase === 'exit' ? 'Leave' : 'Content change'}`.slice(
        0,
        256,
      );
    updated.transitions.push(recipe);
  } else {
    const index = updated.transitions.findIndex((entry) => entry.id === source.id);
    updated.transitions[index] = recipe;
  }
  route.transitionId = recipe.id;
  const errors = transitionLogicErrors(updated, references);
  if (errors.length)
    throw new Error(`Use Advanced details to resolve this transition: ${errors.join(' ')}`);
  return updated;
}
