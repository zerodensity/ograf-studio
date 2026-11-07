import type { LivePlayoutOperation } from '@ograf-editor/agent-tools/playout';
import type { CoordinatedPreviewRuntime } from './coordinatedPreviewRuntime';

/** Shared operator semantics for the live session and its isolated rehearsal. */
export async function runCoordinatedPreviewCommand(
  runtime: CoordinatedPreviewRuntime,
  operation: Exclude<LivePlayoutOperation, { type: 'load' | 'unload' }>,
): Promise<void> {
  const graphic = runtime.graphic;
  let result;
  switch (operation.type) {
    case 'template-action':
      result = await graphic.customAction({
        id: 'template.action',
        payload: {
          slotId: operation.slotId,
          actionId: operation.actionId,
          ...(operation.data === undefined ? {} : { data: operation.data }),
        },
      });
      break;
    case 'loop':
      result = await graphic.customAction({
        id: `loop.${operation.action}`,
        payload: { slotId: operation.slotId, groupId: operation.groupId },
      });
      break;
    case 'prepare':
      result = await graphic.prepareSlot({
        slotId: operation.slotId,
        stateId: operation.stateId,
        ...(operation.data === undefined ? {} : { data: operation.data }),
      });
      break;
    case 'take':
      if (operation.stateId === undefined) {
        if (operation.data !== undefined)
          throw new Error(
            'Taking a prepared state uses its exact prepared data. Prepare the new data first.',
          );
        if (
          operation.preparedRequestId !== undefined &&
          graphic.getPlayoutSnapshot().prepared[operation.slotId]?.requestId !==
            operation.preparedRequestId
        )
          throw new Error(
            'The prepared state changed. Review the current prepared state before taking it.',
          );
        result = await graphic.takePreparedSlot({ slotId: operation.slotId });
      } else
        result = await graphic.customAction({
          id: 'transition.take',
          payload: {
            slotId: operation.slotId,
            stateId: operation.stateId,
            ...(operation.data === undefined ? {} : { data: operation.data }),
          },
        });
      break;
    case 'update': {
      const slot = graphic.getPlayoutSnapshot().slots[operation.slotId];
      const active = slot?.incoming ?? slot?.current;
      if (!active || (slot?.transition && !slot.incoming))
        throw new Error('This slot has no on-air state to update. Take a state first.');
      if (operation.stateId !== undefined && active.stateId !== operation.stateId)
        throw new Error(
          'The on-air state changed. Select the current state before updating its data.',
        );
      result = await graphic.customAction({
        id: operation.mode === 'in-place' ? 'transition.patch' : 'transition.take',
        payload: {
          slotId: operation.slotId,
          stateId: active.stateId,
          // In-place feeds merge against current runtime data at commit. Sending an earlier
          // complete snapshot here would overwrite values from another concurrent source.
          data:
            operation.mode === 'in-place' ? operation.data : { ...active.data, ...operation.data },
        },
      });
      break;
    }
    case 'out':
      result = await graphic.customAction({
        id: 'transition.out',
        payload: { slotId: operation.slotId },
      });
      break;
    case 'clear':
      result = await graphic.customAction({
        id: 'transition.clear',
        payload: operation.slotId ? { slotId: operation.slotId } : {},
      });
      break;
  }
  if (result && result.statusCode >= 400)
    throw new Error(result.statusMessage || `Playout ${operation.type} failed.`);
}
