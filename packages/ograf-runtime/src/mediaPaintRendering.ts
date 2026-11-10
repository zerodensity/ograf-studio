import {
  getElementMediaPaint,
  sourceCropPixels,
  LIVE_MEDIA_ELEMENT_TAG,
  type Element,
  type MediaPaint,
} from '@ograf-editor/scene-model';
import { createShaderPaintMask } from './shaderPaintMask';
import { textClipPadding } from './textClipMargins';
import { renderTextAnimationAtFrame } from './textAnimationRendering';
import { renderChartAnimationAtFrame } from './chartRendering';
import { resolveMediaTimelinePosition } from './mediaTimeline';

interface RenderOptions {
  shaderBackingSize?: { width: number; height: number };
  lottieBackingSize?: { width: number; height: number };
  requiresImageAlpha?: boolean;
  frameRate?: number;
}

interface NativeContent {
  render(host: HTMLElement, element: Element, options: RenderOptions): void;
  renderAtTime(host: HTMLElement, element: Element, elapsedMs: number): void;
  ready(host: HTMLElement): Promise<void>;
  refreshLayout(host: HTMLElement): void;
  dispose(host: HTMLElement): void;
}

type LiveMediaElement = HTMLElement & {
  getFrame?: () => CanvasImageSource | Promise<CanvasImageSource | null> | null;
  ready?: Promise<void>;
};

interface MountedMediaPaint {
  container: HTMLElement;
  baseHost: HTMLElement;
  baseElement: Element;
  baseIdentity: string;
  paint: MediaPaint;
  paintIdentity: string;
  canvas: HTMLCanvasElement;
  padding: number;
  context: CanvasRenderingContext2D;
  source: HTMLVideoElement | HTMLImageElement | LiveMediaElement;
  fallback?: HTMLImageElement;
  abort: AbortController;
  mask: ReturnType<typeof createShaderPaintMask>;
  coverage: CanvasImageSource | null;
  native: NativeContent;
  options: RenderOptions;
  ready: Promise<void>;
  time: number;
  playing: boolean;
  playPending: boolean;
  requested: number;
  completed: number;
  busy: boolean;
  disposed: boolean;
  error?: Error;
  waiters: Array<{ revision: number; resolve: () => void }>;
}

const mountedMediaPaints = new WeakMap<HTMLElement, MountedMediaPaint>();

export function mediaFitRect(
  source: { width: number; height: number },
  target: { width: number; height: number },
  fit: MediaPaint['fit'],
  positionX: number,
  positionY: number,
  inset?: { x: number; y: number },
) {
  if (source.width <= 0 || source.height <= 0)
    throw new Error('Media paint source has no decoded dimensions.');
  const x = inset?.x ?? 0;
  const y = inset?.y ?? 0;
  const width = target.width - x * 2;
  const height = target.height - y * 2;
  if (fit === 'fill') return { x, y, width, height };
  const scale =
    fit === 'cover'
      ? Math.max(width / source.width, height / source.height)
      : Math.min(width / source.width, height / source.height);
  const paintedWidth = source.width * scale;
  const paintedHeight = source.height * scale;
  return {
    x: x + (width - paintedWidth) * positionX,
    y: y + (height - paintedHeight) * positionY,
    width: paintedWidth,
    height: paintedHeight,
  };
}

function requestedSize(container: HTMLElement, options: RenderOptions) {
  const width =
    options.shaderBackingSize?.width ||
    container.clientWidth ||
    Number.parseFloat(container.style.width) ||
    1;
  const height =
    options.shaderBackingSize?.height ||
    container.clientHeight ||
    Number.parseFloat(container.style.height) ||
    1;
  return { width: Math.max(1, Math.ceil(width)), height: Math.max(1, Math.ceil(height)) };
}

function mediaPaintBaseElement(element: Element): Element {
  if (element.type === 'image' || element.type === 'image-sequence' || element.type === 'lottie') {
    const { fill: _fill, ...base } = element;
    return base;
  }
  if (element.type === 'text')
    return {
      ...element,
      fill: 'transparent',
      color: 'transparent',
      runs: element.runs.map((run) => ({ ...run, color: 'transparent' })),
    };
  if ('fill' in element) return { ...element, fill: 'transparent' } as Element;
  return element;
}

export function waitForMediaClip(video: HTMLVideoElement, signal: AbortSignal): Promise<void> {
  if (!video.src) return Promise.resolve();
  if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0)
    return Promise.resolve();
  return new Promise((resolve, reject) => {
    const clear = () => {
      video.removeEventListener('loadeddata', loaded);
      video.removeEventListener('error', failed);
      signal.removeEventListener('abort', aborted);
      clearTimeout(timeout);
    };
    const loaded = () => {
      clear();
      resolve();
    };
    const failed = () => {
      clear();
      reject(new Error('Media clip could not be decoded by this browser.'));
    };
    const aborted = () => {
      clear();
      reject(new Error('Media paint was disposed before its clip became ready.'));
    };
    const timeout = setTimeout(() => {
      clear();
      reject(new Error('Media clip did not become ready within 10 seconds.'));
    }, 10_000);
    video.addEventListener('loadeddata', loaded, { once: true });
    video.addEventListener('error', failed, { once: true });
    signal.addEventListener('abort', aborted, { once: true });
  });
}

function waitForImage(image: HTMLImageElement, signal: AbortSignal): Promise<void> {
  if (!image.src) return Promise.resolve();
  if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const clear = () => {
      image.removeEventListener('load', loaded);
      image.removeEventListener('error', failed);
      signal.removeEventListener('abort', aborted);
      clearTimeout(timeout);
    };
    const loaded = () => {
      clear();
      resolve();
    };
    const failed = () => {
      clear();
      reject(new Error('Live media fallback image could not be decoded.'));
    };
    const aborted = () => {
      clear();
      reject(new Error('Media paint was disposed before its fallback became ready.'));
    };
    const timeout = setTimeout(() => {
      clear();
      reject(new Error('Live media fallback did not become ready within 10 seconds.'));
    }, 10_000);
    image.addEventListener('load', loaded, { once: true });
    image.addEventListener('error', failed, { once: true });
    signal.addEventListener('abort', aborted, { once: true });
  });
}

async function mediaSource(mounted: MountedMediaPaint): Promise<CanvasImageSource | null> {
  if (mounted.paint.source.kind === 'clip') {
    const video = mounted.source as HTMLVideoElement;
    return video.readyState >= 2 && video.videoWidth > 0 ? video : null;
  }
  const live = mounted.source as LiveMediaElement;
  await live.ready?.catch(() => undefined);
  const frame = await live.getFrame?.();
  if (frame) return frame;
  const fallback = mounted.fallback;
  return fallback?.complete && fallback.naturalWidth > 0 ? fallback : null;
}

function waitForMediaSeek(video: HTMLVideoElement, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error('Media paint was disposed during a seek.'));
  if (!video.seeking && video.readyState >= 2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const clear = () => {
      video.removeEventListener('seeked', loaded);
      video.removeEventListener('loadeddata', loaded);
      video.removeEventListener('error', failed);
      signal.removeEventListener('abort', aborted);
      clearTimeout(timeout);
    };
    const loaded = () => {
      if (video.seeking || video.readyState < 2) return;
      clear();
      resolve();
    };
    const failed = () => {
      clear();
      reject(new Error('Media clip could not decode the requested frame.'));
    };
    const aborted = () => {
      clear();
      reject(new Error('Media paint was disposed during a seek.'));
    };
    const timeout = setTimeout(() => {
      clear();
      reject(new Error('Media clip seek did not finish within 10 seconds.'));
    }, 10_000);
    video.addEventListener('seeked', loaded);
    video.addEventListener('loadeddata', loaded);
    video.addEventListener('error', failed);
    signal.addEventListener('abort', aborted, { once: true });
  });
}

async function syncClip(mounted: MountedMediaPaint, elapsedMs: number, playing: boolean) {
  if (mounted.paint.source.kind !== 'clip') return;
  const video = mounted.source as HTMLVideoElement;
  if (!video.src) return;
  const position = resolveMediaTimelinePosition(elapsedMs, {
    timelineStartMs: mounted.paint.timelineStartMs,
    trimStartMs: mounted.paint.offsetMs,
    trimEndMs: mounted.paint.trimEndMs,
    loop: mounted.paint.loop,
    speed: mounted.paint.speed,
    durationMs: Number.isFinite(video.duration) ? video.duration * 1000 : null,
  });
  if (!playing || !position.active) video.pause();
  if (!position.active) return;
  const seconds = position.positionMs / 1000;
  // Held frames must not drift forward and repeatedly seek back. Realtime playback allows a
  // small clock difference so normal decoder progress does not trigger a seek every frame.
  if (Math.abs(video.currentTime - seconds) > (playing ? 0.08 : 0.001)) video.currentTime = seconds;
  await waitForMediaSeek(video, mounted.abort.signal);
  if (mounted.disposed || !playing || !mounted.playing || mounted.playPending || !video.paused)
    return;
  mounted.playPending = true;
  void video
    .play()
    .catch(() => undefined)
    .finally(() => {
      mounted.playPending = false;
      if (mounted.disposed || !mounted.playing) video.pause();
    });
}

function sourceSize(source: CanvasImageSource): { width: number; height: number } {
  if (source instanceof HTMLVideoElement)
    return { width: source.videoWidth, height: source.videoHeight };
  if (source instanceof HTMLImageElement)
    return { width: source.naturalWidth, height: source.naturalHeight };
  return {
    width: 'width' in source ? Number(source.width) : 0,
    height: 'height' in source ? Number(source.height) : 0,
  };
}

function settle(mounted: MountedMediaPaint): void {
  mounted.waiters = mounted.waiters.filter((waiter) => {
    if (mounted.disposed || mounted.error || waiter.revision <= mounted.completed) {
      waiter.resolve();
      return false;
    }
    return true;
  });
}

function reportFailure(mounted: MountedMediaPaint, cause: unknown): void {
  mounted.error = cause instanceof Error ? cause : new Error(String(cause));
  mounted.container.dataset.ografMediaError = mounted.error.message;
}

function drawRequestedFrame(mounted: MountedMediaPaint): void {
  if (mounted.busy || mounted.disposed || mounted.error) return;
  const revision = mounted.requested;
  const elapsedMs = mounted.time;
  const playing = mounted.playing;
  mounted.busy = true;
  void (async () => {
    mounted.native.renderAtTime(mounted.baseHost, mounted.baseElement, elapsedMs);
    if (
      mounted.baseElement.type === 'chart' &&
      mounted.container.dataset.ografChartAnimationFrame !== undefined
    ) {
      mounted.baseHost.dataset.ografChartAnimationFrame =
        mounted.container.dataset.ografChartAnimationFrame;
      renderChartAnimationAtFrame(
        mounted.baseHost,
        mounted.baseElement,
        Number(mounted.container.dataset.ografChartAnimationFrame),
      );
    }
    const textFrame = Number(mounted.container.dataset.ografTextAnimationFrame);
    if (
      mounted.baseElement.type === 'text' &&
      mounted.container.dataset.ografTextAnimationFrame !== undefined &&
      Number.isFinite(textFrame)
    ) {
      renderTextAnimationAtFrame(mounted.baseHost, mounted.baseElement, textFrame);
    }
    await Promise.all([mounted.ready, mounted.native.ready(mounted.baseHost), mounted.mask.ready]);
    if (mounted.disposed) return;
    await syncClip(mounted, elapsedMs, playing);
    const nextCoverage = await mounted.mask.update(elapsedMs);
    const source = await mediaSource(mounted);
    if (mounted.disposed) return;
    // null means the mask is unchanged, not that the moving media should become unmasked.
    if (nextCoverage) mounted.coverage = nextCoverage;
    // A decoder or live source can temporarily have no frame. Keep the last complete output
    // instead of exposing a transparent canvas between decoded frames.
    if (!source) return;
    const { baseHost, canvas, context, padding, paint } = mounted;
    context.resetTransform();
    context.globalCompositeOperation = 'source-over';
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (source && mounted.coverage) {
      const crop = sourceCropPixels(sourceSize(source), paint.crop);
      // Padding expands the coverage surface without stretching the media inside the text box.
      const inset = padding
        ? {
            x:
              (canvas.width * padding) /
              (baseHost.clientWidth ? baseHost.clientWidth + padding * 2 : canvas.width),
            y:
              (canvas.height * padding) /
              (baseHost.clientHeight ? baseHost.clientHeight + padding * 2 : canvas.height),
          }
        : undefined;
      const rect = mediaFitRect(crop, canvas, paint.fit, paint.positionX, paint.positionY, inset);
      if (paint.crop)
        context.drawImage(
          source,
          crop.x,
          crop.y,
          crop.width,
          crop.height,
          rect.x,
          rect.y,
          rect.width,
          rect.height,
        );
      else context.drawImage(source, rect.x, rect.y, rect.width, rect.height);
      context.globalCompositeOperation = 'destination-in';
      try {
        context.drawImage(mounted.coverage, 0, 0, canvas.width, canvas.height);
      } finally {
        context.globalCompositeOperation = 'source-over';
      }
      // A held clock leaves an effect stack's capture signature unchanged, so record which picture
      // this canvas now holds: a clip's decoded position, or each new frame of a live source.
      const frame =
        source instanceof HTMLVideoElement
          ? source.currentTime
          : source === mounted.fallback
            ? 'fallback'
            : revision;
      canvas.dataset.ografMediaFrame = String(frame);
    }
  })()
    .catch((error: unknown) => {
      if (!mounted.disposed) reportFailure(mounted, error);
    })
    .finally(() => {
      mounted.busy = false;
      mounted.completed = Math.max(mounted.completed, revision);
      settle(mounted);
      if (mounted.completed < mounted.requested) drawRequestedFrame(mounted);
    });
}

function requestFrame(mounted: MountedMediaPaint, elapsedMs: number, playing = false): void {
  // Readiness reports the error to the caller/editor. Do not throw it through an animation frame,
  // which would unmount the surrounding React canvas instead of keeping the fault layer-local.
  if (mounted.error) return;
  mounted.time = elapsedMs;
  mounted.playing = playing;
  if (!playing && mounted.paint.source.kind === 'clip')
    (mounted.source as HTMLVideoElement).pause();
  mounted.requested += 1;
  drawRequestedFrame(mounted);
}

export function mountMediaPaintContent(
  container: HTMLElement,
  element: Element,
  options: RenderOptions,
  native: NativeContent,
): void {
  const paint = getElementMediaPaint(element);
  if (!paint) throw new Error('The element has no media paint.');
  const abort = new AbortController();
  const visualHost = container.ownerDocument.createElement('div');
  visualHost.dataset.ografMediaPaint = 'true';
  Object.assign(visualHost.style, {
    position: 'relative',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
  });
  container.appendChild(visualHost);
  const baseHost = container.ownerDocument.createElement('div');
  baseHost.dataset.ografMediaBase = 'true';
  Object.assign(baseHost.style, {
    position: 'absolute',
    inset: '0',
    zIndex: element.type === 'chart' ? 'auto' : '1',
  });
  visualHost.appendChild(baseHost);
  const baseElement = mediaPaintBaseElement(element);
  if (['image', 'image-sequence', 'lottie'].includes(element.type)) baseHost.style.opacity = '0';
  native.render(baseHost, baseElement, { ...options, requiresImageAlpha: true });
  const size = requestedSize(container, options);
  const padding = textClipPadding(element);
  const canvasSize = { width: size.width + padding * 2, height: size.height + padding * 2 };
  const canvas = container.ownerDocument.createElement('canvas');
  canvas.width = canvasSize.width;
  canvas.height = canvasSize.height;
  canvas.dataset.ografMediaCanvas = 'true';
  Object.assign(canvas.style, {
    position: 'absolute',
    inset: padding ? `-${padding}px` : '0',
    width: padding ? `calc(100% + ${padding * 2}px)` : '100%',
    height: padding ? `calc(100% + ${padding * 2}px)` : '100%',
    zIndex: element.type === 'chart' ? '1' : '0',
  });
  visualHost.appendChild(canvas);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Media paint requires Canvas 2D rendering support.');
  let source: HTMLVideoElement | HTMLImageElement | LiveMediaElement;
  let fallback: HTMLImageElement | undefined;
  let ready: Promise<void>;
  if (paint.source.kind === 'clip') {
    const video = container.ownerDocument.createElement('video');
    video.dataset.ografMediaClip = 'true';
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.loop = paint.loop;
    video.playbackRate = paint.speed;
    const clipSource = paint.source.src.trim();
    Object.assign(video.style, {
      position: 'absolute',
      width: '1px',
      height: '1px',
      opacity: '0',
      pointerEvents: 'none',
    });
    visualHost.appendChild(video);
    source = video;
    if (clipSource) {
      video.src = clipSource;
      video.load();
      ready = waitForMediaClip(video, abort.signal);
    } else {
      visualHost.dataset.ografMediaPending = 'true';
      ready = Promise.resolve();
    }
  } else {
    const live = container.ownerDocument.createElement(LIVE_MEDIA_ELEMENT_TAG) as LiveMediaElement;
    live.dataset.ografMediaLive = 'true';
    live.dataset.sourceTag = paint.source.tag;
    live.dataset.version = '1';
    Object.assign(live.style, {
      position: 'absolute',
      width: '1px',
      height: '1px',
      opacity: '0',
      pointerEvents: 'none',
    });
    visualHost.appendChild(live);
    source = live;
    if (paint.source.fallback) {
      fallback = container.ownerDocument.createElement('img');
      fallback.src = paint.source.fallback;
      fallback.alt = '';
      Object.assign(fallback.style, {
        position: 'absolute',
        width: '1px',
        height: '1px',
        opacity: '0',
        pointerEvents: 'none',
      });
      visualHost.appendChild(fallback);
    }
    ready = fallback ? waitForImage(fallback, abort.signal) : Promise.resolve();
  }
  const mask = createShaderPaintMask(baseHost, element, canvasSize, {
    padding,
    refreshTextLayout: () => native.refreshLayout(baseHost),
  });
  const mounted: MountedMediaPaint = {
    container,
    baseHost,
    baseElement,
    baseIdentity: JSON.stringify(baseElement),
    paint,
    paintIdentity: JSON.stringify(paint),
    canvas,
    padding,
    context,
    source,
    ...(fallback ? { fallback } : {}),
    abort,
    mask,
    coverage: null,
    native,
    options,
    ready,
    time: 0,
    playing: false,
    playPending: false,
    requested: 0,
    completed: -1,
    busy: false,
    disposed: false,
    waiters: [],
  };
  mountedMediaPaints.set(container, mounted);
  void ready.catch((error: unknown) => reportFailure(mounted, error));
  requestFrame(mounted, 0);
}

export function updateMediaPaintContent(
  container: HTMLElement,
  element: Element,
  _options: RenderOptions,
): boolean {
  const mounted = mountedMediaPaints.get(container);
  const paint = getElementMediaPaint(element);
  if (!mounted || !paint) return false;
  if (mounted.paintIdentity !== JSON.stringify(paint)) return false;
  const baseElement = mediaPaintBaseElement(element);
  const identity = JSON.stringify(baseElement);
  if (mounted.baseIdentity !== identity) {
    if (element.type !== 'chart') return false;
    // Chart data edits must not restart their retained video/live decoder.
    mounted.native.render(mounted.baseHost, baseElement, {
      ...mounted.options,
      requiresImageAlpha: true,
    });
    mounted.baseElement = baseElement;
    mounted.baseIdentity = identity;
    mounted.mask.dispose();
    mounted.mask = createShaderPaintMask(mounted.baseHost, element, {
      width: mounted.canvas.width,
      height: mounted.canvas.height,
    });
    mounted.coverage = null;
  }
  requestFrame(mounted, mounted.time, mounted.playing);
  return true;
}

export function renderMediaPaintAtTime(
  container: HTMLElement,
  elapsedMs: number,
  playing = false,
): boolean {
  const mounted = mountedMediaPaints.get(container);
  if (!mounted) return false;
  requestFrame(mounted, elapsedMs, playing);
  return true;
}

export async function waitForMediaPaintContentReady(root: ParentNode): Promise<void> {
  const entries = [root, ...root.querySelectorAll<HTMLElement>('*')]
    .map((element) => mountedMediaPaints.get(element as HTMLElement))
    .filter((entry): entry is MountedMediaPaint => !!entry);
  await Promise.all(
    entries.map((entry) => {
      if (entry.error || entry.disposed || entry.completed >= entry.requested)
        return Promise.resolve();
      return new Promise<void>((resolve) =>
        entry.waiters.push({ revision: entry.requested, resolve }),
      );
    }),
  );
  const failed = entries.find((entry) => entry.error || entry.disposed);
  if (failed) throw failed.error ?? new Error('Media paint was disposed before becoming ready.');
}

export function disposeMediaPaintContent(container: HTMLElement): void {
  const mounted = mountedMediaPaints.get(container);
  if (!mounted) return;
  mounted.disposed = true;
  mounted.abort.abort();
  mounted.mask.dispose();
  mounted.coverage = null;
  mounted.native.dispose(mounted.baseHost);
  if (mounted.source instanceof HTMLVideoElement) {
    mounted.source.pause();
    mounted.source.removeAttribute('src');
    mounted.source.load();
  }
  mounted.canvas.width = mounted.canvas.height = 1;
  settle(mounted);
  mountedMediaPaints.delete(container);
}
