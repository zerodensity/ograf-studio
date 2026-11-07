import type { Composition, Project } from './types';
import { getElementMediaPaint } from './mediaPaint';

export type PlayoutCompatibilityWarningId =
  | 'davinci-resolve-non-realtime'
  | 'opaque-composition-background'
  | 'media-paint-codec-support'
  | 'live-media-renderer-extension'
  | 'audio-layer-support'
  | 'media-cue-support';

export interface PlayoutCompatibilityWarning {
  id: PlayoutCompatibilityWarningId;
  message: string;
}

/**
 * Legal OGraf configurations that are known to be unsuitable for common overlay/editing workflows.
 * These are advisory by design and must remain separate from validation and certification errors.
 */
export function getPlayoutCompatibilityWarnings(
  project: Pick<Project, 'supportsNonRealTime'>,
  composition: Pick<Composition, 'backgroundColor' | 'layers' | 'mediaCues'>,
): PlayoutCompatibilityWarning[] {
  const warnings: PlayoutCompatibilityWarning[] = [];
  if (!project.supportsNonRealTime) {
    warnings.push({
      id: 'davinci-resolve-non-realtime',
      message:
        'DaVinci Resolve loads OGraf graphics in non-real-time mode and cannot render a real-time-only package. Choose Non-real-time or Dual for Resolve.',
    });
  }
  if (composition.backgroundColor.trim().toLowerCase() !== 'transparent') {
    warnings.push({
      id: 'opaque-composition-background',
      message:
        'An opaque composition background covers the entire frame in a playout chain. Enable Transparent output when the graphic should overlay video.',
    });
  }
  const mediaPaints = composition.layers.flatMap((layer) => {
    const paint = getElementMediaPaint(layer.element);
    return paint ? [paint] : [];
  });
  if (mediaPaints.length > 0) {
    warnings.push({
      id: 'media-paint-codec-support',
      message:
        'Media paint is muted and real-time-only. Packaged clips require a codec supported by the target browser or renderer; prefer H.264 MP4 or VP8/VP9 WebM and test the exported package on the target system.',
    });
  }
  if (mediaPaints.some((paint) => paint.source.kind === 'live')) {
    warnings.push({
      id: 'live-media-renderer-extension',
      message:
        'Live Media uses the renderer-specific zd-ograf-media hook. Renderers without that extension show the selected fallback image or transparency.',
    });
  }
  if (composition.layers.some((layer) => layer.element.type === 'audio')) {
    warnings.push({
      id: 'audio-layer-support',
      message:
        'Audio layers are real-time-only and depend on target browser audio codec/autoplay policy. Test the exported package with the intended playout renderer and audio routing.',
    });
  }
  if (composition.mediaCues.length > 0) {
    warnings.push({
      id: 'media-cue-support',
      message:
        'Media Cues are real-time-only and depend on target codec, autoplay, live-source readiness and audio-routing support. Test cue triggers and source transitions on the intended playout renderer.',
    });
  }
  return warnings;
}
