import { create } from 'zustand';
export interface ReviewAnchor {
  projectId: string;
  compositionId: string;
  layerId: string | null;
  frame: number;
  x: number;
  y: number;
}
export const useReviewPlacementStore = create<{
  placing: boolean;
  placement: ReviewAnchor | null;
  selectedCommentId: string | null;
  startPlacement: () => void;
  cancelPlacement: () => void;
  completePlacement: (anchor: ReviewAnchor) => void;
  clearPlacement: () => void;
  selectComment: (id: string | null) => void;
}>((set) => ({
  placing: false,
  placement: null,
  selectedCommentId: null,
  startPlacement: () => set({ placing: true, placement: null }),
  cancelPlacement: () => set({ placing: false }),
  completePlacement: (placement) => set({ placing: false, placement }),
  clearPlacement: () => set({ placement: null }),
  selectComment: (selectedCommentId) => set({ selectedCommentId }),
}));
