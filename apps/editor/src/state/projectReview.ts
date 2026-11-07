import {
  createId,
  getTotalFrames,
  reviewProjectFingerprint,
  type Project,
  type ProjectReview,
  type ProjectReviewComment,
} from '@ograf-editor/scene-model';
import { runDiscreteHistoryStep } from './historyStore';
import { useProjectStore } from './projectStore';

export function reviewOf(project: Project): ProjectReview {
  return project.review ?? { comments: [], versions: [] };
}

function editReview(label: string, edit: (project: Project, review: ProjectReview) => void) {
  runDiscreteHistoryStep(() => {
    const current = useProjectStore.getState().project;
    const prior = reviewOf(current);
    const project = {
      ...current,
      review: {
        ...prior,
        comments: prior.comments.map((comment) => ({ ...comment })),
        versions: [...prior.versions],
      },
    };
    edit(project, project.review);
    useProjectStore.setState({ project });
  }, label);
}

export function addReviewComment(
  comment: Omit<ProjectReviewComment, 'id' | 'createdAt' | 'resolved'>,
): void {
  const text = comment.text.trim();
  const project = useProjectStore.getState().project;
  const composition = project.compositions.find((item) => item.id === comment.compositionId);
  if (!text || text.length > 2000 || !comment.author.trim() || comment.author.length > 128)
    throw new Error(
      'Enter a comment of up to 2000 characters and an author of up to 128 characters.',
    );
  if (
    !composition ||
    (comment.layerId && !composition.layers.some((layer) => layer.id === comment.layerId)) ||
    !Number.isInteger(comment.frame) ||
    comment.frame < 0 ||
    comment.frame > getTotalFrames(composition) ||
    !Number.isFinite(comment.x) ||
    !Number.isFinite(comment.y)
  )
    throw new Error('The review comment position, frame or object is no longer valid.');
  if (reviewOf(project).comments.length >= 1000)
    throw new Error('A project can contain at most 1000 review comments.');
  editReview('Add review comment', (_project, review) => {
    review.comments.push({
      ...comment,
      author: comment.author.trim(),
      text,
      id: createId('comment'),
      createdAt: new Date().toISOString(),
      resolved: false,
    });
  });
}

export function resolveReviewComment(id: string, resolved: boolean): void {
  if (!reviewOf(useProjectStore.getState().project).comments.some((item) => item.id === id))
    throw new Error('Review comment not found.');
  editReview(resolved ? 'Resolve review comment' : 'Reopen review comment', (_project, review) => {
    const comment = review.comments.find((item) => item.id === id);
    if (comment) comment.resolved = resolved;
  });
}

export function saveReviewVersion(name: string): void {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 128)
    throw new Error('Enter a version name of up to 128 characters.');
  if (reviewOf(useProjectStore.getState().project).versions.length >= 32)
    throw new Error('A project can contain at most 32 review versions.');
  editReview('Save review version', (project, review) => {
    const { review: _review, ...content } = project;
    const snapshot = structuredClone(content);
    review.versions.push({
      id: createId('version'),
      name: trimmed,
      createdAt: new Date().toISOString(),
      snapshot,
    });
  });
}

export function setReviewApproval(author: string | null): void {
  const name = author?.trim();
  if (author !== null && (!name || name.length > 128))
    throw new Error('Enter an approver name of up to 128 characters.');
  editReview(author === null ? 'Remove approval' : 'Approve project', (_project, review) => {
    if (name)
      review.approval = {
        author: name,
        at: new Date().toISOString(),
        fingerprint: reviewProjectFingerprint(_project),
      };
    else delete review.approval;
  });
}

export { reviewProjectFingerprint } from '@ograf-editor/scene-model';

/** Diff layer content by stable ID; unmodified layers are not highlighted. */
export function changedReviewLayerIds(
  current: Project,
  previous: Omit<Project, 'review'>,
): string[] {
  const entries = (project: Omit<Project, 'review'>) =>
    project.compositions.flatMap((composition) =>
      composition.layers.map(
        (layer) => [JSON.stringify([composition.id, layer.id]), JSON.stringify(layer)] as const,
      ),
    );
  const old = new Map(entries(previous));
  const next = new Map(entries(current));
  return [...new Set([...old.keys(), ...next.keys()])]
    .filter((key) => old.get(key) !== next.get(key))
    .map((key) => (JSON.parse(key) as [string, string])[1]);
}
