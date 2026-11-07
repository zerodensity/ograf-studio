import { describe, expect, it } from 'vitest';
import { createComposition } from '@ograf-editor/scene-model';
import { compileDescriptor } from './compileDescriptor';

describe('presentation background export boundary', () => {
  it('does not add webcam footage or settings to the OGraf descriptor', () => {
    const composition = createComposition();
    const baseline = compileDescriptor(composition);
    composition.layout.presentationBackground = 'webcam';

    expect(compileDescriptor(composition)).toEqual(baseline);
  });
});
