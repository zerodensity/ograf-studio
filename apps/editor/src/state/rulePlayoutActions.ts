import type { VisualRulePlayoutAction } from '@ograf-editor/scene-model';
import type { ProjectSetDocument } from './projectSet';

export const RULE_PLAYOUT_ACTIONS = [
  ['take', 'Take'],
  ['update', 'Update'],
  ['out', 'Out'],
  ['clear', 'Clear'],
] as const;

/** New choices follow the active template when possible; existing targets are never repaired. */
export function createRulePlayoutAction(
  operation: VisualRulePlayoutAction['operation'],
  set: ProjectSetDocument | null,
  activeTemplateId: string | null,
  previous?: VisualRulePlayoutAction,
): VisualRulePlayoutAction {
  const definition = set?.transitionLogic;
  const active = definition?.states.find((state) => state.templateId === activeTemplateId);
  const slotId = previous?.slotId ?? active?.slotId ?? definition?.slots[0]?.id ?? '';
  if (operation === 'out' || operation === 'clear') return { type: 'playout', operation, slotId };
  const states = definition?.states.filter((state) => state.slotId === slotId) ?? [];
  const stateId =
    previous?.stateId ??
    (operation === 'take'
      ? ((active?.slotId === slotId ? active.id : states[0]?.id) ?? '')
      : undefined);
  return {
    type: 'playout',
    operation,
    slotId,
    ...(stateId !== undefined ? { stateId } : {}),
    ...(previous?.data ? { data: previous.data } : {}),
  };
}
