import { describe, expect, it } from 'vitest';
import { getPlayoutCompatibilityWarnings } from './playoutCompatibility';
import { createComposition, createLayerOfKind, createMediaCue } from './factory';
import { createMediaPaint } from './mediaPaint';

const composition = (backgroundColor = 'transparent') => ({
  backgroundColor,
  layers: [],
  mediaCues: [],
});

describe('playout compatibility warnings', () => {
  it('warns about both DaVinci Resolve blockers without turning them into validation errors', () => {
    expect(
      getPlayoutCompatibilityWarnings({ supportsNonRealTime: false }, composition('#000000')),
    ).toEqual([
      expect.objectContaining({ id: 'davinci-resolve-non-realtime' }),
      expect.objectContaining({ id: 'opaque-composition-background' }),
    ]);
  });

  it('accepts a non-real-time-capable package with transparent output', () => {
    expect(getPlayoutCompatibilityWarnings({ supportsNonRealTime: true }, composition())).toEqual(
      [],
    );
  });

  it('reports each concern independently', () => {
    expect(
      getPlayoutCompatibilityWarnings({ supportsNonRealTime: false }, composition()).map(
        (warning) => warning.id,
      ),
    ).toEqual(['davinci-resolve-non-realtime']);
    expect(
      getPlayoutCompatibilityWarnings({ supportsNonRealTime: true }, composition('#112233')).map(
        (warning) => warning.id,
      ),
    ).toEqual(['opaque-composition-background']);
  });

  it('warns about clip codecs and renderer-specific live sources', () => {
    const clip = createLayerOfKind('rectangle');
    const live = createLayerOfKind('ellipse');
    if (!('fill' in clip.element) || !('fill' in live.element)) throw new Error('Expected fills');
    clip.element.fill = createMediaPaint({ source: { kind: 'clip', src: 'asset:clip' } });
    live.element.fill = createMediaPaint({ source: { kind: 'live', tag: 'camera.program' } });
    const scene = createComposition({ backgroundColor: 'transparent', layers: [clip, live] });

    expect(
      getPlayoutCompatibilityWarnings({ supportsNonRealTime: false }, scene).map(
        (warning) => warning.id,
      ),
    ).toEqual([
      'davinci-resolve-non-realtime',
      'media-paint-codec-support',
      'live-media-renderer-extension',
    ]);
  });

  it('warns when a composition contains a first-class audio layer', () => {
    const audio = createLayerOfKind('audio');
    expect(
      getPlayoutCompatibilityWarnings(
        { supportsNonRealTime: false },
        createComposition({ backgroundColor: 'transparent', layers: [audio] }),
      ).map((warning) => warning.id),
    ).toEqual(['davinci-resolve-non-realtime', 'audio-layer-support']);
  });

  it('warns about target playback requirements for Media Cues', () => {
    const scene = createComposition({
      backgroundColor: 'transparent',
      mediaCues: [
        createMediaCue({
          sources: [{ id: 'live', name: 'Live', kind: 'live', tag: 'program.live' }],
          activeSourceId: 'live',
        }),
      ],
    });
    expect(
      getPlayoutCompatibilityWarnings({ supportsNonRealTime: false }, scene).map(
        (warning) => warning.id,
      ),
    ).toContain('media-cue-support');
  });
});
