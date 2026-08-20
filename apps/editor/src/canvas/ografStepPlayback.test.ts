import { describe, expect, it } from 'vitest';
import { createComposition, createKeyframe, createTransition } from '@ograf-editor/scene-model';
import { nextOgrafStepFrame } from './ografStepPlayback';

describe('OGraf step-aware editor playback', () => {
  it('stops at each future step and then allows playback through End', () => {
    const start = createKeyframe({ role: 'start', name: 'Start' });
    const first = createKeyframe({ role: 'step', name: 'First' });
    const second = createKeyframe({ role: 'step', name: 'Second' });
    const end = createKeyframe({ role: 'end', name: 'End' });
    const composition = createComposition({
      keyframes: [start, first, second, end],
      transitions: [
        createTransition(start.id, first.id, { durationFrames: 10 }),
        createTransition(first.id, second.id, { durationFrames: 8 }),
        createTransition(second.id, end.id, { durationFrames: 6 }),
      ],
    });

    expect(nextOgrafStepFrame(composition, 0)).toBe(10);
    expect(nextOgrafStepFrame(composition, 10)).toBe(18);
    expect(nextOgrafStepFrame(composition, 18)).toBeUndefined();
  });
});
