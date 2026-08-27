import { create } from 'zustand';

import type { FieldValue } from '@ograf-editor/scene-model';

export type TestValue = FieldValue;

interface TestDataState {
  /** fieldId -> live preview value. Design-time only — never persisted, never undo-able. */
  values: Record<string, TestValue>;
  setValue: (fieldId: string, value: TestValue) => void;
  resetAll: () => void;
}

export const useTestDataStore = create<TestDataState>((set) => ({
  values: {},
  setValue: (fieldId, value) => set((state) => ({ values: { ...state.values, [fieldId]: value } })),
  resetAll: () => set({ values: {} }),
}));
