import { createShaderRenderer } from '@ograf-editor/ograf-runtime';
import type { ShaderPaint } from '@ograf-editor/scene-model';
import { shaderResourcePreviewPaint } from '../state/shaderResources';

export type ShaderThumbnailResult =
  { kind: 'ready'; dataUrl: string } | { kind: 'error'; message: string };

const imageInputKeys = new WeakMap<object, string>();

export function shaderImageInputKey(paint: ShaderPaint): string | null {
  if (!paint.inputImage) return null;
  const cached = imageInputKeys.get(paint.inputImage);
  if (cached) return cached;
  let hash = 2166136261;
  for (let index = 0; index < paint.inputImage.source.length; index++) {
    hash ^= paint.inputImage.source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const key = `${paint.inputImage.source.length}:${(hash >>> 0).toString(16)}:${paint.inputImage.wrap}:${paint.inputImage.filter}`;
  imageInputKeys.set(paint.inputImage, key);
  return key;
}

export function shaderThumbnailKey(paint: ShaderPaint): string {
  return JSON.stringify([
    paint.fragmentSource,
    paint.speed,
    paint.resolutionScale,
    shaderImageInputKey(paint),
    Object.entries(paint.parameters ?? {}).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
  ]);
}

const failure = (error: unknown): ShaderThumbnailResult => ({
  kind: 'error',
  message: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
});

/** Stores only small PNG strings/errors. GPU objects never survive a thumbnail request. */
export class ShaderThumbnailCache {
  #entries = new Map<string, ShaderThumbnailResult>();
  #pending = new Map<string, Promise<ShaderThumbnailResult>>();
  #tail: Promise<void> = Promise.resolve();
  #limit: number;

  constructor(limit = 32) {
    this.#limit = Number.isFinite(limit) ? Math.max(1, Math.min(128, Math.floor(limit))) : 32;
  }

  async get(ownerDocument: Document, paint: ShaderPaint): Promise<ShaderThumbnailResult> {
    const key = shaderThumbnailKey(paint);
    const cached = this.#entries.get(key);
    if (cached) {
      this.#entries.delete(key);
      this.#entries.set(key, cached);
      return cached;
    }
    const existing = this.#pending.get(key);
    if (existing) return existing;
    // Deferred rows may mount together. Serialize their short-lived snapshots so opening
    // a large resource list cannot evict active broadcast graphics' WebGL contexts.
    const job = this.#tail.then(() => this.#render(ownerDocument, paint, key));
    this.#pending.set(key, job);
    this.#tail = job.then(
      () => undefined,
      () => undefined,
    );
    try {
      return await job;
    } finally {
      this.#pending.delete(key);
    }
  }

  async #render(
    ownerDocument: Document,
    paint: ShaderPaint,
    key: string,
  ): Promise<ShaderThumbnailResult> {
    let canvas: HTMLCanvasElement | undefined;
    let renderer: ReturnType<typeof createShaderRenderer> | undefined;
    let result: ShaderThumbnailResult = {
      kind: 'error',
      message: 'Shader preview is unavailable.',
    };
    try {
      canvas = ownerDocument.createElement('canvas');
      renderer = createShaderRenderer(canvas, shaderResourcePreviewPaint(paint), {
        width: 160,
        height: 90,
      });
      await renderer.ready();
      renderer.render(2000);
      const dataUrl = canvas.toDataURL('image/png');
      if (!dataUrl.startsWith('data:image/png'))
        throw new Error('Shader preview could not be captured.');
      result = { kind: 'ready', dataUrl };
    } catch (error) {
      result = failure(error);
    } finally {
      try {
        renderer?.dispose();
      } catch (error) {
        result = failure(error);
      } finally {
        if (canvas) {
          canvas.width = 1;
          canvas.height = 1;
          canvas.remove();
        }
      }
    }
    this.#entries.set(key, result);
    if (this.#entries.size > this.#limit) {
      const oldest = this.#entries.keys().next().value;
      if (oldest !== undefined) this.#entries.delete(oldest);
    }
    return result;
  }
}

export const shaderThumbnailCache = new ShaderThumbnailCache();

/** Defer offscreen GPU work until the mounted resource row has survived the current render. */
export function scheduleShaderThumbnail(
  owner: { document: Document; window: Pick<Window, 'setTimeout' | 'clearTimeout'> },
  paint: ShaderPaint,
  onReady: (result: ShaderThumbnailResult) => void,
  cache = shaderThumbnailCache,
): () => void {
  let active = true;
  const timer = owner.window.setTimeout(() => {
    if (!active) return;
    void cache.get(owner.document, paint).then((result) => {
      if (active) onReady(result);
    });
  }, 0);
  return () => {
    active = false;
    owner.window.clearTimeout(timer);
  };
}
