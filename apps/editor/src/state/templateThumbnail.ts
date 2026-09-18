import {
  projectThumbnailFrame,
  thumbnailRenderProject,
  THUMBNAIL_MAX_DIMENSION,
  type Project,
} from '@ograf-editor/scene-model';
import { captureAgentPng } from './agentCapture';

export async function createTemplateThumbnail(project: Project): Promise<Blob> {
  const capture = await captureAgentPng({
    target: 'composition',
    project: thumbnailRenderProject(project),
    compositionId: project.mainCompositionId,
    frame: projectThumbnailFrame(project),
    maxDimension: THUMBNAIL_MAX_DIMENSION,
    matte: 'transparent',
  });
  const bytes = Uint8Array.from(atob(capture.data), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: 'image/png' });
}
