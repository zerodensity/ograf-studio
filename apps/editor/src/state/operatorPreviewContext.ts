import type { TransitionLogicDefinition, TransitionLogicState } from '@ograf-editor/scene-model';

/** Guarded operator Takes must observe the actual output, without activating prerequisites. */
export function operatorPreviewContext(
  definition: TransitionLogicDefinition,
  state: TransitionLogicState,
  activeTemplateId: string | null,
): string[] {
  const admission = definition.slots.find((slot) => slot.id === state.slotId)?.admission;
  if (admission?.requireOnSlotIds?.length || admission?.blockWhileActiveSlotIds?.length) return [];
  const slots = new Set(
    (definition.layoutRules ?? [])
      .filter((rule) => rule.whenSlotId === state.slotId)
      .map((rule) => rule.slotId),
  );
  return [...slots].flatMap((slotId) => {
    const context =
      definition.states.find(
        (entry) => entry.slotId === slotId && entry.templateId === activeTemplateId,
      ) ?? definition.states.find((entry) => entry.slotId === slotId);
    return context ? [context.id] : [];
  });
}
