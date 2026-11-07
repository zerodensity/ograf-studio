import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('Media Cue resource authoring', () => {
  it('uses simple Sound Event markers without audio tracks', () => {
    const resources = source('./ResourcesPanel.tsx');
    const timeline = source('./TimelinePanel.tsx');
    const stage = source('../canvas/Stage.tsx');
    const runtime = source('../../../../packages/ograf-runtime/src/GraphicElement.ts');

    expect(resources).toContain('Create Cue at Keyframe');
    expect(resources).toContain('<MediaCueEditor cue={cue} />');
    expect(resources).toContain('Playback cues');
    expect(resources).toContain('Add at Playhead');
    expect(resources).toContain('toggleAudioPreview(asset)');
    expect(resources).toContain("'■ Stop' : '▶ Play'");
    expect(resources).toContain('application/x-ograf-audio-asset-id');
    expect(resources).toContain('<SoundEventEditor cue={cue} />');
    expect(timeline).toContain('timeline-sound-event-marker');
    expect(timeline).toContain('handleAudioDrop');
    expect(timeline).not.toContain('timeline-media-cue');
    expect(timeline).not.toContain('MediaCueEditor');
    expect(stage).toContain('new MediaCueRuntime(mediaCueHost, descriptor)');
    expect(stage).toContain('mediaCueRuntime.renderAtTime(timelineTimeMs)');
    const takeOut = runtime.slice(
      runtime.indexOf('async #stopActionUnlocked'),
      runtime.indexOf('async customAction'),
    );
    expect(takeOut).not.toContain('mediaCueRuntime?.reset()');
  });
});
