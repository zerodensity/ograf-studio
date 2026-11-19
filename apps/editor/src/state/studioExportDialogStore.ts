import { create } from 'zustand';
import type { EditorWindow } from '../layout/EditorWindow';

export interface StudioExportRequest {
  owner: EditorWindow;
  trigger: HTMLElement;
  kind: 'ograf' | 'video';
}

export const useStudioExportDialogStore = create<{
  request: StudioExportRequest | null;
  close: (request: StudioExportRequest) => void;
}>((set) => ({
  request: null,
  close: (request) => set((state) => (state.request === request ? { request: null } : state)),
}));

export function requestStudioExport(
  trigger: HTMLElement,
  kind: StudioExportRequest['kind'] = 'ograf',
): void {
  const owner = trigger.ownerDocument.defaultView as EditorWindow | null;
  if (!owner || owner.closed) return;
  const { request } = useStudioExportDialogStore.getState();
  if (request && !request.owner.closed) {
    if (owner !== request.owner) request.owner.focus();
    return;
  }
  useStudioExportDialogStore.setState({ request: { owner, trigger, kind } });
}
