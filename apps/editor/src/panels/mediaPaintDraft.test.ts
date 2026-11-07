import { describe, expect, it } from 'vitest';
import { createMediaPaint } from '@ograf-editor/scene-model';
import { mediaPaintReadyToCommit } from './mediaPaintDraft';

describe('Media paint authoring draft', () => {
  it('keeps an empty clip local until a source is selected', () => {
    expect(mediaPaintReadyToCommit(createMediaPaint())).toBe(false);
  });

  it('commits packaged clips and valid live tags', () => {
    expect(
      mediaPaintReadyToCommit(createMediaPaint({ source: { kind: 'clip', src: 'asset:clip-id' } })),
    ).toBe(true);
    expect(
      mediaPaintReadyToCommit(
        createMediaPaint({ source: { kind: 'live', tag: 'camera.program' } }),
      ),
    ).toBe(true);
  });
});
