import {
  type TransitionLogicDefinition,
  type TransitionLogicReferences,
} from '@ograf-editor/scene-model';
import { resolveTransition } from './transitionChoreography';
import { applyCellTiming, type TransitionCell } from './transitionsDesign';

export interface ResizeTiming {
  startFrame: number;
  durationFrames: number;
  /** Enter waits for the resize; exit restores the layout after the outgoing content. */
  waitForResize: boolean;
}

function resizeCell(
  definition: TransitionLogicDefinition,
  triggerSlotId: string,
  triggerStateId: string | null,
  phase: 'enter' | 'exit',
): TransitionCell {
  if (!definition.slots.some((slot) => slot.id === triggerSlotId))
    throw new Error('The resize trigger lane was removed.');
  if (!triggerStateId) throw new Error('Choose a template to edit its resize timing.');
  const state = definition.states.find((entry) => entry.id === triggerStateId);
  if (!state || state.slotId !== triggerSlotId)
    throw new Error('The resize trigger template does not belong to this lane.');
  return {
    slotId: triggerSlotId,
    from: phase === 'exit' ? triggerStateId : null,
    to: phase === 'enter' ? triggerStateId : null,
  };
}

/** Read the timing used by one template's incoming resize or outgoing restore. */
export function resizeTiming(
  definition: TransitionLogicDefinition,
  triggerSlotId: string,
  triggerStateId: string | null,
  phase: 'enter' | 'exit',
  frameRate: number,
): ResizeTiming {
  const cell = resizeCell(definition, triggerSlotId, triggerStateId, phase);
  const resolved = resolveTransition(definition, cell.slotId, cell.from, cell.to);
  if (!resolved.recipe) throw new Error(resolved.issue ?? 'Resolve this transition timing first.');
  const recipe = resolved.recipe;
  const layout = recipe.layoutPhase;
  const opacityDuration = phase === 'enter' ? recipe.incomingFrames : recipe.outgoingFrames;
  const fallbackDuration =
    Number.isSafeInteger(opacityDuration) && opacityDuration >= 0
      ? opacityDuration
      : Math.round(0.6 * (Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 50));
  return {
    startFrame: layout?.startFrame ?? (phase === 'enter' ? recipe.incomingStartFrame : 0),
    // The editable resize control has a one-frame minimum; zero still means instant until edited.
    durationFrames: Math.max(1, layout?.durationFrames ?? fallbackDuration),
    waitForResize:
      !!layout &&
      (phase === 'enter'
        ? recipe.incomingStartFrame >= layout.startFrame + layout.durationFrames
        : layout.startFrame >= recipe.outgoingFrames),
  };
}

function resizeFrame(value: number, minimum: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > 1_000_000)
    throw new Error(`${label} must be a whole number from ${minimum} to 1000000 frames.`);
}

/**
 * Store resize timing on this template's exact route. Other templates keep their timing,
 * including any wildcard routes, shared recipe bindings and advanced phase settings.
 */
export function setResizeTiming(
  definition: TransitionLogicDefinition,
  triggerSlotId: string,
  triggerStateId: string | null,
  phase: 'enter' | 'exit',
  timing: Pick<ResizeTiming, 'startFrame' | 'durationFrames'>,
  references: TransitionLogicReferences,
): TransitionLogicDefinition {
  resizeFrame(timing.startFrame, 0, 'Resize start');
  resizeFrame(timing.durationFrames, 1, 'Resize duration');
  const cell = resizeCell(definition, triggerSlotId, triggerStateId, phase);
  const resolved = resolveTransition(definition, cell.slotId, cell.from, cell.to);
  if (!resolved.recipe) throw new Error(resolved.issue ?? 'Resolve this transition timing first.');
  const recipe = resolved.recipe;
  const layout = recipe.layoutPhase;
  const waitsForResize =
    phase === 'enter' &&
    !!layout &&
    recipe.incomingStartFrame >= layout.startFrame + layout.durationFrames;
  return applyCellTiming(
    definition,
    cell,
    {
      layoutPhase: { startFrame: timing.startFrame, durationFrames: timing.durationFrames },
      ...(waitsForResize
        ? {
            incomingStartFrame: Math.max(
              recipe.incomingStartFrame,
              timing.startFrame + timing.durationFrames,
            ),
          }
        : {}),
    },
    'pair',
    references,
  );
}
