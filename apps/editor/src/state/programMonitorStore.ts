import { create } from 'zustand';

/** Operator preview preferences are local to this browser session, never compiled into graphics. */
export type ProgramBackgroundMode =
  'document' | 'black' | 'checker' | 'video' | 'sample-news' | 'sample-entertainment';
interface ProgramMonitorState {
  background: ProgramBackgroundMode;
  videoUrl: string;
  videoName: string;
  titleSafe: boolean;
  actionSafe: boolean;
  aspectGuide: 'none' | '4:3' | '1:1' | '9:16';
  fpsOverlay: boolean;
  setBackground: (background: ProgramBackgroundMode) => void;
  setVideo: (file: File) => void;
  setFpsOverlay: (visible: boolean) => void;
  setGuides: (
    patch: Partial<Pick<ProgramMonitorState, 'titleSafe' | 'actionSafe' | 'aspectGuide'>>,
  ) => void;
}

export const useProgramMonitorStore = create<ProgramMonitorState>((set, get) => ({
  background: 'document',
  videoUrl: '',
  videoName: '',
  titleSafe: false,
  actionSafe: false,
  aspectGuide: 'none',
  fpsOverlay: true,
  setBackground: (background) => set({ background }),
  setFpsOverlay: (fpsOverlay) => set({ fpsOverlay }),
  setVideo: (file) => {
    const previous = get().videoUrl;
    const videoUrl = URL.createObjectURL(file);
    set({ background: 'video', videoUrl, videoName: file.name });
    if (previous) URL.revokeObjectURL(previous);
  },
  setGuides: (patch) => set(patch),
}));
