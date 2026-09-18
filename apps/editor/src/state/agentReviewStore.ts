import { create } from 'zustand';
import { computeKeyframeFrames, getTotalFrames, type Project } from '@ograf-editor/scene-model';

export interface AgentAuthoringProposal {
  id: string;
  title: string;
  description: string;
  sessionId: string;
  baseRevision: number;
  operationTypes: string[];
  operationCount: number;
  previewUrl: string;
  previewExpiresAt: string;
  render: 'frame' | 'strip';
  frames: number[];
  valid: boolean;
  warnings: string[];
  project?: Project;
  compositionId?: string;
}

export interface ReviewProposal extends AgentAuthoringProposal {
  originalProject: Project;
  previewFrame: number;
  showOriginal: boolean;
  previewReady: boolean;
  previewError: string | null;
  previewAttempt: number;
  staleReason: string | null;
  deciding: 'accept' | 'reject' | null;
}

interface AgentReviewState {
  proposals: ReviewProposal[];
  lastResolution: { status: string; message: string } | null;
  present: (
    proposal: AgentAuthoringProposal,
    originalProject: Project,
    staleReason?: string,
  ) => void;
  resolve: (id: string, result: { status: string; message: string }) => void;
  invalidate: (reason: string, revision?: number) => void;
  update: (
    id: string,
    patch: Partial<
      Pick<ReviewProposal, 'deciding' | 'previewReady' | 'previewError' | 'staleReason'>
    >,
  ) => void;
  setFrame: (id: string, frame: number) => void;
  compare: (id: string) => void;
  retry: (id: string) => void;
  dismissResolution: () => void;
}

export function proposalComposition(proposal: AgentAuthoringProposal, project = proposal.project) {
  return project?.compositions.find(
    (composition) => composition.id === (proposal.compositionId ?? project.mainCompositionId),
  );
}

export const useAgentReviewStore = create<AgentReviewState>((set) => ({
  proposals: [],
  lastResolution: null,
  present: (proposal, originalProject, staleReason) =>
    set((state) => {
      const composition = proposalComposition(proposal);
      const step = composition?.keyframes.find((key) => key.role === 'step');
      const stepFrame = composition
        ? computeKeyframeFrames(composition).find((key) => key.keyframeId === step?.id)?.frame
        : undefined;
      const frame =
        proposal.render === 'frame' ? proposal.frames[0] : (stepFrame ?? proposal.frames[0]);
      return {
        proposals: [
          ...state.proposals.filter((item) => item.id !== proposal.id),
          {
            ...proposal,
            originalProject,
            previewFrame: frame ?? 0,
            showOriginal: false,
            previewReady: false,
            previewError: null,
            previewAttempt: 0,
            staleReason: staleReason ?? null,
            deciding: null,
          },
        ],
        lastResolution: null,
      };
    }),
  resolve: (id, result) =>
    set((state) => ({
      proposals: state.proposals.filter((item) => item.id !== id),
      lastResolution: result,
    })),
  invalidate: (reason, revision) =>
    set((state) => ({
      proposals: state.proposals.map((item) =>
        revision !== undefined && item.baseRevision === revision
          ? item
          : { ...item, staleReason: reason, previewReady: false },
      ),
    })),
  update: (id, patch) =>
    set((state) => ({
      proposals: state.proposals.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    })),
  setFrame: (id, frame) =>
    set((state) => ({
      proposals: state.proposals.map((item) => {
        if (item.id !== id || !Number.isFinite(frame)) return item;
        const composition = proposalComposition(item);
        const previewFrame = Math.max(
          0,
          Math.min(composition ? getTotalFrames(composition) : 0, Math.round(frame)),
        );
        if (previewFrame === item.previewFrame) return item;
        return {
          ...item,
          previewFrame,
          previewReady: false,
          previewError: null,
        };
      }),
    })),
  compare: (id) =>
    set((state) => ({
      proposals: state.proposals.map((item) =>
        item.id === id
          ? { ...item, showOriginal: !item.showOriginal, previewReady: false, previewError: null }
          : item,
      ),
    })),
  retry: (id) =>
    set((state) => ({
      proposals: state.proposals.map((item) =>
        item.id === id
          ? {
              ...item,
              previewAttempt: item.previewAttempt + 1,
              previewReady: false,
              previewError: null,
            }
          : item,
      ),
    })),
  dismissResolution: () => set({ lastResolution: null }),
}));
