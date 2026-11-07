import { create } from 'zustand';

export interface EditorPreviewSource {
  root: HTMLElement;
  projectId: string;
  compositionId: string;
  output: { x: number; y: number; width: number; height: number };
}

export const useEditorPreviewSourceStore = create<{ source: EditorPreviewSource | null }>(() => ({
  source: null,
}));

/** Publish the editor's actual pixels/DOM, without another timeline or graphic runtime. */
export function registerEditorPreviewSource(source: EditorPreviewSource): () => void {
  useEditorPreviewSourceStore.setState({ source });
  return () => {
    if (useEditorPreviewSourceStore.getState().source === source)
      useEditorPreviewSourceStore.setState({ source: null });
  };
}
