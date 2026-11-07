import type { Composition, VisualRulePlayoutAction } from './types';
import type { TransitionLogicDefinition } from './transitionLogic';
import { visualRulePlayoutActionErrors } from './visualRules';

/** Set-level references cannot be checked by a standalone composition validator. */
export function visualRulePlayoutReferenceErrors(
  action: VisualRulePlayoutAction,
  definition: Pick<TransitionLogicDefinition, 'slots' | 'states'> | null | undefined,
): string[] {
  const errors = visualRulePlayoutActionErrors(action);
  if (errors.length) return errors;
  if (!definition) return ['Playout actions require a template set configured in Transitions.'];
  if (!definition.slots.some((slot) => slot.id === action.slotId))
    errors.push(`Playout lane "${action.slotId}" does not exist. Choose a lane in Rules.`);
  if (action.stateId !== undefined) {
    const state = definition.states.find((candidate) => candidate.id === action.stateId);
    if (!state)
      errors.push(
        `Playout template state "${action.stateId}" does not exist. Choose a template in Rules.`,
      );
    else if (state.slotId !== action.slotId)
      errors.push(`Playout template "${state.name}" does not belong to lane "${action.slotId}".`);
  }
  return errors;
}

/** Paused rules retain their references for later repair, without blocking an otherwise valid set. */
export function compositionPlayoutActionErrors(
  composition: Pick<Composition, 'layers' | 'components'>,
  definition: Pick<TransitionLogicDefinition, 'slots' | 'states'> | null | undefined,
): string[] {
  const layers = [
    ...composition.layers,
    ...composition.components.flatMap((component) => component.layers),
  ];
  return layers.flatMap((layer) =>
    (layer.visualRules ?? [])
      .filter((rule) => rule.enabled)
      .flatMap((rule) =>
        rule.actions.flatMap((action) =>
          action.type === 'playout'
            ? visualRulePlayoutReferenceErrors(action, definition).map(
                (issue) => `Layer "${layer.name}", rule "${rule.name}": ${issue}`,
              )
            : [],
        ),
      ),
  );
}
