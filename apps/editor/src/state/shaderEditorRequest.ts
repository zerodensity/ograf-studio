import { create } from 'zustand';
import type { EditorWindow } from '../layout/EditorWindow';
import { useProjectStore } from './projectStore';
import { shaderResourceTarget, type ShaderResourceTarget } from './shaderResources';

export const useShaderEditorRequestStore = create<{
  request: {
    id: number;
    projectId: string;
    target: ShaderResourceTarget;
    owner: EditorWindow;
  } | null;
  nextId: number;
  open: (target: ShaderResourceTarget, owner: EditorWindow) => void;
  close: () => void;
}>((set, get) => ({
  request: null,
  nextId: 0,
  open: (target, owner) => {
    const id = get().nextId + 1;
    set({
      nextId: id,
      request: {
        id,
        projectId: useProjectStore.getState().project.id,
        target: shaderResourceTarget(target),
        owner,
      },
    });
  },
  close: () => set({ request: null }),
}));

export function openShaderResourceEditor(
  target: ShaderResourceTarget,
  owner: EditorWindow = window,
) {
  useShaderEditorRequestStore.getState().open(target, owner);
}
