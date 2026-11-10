import { describe, expect, it } from 'vitest';
import { MAX_TEXT_CLIP_MARGIN } from '@ograf-editor/scene-model';
import { authoringOperationSchema } from './schemas';

describe('text clipping margin operations', () => {
  it('accepts clipping margins on text creation and edits', () => {
    const fields = { overflowPolicy: 'clip', clipMarginX: 12.5, clipMarginY: 4 };
    expect(
      authoringOperationSchema.parse({ type: 'add_layer', kind: 'text', element: fields }),
    ).toMatchObject({ element: fields });
    expect(
      authoringOperationSchema.parse({ type: 'update_element', layerId: 'title', patch: fields }),
    ).toMatchObject({ patch: fields });
  });

  it.each([-1, Infinity, MAX_TEXT_CLIP_MARGIN + 1, '5'])(
    'rejects an invalid clipping margin %s',
    (clipMarginX) => {
      expect(
        authoringOperationSchema.safeParse({
          type: 'update_element',
          layerId: 'title',
          patch: { clipMarginX },
        }).success,
      ).toBe(false);
    },
  );
});
