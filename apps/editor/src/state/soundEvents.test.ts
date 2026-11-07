import { describe, expect, it } from 'vitest';
import { createMediaCue, type MediaCue } from '@ograf-editor/scene-model';
import { isSoundEventCue } from './soundEvents';

function audioCue(trigger: MediaCue['trigger']) {
  return createMediaCue({
    sources: [
      {
        id: 'source',
        name: 'Sting.wav',
        kind: 'clip',
        mediaType: 'audio',
        src: 'asset:sting',
      },
    ],
    activeSourceId: 'source',
    trigger,
  });
}

describe('Sound Events', () => {
  it('uses automatic audio cues as simple frame markers', () => {
    expect(isSoundEventCue(audioCue({ type: 'timeline', startFrame: 12 }))).toBe(true);
    expect(isSoundEventCue(audioCue({ type: 'lifecycle', keyframeId: 'step' }))).toBe(true);
  });

  it('leaves manual and custom-action audio in the advanced Media Cue workflow', () => {
    expect(isSoundEventCue(audioCue({ type: 'manual' }))).toBe(false);
    expect(isSoundEventCue(audioCue({ type: 'customAction', actionId: 'play-sting' }))).toBe(false);
  });
});
