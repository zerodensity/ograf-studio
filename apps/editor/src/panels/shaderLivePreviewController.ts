import { createShaderRenderer } from '@ograf-editor/ograf-runtime';
import type { ShaderPaint } from '@ograf-editor/scene-model';
import { shaderImageInputKey, shaderThumbnailKey } from './shaderThumbnailCache';

interface PreviewOwner {
  document: Document;
  window: Pick<Window, 'requestAnimationFrame' | 'cancelAnimationFrame' | 'performance'>;
}

/** One disposable GPU context and an owner-window clock for the source editor's live draft. */
export class ShaderLivePreviewController {
  private readonly host: HTMLElement;
  private readonly owner: PreviewOwner;
  private readonly onError: (message: string | null) => void;
  #renderer: ReturnType<typeof createShaderRenderer> | undefined;
  #canvas: HTMLCanvasElement | undefined;
  #paint: ShaderPaint | undefined;
  #source: string | undefined;
  #scale: number | undefined;
  #inputKey: string | undefined;
  #appliedKey: string | undefined;
  #frame: number | null = null;
  #elapsed = 0;
  #epoch = 0;
  #running = false;
  #disposed = false;
  #message: string | null | undefined;

  constructor(host: HTMLElement, owner: PreviewOwner, onError: (message: string | null) => void) {
    this.host = host;
    this.owner = owner;
    this.onError = onError;
    owner.document.addEventListener('visibilitychange', this.#visibilityChanged);
  }

  #report(error: unknown): void {
    if (this.#disposed) return;
    const message =
      error === null
        ? null
        : (error instanceof Error ? error.message : String(error)).slice(0, 1000);
    if (message === this.#message) return;
    this.#message = message;
    this.onError(message);
  }

  #time(): number {
    return (
      this.#elapsed +
      (this.#running ? Math.max(0, this.owner.window.performance.now() - this.#epoch) : 0)
    );
  }

  #pause(): void {
    this.#elapsed = this.#time();
    this.#running = false;
    if (this.#frame !== null) this.owner.window.cancelAnimationFrame(this.#frame);
    this.#frame = null;
  }

  #draw = (): void => {
    this.#frame = null;
    if (this.#disposed || this.owner.document.hidden || !this.#renderer) {
      this.#pause();
      return;
    }
    try {
      this.#renderer.render(this.#time());
      this.#frame = this.owner.window.requestAnimationFrame(this.#draw);
    } catch (error) {
      this.#pause();
      this.#report(error);
    }
  };

  #resume(): void {
    if (this.#disposed || this.owner.document.hidden || this.#running || !this.#renderer) return;
    this.#epoch = this.owner.window.performance.now();
    this.#running = true;
    this.#frame = this.owner.window.requestAnimationFrame(this.#draw);
  }

  #release(): void {
    const renderer = this.#renderer;
    this.#renderer = undefined;
    this.#canvas?.removeEventListener('webglcontextrestored', this.#visibilityChanged);
    try {
      renderer?.dispose();
    } finally {
      if (this.#canvas) {
        this.#canvas.width = 1;
        this.#canvas.height = 1;
        this.#canvas.remove();
      }
      this.#canvas = undefined;
      this.#appliedKey = undefined;
    }
  }

  #visibilityChanged = (): void => {
    if (this.owner.document.hidden) this.#pause();
    else if (this.#paint) this.update(this.#paint);
  };

  update(paint: ShaderPaint): void {
    if (this.#disposed) return;
    this.#paint = paint;
    // Hidden windows do no compiling/drawing; apply the latest pending draft when shown again.
    if (this.owner.document.hidden) return;
    const key = shaderThumbnailKey(paint);
    if (key === this.#appliedKey && this.#renderer) {
      this.#report(null);
      this.#resume();
      return;
    }
    try {
      if (
        !this.#renderer ||
        this.#source !== paint.fragmentSource ||
        this.#scale !== paint.resolutionScale ||
        this.#inputKey !== (shaderImageInputKey(paint) ?? undefined)
      ) {
        this.#pause();
        this.#release();
        const canvas = this.owner.document.createElement('canvas');
        canvas.dataset.ografShaderLivePreview = 'true';
        canvas.setAttribute('aria-hidden', 'true');
        this.#canvas = canvas;
        this.host.replaceChildren(canvas);
        this.#renderer = createShaderRenderer(canvas, paint, { width: 480, height: 270 }, (error) =>
          this.#report(error),
        );
        canvas.addEventListener('webglcontextrestored', this.#visibilityChanged);
        this.#source = paint.fragmentSource;
        this.#scale = paint.resolutionScale;
        this.#inputKey = shaderImageInputKey(paint) ?? undefined;
      } else {
        this.#renderer.updateParameters(paint);
      }
      this.#renderer.render(this.#time());
      this.#appliedKey = key;
      this.#report(null);
      this.#resume();
    } catch (error) {
      this.#pause();
      // createShaderRenderer releases partial allocations itself; discard its failed canvas too.
      if (!this.#renderer) this.#release();
      this.#report(error);
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#pause();
    this.#disposed = true;
    this.owner.document.removeEventListener('visibilitychange', this.#visibilityChanged);
    this.#release();
  }
}
