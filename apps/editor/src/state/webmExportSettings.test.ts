import { createComposition, createMediaCue, type MediaCue } from '@ograf-editor/scene-model';
import { describe, expect, it } from 'vitest';
import { estimateWebmExport, webmVideoBitrates } from './webmExportSettings';

describe('WebM export estimate', () => {
  it('uses the same colour and alpha budgets as the encoder in Auto and manual modes', () => {
    const composition = createComposition({ width: 1920, height: 1080, frameRate: 60 });
    const auto = estimateWebmExport(composition, { transparent: true, holdSeconds: 0 });
    expect(auto).toEqual({
      width: 1920,
      height: 1080,
      videoBitrate: 5_598_720,
      autoVideoBitrate: 5_598_720,
      audioBitrate: 0,
      durationSeconds: 25 / 60,
      estimatedBytes: 291_600,
    });

    const manual = { transparent: true, bitrate: 10_000_000 };
    expect(webmVideoBitrates(auto, 60, manual)).toEqual({
      colour: 6_666_667,
      alpha: 3_333_333,
      autoVideoBitrate: 5_598_720,
    });
    expect(estimateWebmExport(composition, { ...manual, holdSeconds: 0 })).toMatchObject({
      videoBitrate: 10_000_000,
      autoVideoBitrate: 5_598_720,
      estimatedBytes: 520_833,
    });
    expect(estimateWebmExport(composition, { transparent: false, holdSeconds: 0 })).toMatchObject({
      videoBitrate: 3_732_480,
      estimatedBytes: 194_400,
    });
  });

  it('uses the padded crop or requested raster for the Auto budget', () => {
    const composition = createComposition({
      width: 1920,
      height: 1080,
      frameRate: 60,
      crop: { x: 7, y: 11, width: 1501, height: 1001 },
    });
    const options = { transparent: true, holdSeconds: 0 };
    expect(estimateWebmExport(composition, options)).toMatchObject({
      width: 1502,
      height: 1002,
      videoBitrate: 4_063_511,
    });
    expect(
      estimateWebmExport(composition, { ...options, size: { width: 541, height: 959 } }),
    ).toMatchObject({ width: 542, height: 960, videoBitrate: 1_500_000 });
  });

  it('counts rounded Step holds, black padding and only eligible timeline audio', () => {
    const cue = (overrides: Partial<MediaCue>) =>
      createMediaCue({
        sources: [{ id: 'audio', name: 'Tone', kind: 'clip', mediaType: 'audio', src: 'tone.ogg' }],
        activeSourceId: 'audio',
        ...overrides,
      });
    const composition = createComposition({ frameRate: 10 });
    composition.mediaCues = [
      cue({ trigger: { type: 'manual' } }),
      cue({ trigger: { type: 'timeline', startFrame: 0 }, muted: true }),
      cue({ trigger: { type: 'timeline', startFrame: 25 } }),
    ];
    const options = {
      transparent: true,
      bitrate: 10_000_000,
      holdSeconds: 0.26,
      blackFrameAtStart: true,
      blackFrameAtEnd: true,
    };
    expect(estimateWebmExport(composition, options)).toMatchObject({
      durationSeconds: 3,
      audioBitrate: 0,
      estimatedBytes: 3_750_000,
    });

    composition.mediaCues.push(cue({ trigger: { type: 'timeline', startFrame: 24 } }));
    expect(estimateWebmExport(composition, options)).toMatchObject({
      durationSeconds: 3,
      audioBitrate: 128_000,
      estimatedBytes: 3_798_000,
    });
  });
});
