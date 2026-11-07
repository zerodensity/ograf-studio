import { createProject } from '@ograf-editor/scene-model';
import { describe, expect, it } from 'vitest';
import {
  clearEditorLoopSamples,
  getEditorLoopSample,
  recordEditorLoopSample,
} from './editorLoopSample';

describe('rendered editor loop samples', () => {
  it('keeps a held loop phase separate from its parked main playhead', () => {
    const composition = createProject().compositions[0]!;
    recordEditorLoopSample(composition, 'loop', 12, 97.5);
    expect(getEditorLoopSample(composition, 'loop', 12)).toEqual({ elapsedFrames: 97.5 });
    expect(getEditorLoopSample(composition, 'loop', 13)).toBeUndefined();
    expect(getEditorLoopSample(composition, 'loop', NaN)).toBeUndefined();
    expect(getEditorLoopSample(structuredClone(composition), 'loop', 12)).toBeUndefined();
    clearEditorLoopSamples(composition);
    expect(getEditorLoopSample(composition, 'loop', 12)).toBeUndefined();
  });

  it('records inactivity and cannot clear a successor sample with the same IDs', () => {
    const before = createProject().compositions[0]!;
    const after = structuredClone(before);
    recordEditorLoopSample(before, 'loop', 0, 10);
    recordEditorLoopSample(after, 'loop', 0, undefined);
    clearEditorLoopSamples(before);
    expect(getEditorLoopSample(after, 'loop', 0)).toEqual({ elapsedFrames: null });
    recordEditorLoopSample(after, 'loop', 0, NaN);
    expect(getEditorLoopSample(after, 'loop', 0)).toBeUndefined();
    clearEditorLoopSamples(after);
  });
});
