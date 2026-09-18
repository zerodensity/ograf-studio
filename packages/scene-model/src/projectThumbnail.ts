import { computeKeyframeFrames, getTotalFrames } from './keyframeTiming';
import type { Project } from './types';

export const THUMBNAIL_MAX_DIMENSION = 320;

export function projectThumbnailFrame(project: Project): number {
  const composition = project.compositions.find((item) => item.id === project.mainCompositionId);
  if (!composition) throw new Error('The template has no main composition.');
  if (project.thumbnailFrame != null) {
    if (!Number.isInteger(project.thumbnailFrame) || project.thumbnailFrame < 0)
      throw new Error('Thumbnail frame must be a non-negative integer.');
    return Math.min(project.thumbnailFrame, getTotalFrames(composition));
  }
  const firstStep = composition.keyframes.find((key) => key.role === 'step');
  return (
    computeKeyframeFrames(composition).find((key) => key.keyframeId === firstStep?.id)?.frame ?? 0
  );
}

export function thumbnailRenderProject(project: Project): Project {
  const snapshot = structuredClone(project);
  const composition = snapshot.compositions.find((item) => item.id === snapshot.mainCompositionId);
  if (!composition) throw new Error('The template has no main composition.');
  composition.backgroundColor = 'transparent';
  return snapshot;
}

export function templateBaseName(name: string): string {
  const base =
    Array.from(name)
      .map((char) => (char.charCodeAt(0) < 32 ? '-' : char))
      .join('')
      .replace(/\.(ogs|ogeproj)$/i, '')
      .replace(/[<>:"/\\|?*]/g, '-')
      .replace(/[. ]+$/g, '')
      .trim() || 'untitled';
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base) ? `_${base}` : base;
}

export function templateThumbnailName(project: Pick<Project, 'id'>): string {
  return `${templateBaseName(project.id)}_thumb.png`;
}
