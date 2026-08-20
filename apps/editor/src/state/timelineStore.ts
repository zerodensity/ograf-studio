import { create } from 'zustand';

export interface TimelineController {
  seek: (frame: number) => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
}

interface TimelineState {
  /** Playhead position in frames (may be fractional mid-scrub/playback), kept live for the ruler UI. */
  currentFrame: number;
  isPlaying: boolean;
  pauseAtOgrafSteps: boolean;
  durationFrames: number;
  /** Editor-only live preview of one layer's local loop clip. */
  previewLoopLayerId: string | null;
  /** Registered by Stage (the only thing with direct access to the layer DOM nodes GSAP drives). */
  controller: TimelineController | null;
  setCurrentFrame: (frame: number) => void;
  setPlaying: (isPlaying: boolean) => void;
  setPauseAtOgrafSteps: (pauseAtOgrafSteps: boolean) => void;
  setDurationFrames: (frames: number) => void;
  setPreviewLoopLayerId: (layerId: string | null) => void;
  setController: (controller: TimelineController | null) => void;
  /** Stop the outgoing composition and clear transient playback state before replacing a project. */
  resetForProjectLoad: () => void;
}

export const useTimelineStore = create<TimelineState>((set, get) => ({
  currentFrame: 0,
  isPlaying: false,
  pauseAtOgrafSteps: false,
  durationFrames: 0,
  previewLoopLayerId: null,
  controller: null,
  setCurrentFrame: (frame) => set({ currentFrame: frame }),
  setPlaying: (isPlaying) => set({ isPlaying }),
  setPauseAtOgrafSteps: (pauseAtOgrafSteps) => set({ pauseAtOgrafSteps }),
  setDurationFrames: (frames) => set({ durationFrames: frames }),
  setPreviewLoopLayerId: (previewLoopLayerId) => set({ previewLoopLayerId }),
  setController: (controller) => set({ controller }),
  resetForProjectLoad: () => {
    get().controller?.stop();
    set({
      currentFrame: 0,
      isPlaying: false,
      durationFrames: 0,
      previewLoopLayerId: null,
      controller: null,
    });
  },
}));
