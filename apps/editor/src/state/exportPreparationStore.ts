import { create } from 'zustand';
import { getCertifiedCoordinatedSaveSnapshot } from './certifiedArtifactSave';

interface ExportPreparationDetails {
  ownerWindow: Window;
  name: string;
  templateCount: number;
}

export interface ExportPreparation extends ExportPreparationDetails {
  id: number;
  phase: 'preparing' | 'cancelling' | 'failed';
  message: string;
  previousPromptRevision: number;
  controller: AbortController;
}

interface ExportPreparationStore {
  preparation: ExportPreparation | null;
  start: (details: ExportPreparationDetails) => { id: number; signal: AbortSignal };
  update: (id: number, message: string) => void;
  cancel: (id: number) => void;
  finish: (id: number) => void;
  fail: (id: number, message: string) => void;
}

let nextId = 0;

export const useExportPreparationStore = create<ExportPreparationStore>((set, get) => ({
  preparation: null,
  start: (details) => {
    const current = get().preparation;
    if (current && current.phase !== 'failed') {
      throw new Error('A template-set export is already in progress. Wait for it to finish.');
    }
    const id = ++nextId;
    const controller = new AbortController();
    set({
      preparation: {
        ...details,
        id,
        phase: 'preparing',
        message: 'Reading the template set…',
        previousPromptRevision: getCertifiedCoordinatedSaveSnapshot()?.promptRevision ?? 0,
        controller,
      },
    });
    return { id, signal: controller.signal };
  },
  cancel: (id) => {
    const { preparation } = get();
    if (preparation?.id !== id || preparation.phase !== 'preparing') return;
    set({ preparation: { ...preparation, phase: 'cancelling', message: 'Stopping preparation…' } });
    preparation.controller.abort();
  },
  update: (id, message) => {
    const { preparation } = get();
    if (preparation?.id === id && preparation.phase === 'preparing') {
      set({ preparation: { ...preparation, message } });
    }
  },
  finish: (id) => {
    if (get().preparation?.id === id) set({ preparation: null });
  },
  fail: (id, message) => {
    const { preparation } = get();
    if (preparation?.id === id) {
      set({ preparation: { ...preparation, phase: 'failed', message } });
    }
  },
}));
