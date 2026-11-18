import { create } from 'zustand';
import { isDomElement, type EditorWindow } from '../layout/EditorWindow';
import type { StudioDocument } from './studioDocument';
import {
  beginFileTransferReview,
  type TemplateTransferReviewPlan,
  type TemplateTransferReviewSession,
} from './templateTransferReview';

type TransferResult = ReturnType<TemplateTransferReviewPlan['commit']>;

export interface TemplateTransferReviewRequest {
  owner: EditorWindow;
  trigger: HTMLElement | null;
  members?: readonly { id: string; name: string }[];
  session: (templateId?: string) => TemplateTransferReviewSession;
  resolve: (result: TransferResult | null) => void;
}

export const useTemplateTransferReviewDialogStore = create<{
  request: TemplateTransferReviewRequest | null;
  close: (request: TemplateTransferReviewRequest, result?: TransferResult) => void;
}>((set, get) => ({
  request: null,
  close: (request, result) => {
    if (get().request !== request) return;
    set({ request: null });
    request.resolve(result ?? null);
  },
}));

function openReview(
  owner: EditorWindow,
  session: TemplateTransferReviewRequest['session'],
  members?: TemplateTransferReviewRequest['members'],
): Promise<TransferResult | null> {
  if (owner.closed) return Promise.resolve(null);
  const current = useTemplateTransferReviewDialogStore.getState().request;
  if (current && !current.owner.closed)
    throw new Error('Finish the current template transfer review first.');
  if (current) useTemplateTransferReviewDialogStore.getState().close(current);
  const active = owner.document.activeElement;
  const trigger = isDomElement(active) ? active : null;
  return new Promise((resolve) =>
    useTemplateTransferReviewDialogStore.setState({
      request: { owner, trigger, members, session, resolve },
    }),
  );
}

export function requestTemplateTransferReview(
  owner: EditorWindow,
  session: TemplateTransferReviewSession,
): Promise<TransferResult | null> {
  return openReview(owner, () => session);
}

export function requestFileTemplateTransferReview(
  owner: EditorWindow,
  document: StudioDocument,
  options: Omit<NonNullable<Parameters<typeof beginFileTransferReview>[1]>, 'templateId'>,
): Promise<TransferResult | null> {
  const members =
    document.kind === 'template-set'
      ? document.projectSet.templates.map(({ id, name }) => ({ id, name }))
      : undefined;
  if (members && !members.length) throw new Error('This file contains no templates to transfer.');
  return openReview(
    owner,
    (templateId) => beginFileTransferReview(document, { ...options, templateId }),
    members,
  );
}
