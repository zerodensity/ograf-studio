import {
  projectThumbnailFrame,
  thumbnailRenderProject,
  THUMBNAIL_MAX_DIMENSION,
  type Project,
} from '@ograf-editor/scene-model';
import { captureAgentPng } from './agentCapture';

export async function createTemplateThumbnail(
  project: Project,
  signal?: AbortSignal,
): Promise<Blob> {
  signal?.throwIfAborted();
  const request = {
    target: 'composition' as const,
    project: thumbnailRenderProject(project),
    compositionId: project.mainCompositionId,
    frame: projectThumbnailFrame(project),
    maxDimension: THUMBNAIL_MAX_DIMENSION,
    matte: 'transparent',
  };
  const capture = signal ? await captureAgentPng(request, signal) : await captureAgentPng(request);
  signal?.throwIfAborted();
  const bytes = Uint8Array.from(atob(capture.data), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: 'image/png' });
}
