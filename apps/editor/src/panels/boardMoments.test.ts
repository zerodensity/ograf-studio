import { describe, expect, it } from 'vitest';
import { createComposition } from '@ograf-editor/scene-model';
import { boardMoments } from './boardMoments';

describe('board moments', () => {
  it('includes labelled lifecycle positions and a separate preview-data update', () => {
    expect(boardMoments(createComposition())).toEqual([
      { label: 'Before', frame: 0 },
      { label: 'In · halfway', frame: 6 },
      { label: 'On air', frame: 12 },
      { label: 'Update · preview data', frame: 12, previewData: true },
      { label: 'Out · halfway', frame: 18 },
      { label: 'After', frame: 24 },
    ]);
  });
});
