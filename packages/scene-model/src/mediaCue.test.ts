import { describe, expect, it } from 'vitest';
import {
  createAsset,
  createLayerOfKind,
  createMediaCue,
  createProject,
  findAssetConsumers,
  migrateProject,
  mediaCueEffectiveDurationFrames,
  mediaCueSourceDurationMs,
  mediaCueTrimmedDurationMs,
  PROJECT_DOCUMENT_VERSION,
} from './index';

describe('Media Cue model', () => {
  it('creates a nonvisual shared transport with conservative defaults', () => {
    expect(createMediaCue()).toMatchObject({
      name: 'Media Cue',
      sources: [],
      activeSourceId: null,
      trigger: { type: 'timeline', startFrame: 0 },
      trimStartMs: 0,
      trimEndMs: null,
      durationFrames: null,
      loop: false,
      speed: 1,
      volume: 1,
      muted: false,
      retrigger: 'restart',
      transition: { type: 'cut', durationFrames: 0, onFailure: 'keep-current' },
      visual: { targetLayerId: null, fit: 'cover', positionX: 0.5, positionY: 0.5 },
    });
  });

  it('does not infer cues from unreleased experimental audio layers', () => {
    const project = createProject();
    project.compositions[0]!.layers.push(createLayerOfKind('audio'));
    const legacy = structuredClone(project) as unknown as Record<string, unknown>;
    delete (legacy.compositions as Array<Record<string, unknown>>)[0]!.mediaCues;
    const migrated = migrateProject(legacy as never);
    expect(migrated.documentVersion).toBe(PROJECT_DOCUMENT_VERSION);
    expect(migrated.compositions[0]!.mediaCues).toEqual([]);
  });

  it('protects assets referenced by clip and live fallback sources', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const asset = createAsset({ id: 'clip', kind: 'media' });
    composition.assets.push(asset);
    composition.mediaCues.push(
      createMediaCue({
        id: 'cue',
        sources: [
          { id: 'clip-source', name: 'Clip', kind: 'clip', mediaType: 'video', src: 'asset:clip' },
          { id: 'live-source', name: 'Live', kind: 'live', tag: 'program', fallback: 'asset:clip' },
        ],
        activeSourceId: 'clip-source',
      }),
    );
    expect(findAssetConsumers(composition, asset).mediaCueIds).toEqual(['cue']);
  });

  it('derives source, trimmed, and Timeline durations without waveform metadata', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    composition.frameRate = 25;
    composition.assets.push(createAsset({ id: 'clip', kind: 'audio', durationMs: 10_000 }));
    const cue = createMediaCue({
      sources: [
        { id: 'source', name: 'Theme.wav', kind: 'clip', mediaType: 'audio', src: 'asset:clip' },
      ],
      activeSourceId: 'source',
      trimStartMs: 2_000,
      trimEndMs: 8_000,
      speed: 2,
    });
    expect(mediaCueSourceDurationMs(cue, composition.assets)).toBe(10_000);
    expect(mediaCueTrimmedDurationMs(cue, composition.assets)).toBe(6_000);
    expect(mediaCueEffectiveDurationFrames(cue, composition)).toBe(75);
    cue.durationFrames = 42;
    expect(mediaCueEffectiveDurationFrames(cue, composition)).toBe(42);
  });

  it('treats a missing pre-duration cue value as automatic', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const cue = createMediaCue({ trigger: { type: 'timeline', startFrame: 10 } });
    delete (cue as Partial<typeof cue>).durationFrames;
    expect(mediaCueEffectiveDurationFrames(cue, composition)).toBe(14);
  });
});
