import { create } from 'zustand';
import type { ClockTimerCommand } from '@ograf-editor/scene-model';
import { useProjectStore } from './projectStore';

interface PreviewController {
  projectId: string;
  compositionId: string;
  command: (command: ClockTimerCommand) => void;
}
const controllers = new Map<string, PreviewController>();

export const useClockTimerPreviewStore = create<{
  running: Record<string, boolean>;
  error: string | null;
}>(() => ({ running: {}, error: null }));

export function publishClockTimerPreviewState(layerId: string, running: boolean): void {
  const state = useClockTimerPreviewStore.getState();
  if (state.running[layerId] === running) return;
  useClockTimerPreviewStore.setState({ running: { ...state.running, [layerId]: running } });
}

/** Preview transport lives outside the document, so elapsed time never creates undo entries. */
export function registerClockTimerPreview(
  layerId: string,
  controller: PreviewController,
): () => void {
  controllers.set(layerId, controller);
  useClockTimerPreviewStore.setState({ error: null });
  return () => {
    if (controllers.get(layerId) !== controller) return;
    controllers.delete(layerId);
    const running = { ...useClockTimerPreviewStore.getState().running };
    delete running[layerId];
    useClockTimerPreviewStore.setState({ running });
  };
}

export function commandClockTimerPreview(layerId: string, command: ClockTimerCommand): boolean {
  const controller = controllers.get(layerId);
  const state = useProjectStore.getState();
  if (
    !controller ||
    controller.projectId !== state.project.id ||
    controller.compositionId !== state.activeCompositionId
  ) {
    useClockTimerPreviewStore.setState({
      error: 'Show the clock/timer on the canvas to use its preview controls.',
    });
    return false;
  }
  try {
    controller.command(command);
    useClockTimerPreviewStore.setState({ error: null });
    return true;
  } catch (error) {
    useClockTimerPreviewStore.setState({
      error: error instanceof Error ? error.message : 'The timer could not be updated.',
    });
    return false;
  }
}
