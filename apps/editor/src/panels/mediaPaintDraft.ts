import { validateMediaPaint, type MediaPaint } from '@ograf-editor/scene-model';

/** Incomplete Media controls stay local until the source is valid for the canonical project. */
export function mediaPaintReadyToCommit(paint: MediaPaint): boolean {
  return validateMediaPaint(paint).length === 0;
}
