import { create } from 'zustand';
import type { TransitionLogicDefinition } from '@ograf-editor/scene-model';

export type TransitionLogicSection =
  'overview' | 'slots' | 'states' | 'transitions' | 'routes' | 'shared';

const normalizeSection = (section: unknown): TransitionLogicSection =>
  section === 'slots' ||
  section === 'states' ||
  section === 'transitions' ||
  section === 'routes' ||
  section === 'shared'
    ? section
    : 'overview';

interface TransitionLogicDraft {
  baseline: string;
  definition: TransitionLogicDefinition | null;
  section: TransitionLogicSection;
}

export const transitionLogicFingerprint = (
  definition: TransitionLogicDefinition | null | undefined,
) => JSON.stringify(definition ?? null);

export const transitionLogicDraftChanged = (draft: TransitionLogicDraft) =>
  transitionLogicFingerprint(draft.definition) !== draft.baseline;

interface TransitionLogicDraftState {
  drafts: Record<string, TransitionLogicDraft>;
  sync: (setId: string, definition: TransitionLogicDefinition | null | undefined) => void;
  reset: (setId: string, definition: TransitionLogicDefinition | null | undefined) => void;
  replace: (setId: string, definition: TransitionLogicDefinition | null) => void;
  edit: (setId: string, change: (definition: TransitionLogicDefinition) => void) => void;
  setSection: (setId: string, section: TransitionLogicSection) => void;
}

/** Session drafts survive pane closure and movement into a detached editor window. */
export const useTransitionLogicDraftStore = create<TransitionLogicDraftState>((set) => ({
  drafts: {},
  sync: (setId, definition) =>
    set((state) => {
      const previous = state.drafts[setId];
      const baseline = transitionLogicFingerprint(definition);
      if (previous && (transitionLogicDraftChanged(previous) || previous.baseline === baseline)) {
        const section = normalizeSection(previous.section);
        return section === previous.section
          ? state
          : { drafts: { ...state.drafts, [setId]: { ...previous, section } } };
      }
      return {
        drafts: {
          ...state.drafts,
          [setId]: {
            baseline,
            definition: structuredClone(definition ?? null),
            section: normalizeSection(previous?.section),
          },
        },
      };
    }),
  reset: (setId, definition) =>
    set((state) => ({
      drafts: {
        ...state.drafts,
        [setId]: {
          baseline: transitionLogicFingerprint(definition),
          definition: structuredClone(definition ?? null),
          section: normalizeSection(state.drafts[setId]?.section),
        },
      },
    })),
  replace: (setId, definition) =>
    set((state) => {
      const draft = state.drafts[setId];
      if (!draft) return state;
      return {
        drafts: { ...state.drafts, [setId]: { ...draft, definition: structuredClone(definition) } },
      };
    }),
  edit: (setId, change) =>
    set((state) => {
      const draft = state.drafts[setId];
      if (!draft?.definition) return state;
      const definition = structuredClone(draft.definition);
      change(definition);
      return { drafts: { ...state.drafts, [setId]: { ...draft, definition } } };
    }),
  setSection: (setId, section) =>
    set((state) => {
      const draft = state.drafts[setId];
      if (!draft) return state;
      return {
        drafts: { ...state.drafts, [setId]: { ...draft, section: normalizeSection(section) } },
      };
    }),
}));
