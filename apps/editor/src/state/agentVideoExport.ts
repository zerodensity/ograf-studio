import { getCompositionOutputRect, type Project } from '@ograf-editor/scene-model';
import { movieTiming } from './videoExportTimeline';
import { webmMovieTiming, webmRasterSize } from './webmExportSettings';

/** The bridge hands the movie to the server in one message, as it does a set archive. */
export const MAX_AGENT_VIDEO_BYTES = 64 * 1024 * 1024;

export interface AgentVideoRequest {
  project: Project;
  compositionId?: string;
  transparent: boolean;
  holdSeconds: number;
  bitrate?: number;
  /** Longest side of the movie in pixels; the composition's own size when left out. */
  maxDimension?: number;
  blackFrameAtStart?: boolean;
  blackFrameAtEnd?: boolean;
}

export interface AgentVideoResult {
  mimeType: 'video/webm';
  /** Base64 of the WebM file. */
  data: string;
  bytes: number;
  sha256: string;
  width: number;
  height: number;
  frameRate: number;
  frames: number;
  durationSeconds: number;
}

/** The size to render at for a longest side of at most `maxDimension`, or undefined for full size. */
export function agentVideoSize(
  output: { width: number; height: number },
  maxDimension?: number,
): { width: number; height: number } | undefined {
  if (maxDimension === undefined) return undefined;
  const scale = Math.min(1, maxDimension / Math.max(output.width, output.height));
  if (scale === 1) return undefined;
  return {
    width: Math.max(2, Math.round(output.width * scale)),
    height: Math.max(2, Math.round(output.height * scale)),
  };
}

function base64Of(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('The movie could not be read.'));
    reader.onload = () =>
      resolve(String(reader.result).slice(String(reader.result).indexOf(',') + 1));
    reader.readAsDataURL(blob);
  });
}

/** Renders the template as a WebM movie with Studio's own export, for an agent to save. */
export async function exportAgentVideo(
  request: AgentVideoRequest,
  signal: AbortSignal,
  onProgress: (frame: number, frames: number) => void,
): Promise<AgentVideoResult> {
  const wanted = request.compositionId ?? request.project.mainCompositionId;
  const composition = request.project.compositions.find((item) => item.id === wanted);
  if (!composition) throw new Error(`Composition not found: ${wanted}`);
  const output = getCompositionOutputRect(composition);
  const size = agentVideoSize(output, request.maxDimension);
  const settings = {
    transparent: request.transparent,
    holdSeconds: request.holdSeconds,
    ...(request.bitrate === undefined ? {} : { bitrate: request.bitrate }),
    ...(size ? { size } : {}),
    blackFrameAtStart: request.blackFrameAtStart === true,
    blackFrameAtEnd: request.blackFrameAtEnd === true,
  };
  const { prepareWebmExportFile } = await import('./videoExport');
  const file = await prepareWebmExportFile(request.project, composition, {
    ...settings,
    signal,
    onProgress: (progress) => {
      if (progress.stage === 'picture') onProgress(progress.frame, progress.frames);
    },
  });
  if (file.blob.size > MAX_AGENT_VIDEO_BYTES)
    throw new Error(
      `The movie is ${(file.blob.size / 1024 / 1024).toFixed(1)} MiB; an agent export carries at most 64 MiB. Lower bitrate, maxDimension or holdSeconds, or export it from Studio's Export Video window.`,
    );
  const bytes = await file.blob.arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const timing = movieTiming(composition, request.holdSeconds);
  const { frameCount, durationSeconds } = webmMovieTiming(timing, settings);
  return {
    mimeType: 'video/webm',
    data: await base64Of(file.blob),
    bytes: bytes.byteLength,
    sha256: Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join(''),
    ...webmRasterSize(size ?? output),
    frameRate: timing.frameRate,
    frames: frameCount,
    durationSeconds,
  };
}
