import { create } from 'zustand';

interface PreviewSlotSelectionState {
  choices: Record<string, string>;
}

/** Operator choices belong to the shared Studio session, never the saved graphics. */
export const usePreviewSlotSelectionStore = create<PreviewSlotSelectionState>(() => ({
  choices: {},
}));

export function previewSlotSelectionKey(
  setId: string,
  definitionId: string,
  activeTemplateId: string | null,
  slotId: string,
): string {
  return JSON.stringify([setId, definitionId, activeTemplateId, slotId]);
}

export function setPreviewSlotSelection(key: string, stateId: string): void {
  usePreviewSlotSelectionStore.setState((state) =>
    state.choices[key] === stateId ? state : { choices: { ...state.choices, [key]: stateId } },
  );
}
