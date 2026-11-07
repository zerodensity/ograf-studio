import { getTotalFrames, layerMotionWindows, type Composition } from '@ograf-editor/scene-model';

export interface BoardMoment {
  label: string;
  frame: number;
  previewData?: boolean;
}

/** Keep separate entries even when two lifecycle moments happen to use the same frame. */
export function boardMoments(composition: Composition): BoardMoment[] {
  const windows = layerMotionWindows(composition);
  const total = getTotalFrames(composition);
  const before = windows?.start ?? 0;
  const onAir = windows?.firstStep ?? 0;
  const lastStep = windows?.lastStep ?? onAir;
  const after = windows?.end ?? total;
  return [
    { label: 'Before', frame: before },
    { label: 'In · halfway', frame: Math.round((before + onAir) / 2) },
    { label: 'On air', frame: onAir },
    { label: 'Update · preview data', frame: onAir, previewData: true },
    { label: 'Out · halfway', frame: Math.round((lastStep + after) / 2) },
    { label: 'After', frame: after },
  ];
}
