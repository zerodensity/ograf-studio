import type { Project } from './types';

/** Stable local change indicator; excludes comments, snapshots and the approval itself. */
export function reviewProjectFingerprint(project: Project): string {
  const { review: _review, ...content } = project;
  const text = JSON.stringify(content);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++)
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return `${text.length}:${(hash >>> 0).toString(16)}`;
}
