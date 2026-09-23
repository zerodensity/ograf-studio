import { toCanvas } from 'html-to-image';
import {
  effectEnabled,
  effectStackPadding,
  effectStackToCss,
  getEffectStack,
  type EffectBlendMode,
  type LayerEffect,
  type LayerEffects,
} from '@ograf-editor/scene-model';
import { createShaderRenderer, type ShaderRenderer } from './shaderRendering';

interface ShaderStage {
  canvas: HTMLCanvasElement;
  renderer: ShaderRenderer;
  source: string;
  scale: number;
  width: number;
  height: number;
}

class ShaderEffectStackController {
  readonly host: HTMLElement;
  readonly output: HTMLCanvasElement;
  readonly originals = new Map<HTMLElement, string>();
  readonly shaders = new Map<string, ShaderStage>();
  effects: LayerEffects;
  elapsedMs = 0;
  requested = 0;
  completed = 0;
  busy = false;
  disposed = false;
  error: Error | null = null;
  baseCanvas: HTMLCanvasElement | null = null;
  baseSignature = '';
  waiters: Array<{ revision: number; resolve: () => void }> = [];

  constructor(host: HTMLElement, effects: LayerEffects) {
    this.host = host;
    this.effects = effects;
    this.output = host.ownerDocument.createElement('canvas');
    this.output.dataset.ografShaderEffectOutput = 'true';
    this.output.setAttribute('aria-hidden', 'true');
    Object.assign(this.output.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: '2147483646',
    });
    host.appendChild(this.output);
  }

  contentChildren(): HTMLElement[] {
    return [...this.host.children].filter(
      (child) =>
        child !== this.output &&
        (child as HTMLElement).dataset.ografRuntimeAuxiliary !== 'true' &&
        (child as HTMLElement).dataset.ografEffectFilter !== 'true',
    ) as HTMLElement[];
  }

  showOriginals(): void {
    for (const child of this.contentChildren()) {
      if (!this.originals.has(child)) this.originals.set(child, child.style.opacity);
      child.style.opacity = this.originals.get(child) ?? '';
    }
  }

  hideOriginals(): void {
    for (const child of this.contentChildren()) {
      if (!this.originals.has(child)) this.originals.set(child, child.style.opacity);
      child.style.opacity = '0';
    }
  }

  size(): { width: number; height: number } {
    return {
      width: Math.max(
        1,
        Math.round(Number.parseFloat(this.host.style.width) || this.host.clientWidth || 1),
      ),
      height: Math.max(
        1,
        Math.round(Number.parseFloat(this.host.style.height) || this.host.clientHeight || 1),
      ),
    };
  }

  sourceSignature(width: number, height: number): string {
    const images = [...this.host.querySelectorAll('img')].map(
      (image) => image.currentSrc || image.src,
    );
    const dynamicCanvas = [...this.host.querySelectorAll('canvas')].some(
      (canvas) => canvas !== this.output && canvas.dataset.ografShaderEffectStage !== 'true',
    );
    return JSON.stringify([
      this.host.dataset.ografRenderedElement,
      width,
      height,
      images,
      dynamicCanvas ? this.elapsedMs : null,
    ]);
  }

  async captureBase(): Promise<HTMLCanvasElement> {
    const { width, height } = this.size();
    const padding = effectStackPadding(this.effects);
    const signature = `${this.sourceSignature(width, height)}:${padding}`;
    if (this.baseCanvas && signature === this.baseSignature) return this.baseCanvas;
    this.showOriginals();
    this.output.style.display = 'none';
    try {
      const captured = await toCanvas(this.host, {
        width,
        height,
        canvasWidth: width,
        canvasHeight: height,
        pixelRatio: 1,
        cacheBust: false,
        style: {
          transform: 'none',
          transformOrigin: '0 0',
          opacity: '1',
          filter: 'none',
          mixBlendMode: 'normal',
        },
        filter: (node) => {
          const dataset = (node as HTMLElement).dataset;
          return (
            !dataset ||
            (dataset.ografShaderEffectOutput !== 'true' && dataset.ografEffectFilter !== 'true')
          );
        },
      });
      if (padding > 0) {
        this.baseCanvas = this.canvas(width + padding * 2, height + padding * 2);
        this.baseCanvas.getContext('2d')?.drawImage(captured, padding, padding);
        Object.assign(this.output.style, {
          left: `${-padding}px`,
          top: `${-padding}px`,
          width: `calc(100% + ${padding * 2}px)`,
          height: `calc(100% + ${padding * 2}px)`,
        });
      } else {
        this.baseCanvas = captured;
        Object.assign(this.output.style, { left: '0', top: '0', width: '100%', height: '100%' });
      }
      this.baseSignature = signature;
      return this.baseCanvas;
    } finally {
      this.hideOriginals();
      this.output.style.display = 'block';
    }
  }

  canvas(width: number, height: number): HTMLCanvasElement {
    const canvas = this.host.ownerDocument.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.dataset.ografShaderEffectStage = 'true';
    return canvas;
  }

  blendMode(mode: EffectBlendMode): GlobalCompositeOperation {
    if (mode === 'add') return 'lighter';
    return mode === 'normal' ? 'source-over' : mode;
  }

  applyCanvasEffect(input: HTMLCanvasElement, effect: LayerEffect): HTMLCanvasElement {
    const processed = this.canvas(input.width, input.height);
    const processedContext = processed.getContext('2d');
    if (!processedContext) throw new Error('Effect stack requires Canvas 2D support.');
    processedContext.filter = effectStackToCss({
      ...this.effects,
      stack: [{ ...effect, blendMode: 'normal', blendOpacity: 1 }],
    });
    processedContext.drawImage(input, 0, 0);
    const opacity = effect.blendOpacity ?? 1;
    const mode = effect.blendMode ?? 'normal';
    if (mode === 'normal' && opacity === 1) return processed;
    const output = this.canvas(input.width, input.height);
    const context = output.getContext('2d');
    if (!context) throw new Error('Effect stack requires Canvas 2D support.');
    context.drawImage(input, 0, 0);
    context.globalAlpha = opacity;
    context.globalCompositeOperation = this.blendMode(mode);
    context.drawImage(processed, 0, 0);
    return output;
  }

  async applyShaderEffect(
    input: HTMLCanvasElement,
    effect: LayerEffect,
  ): Promise<HTMLCanvasElement> {
    if (!effect.shader) throw new Error(`${effect.name} has no shader source.`);
    let stage = this.shaders.get(effect.id);
    if (
      !stage ||
      stage.source !== effect.shader.fragmentSource ||
      stage.scale !== effect.shader.resolutionScale ||
      stage.width !== input.width ||
      stage.height !== input.height
    ) {
      stage?.renderer.dispose();
      const canvas = this.canvas(input.width, input.height);
      const renderer = createShaderRenderer(
        canvas,
        effect.shader,
        { width: input.width, height: input.height },
        () => {},
        false,
        {
          blendMode: effect.blendMode ?? 'normal',
          blendOpacity: effect.blendOpacity ?? 1,
        },
      );
      stage = {
        canvas,
        renderer,
        source: effect.shader.fragmentSource,
        scale: effect.shader.resolutionScale,
        width: input.width,
        height: input.height,
      };
      this.shaders.set(effect.id, stage);
    } else {
      stage.renderer.updateParameters(effect.shader);
      stage.renderer.setEffectBlend({
        blendMode: effect.blendMode ?? 'normal',
        blendOpacity: effect.blendOpacity ?? 1,
      });
    }
    stage.renderer.setInput(input);
    stage.renderer.render(this.elapsedMs);
    await stage.renderer.ready();
    return stage.canvas;
  }

  async render(revision: number): Promise<void> {
    let result = await this.captureBase();
    const liveShaderIds = new Set<string>();
    for (const effect of getEffectStack(this.effects)) {
      if (!effectEnabled(effect, this.effects) || effect.blendOpacity === 0) continue;
      if (effect.type === 'shader') {
        liveShaderIds.add(effect.id);
        result = await this.applyShaderEffect(result, effect);
      } else result = this.applyCanvasEffect(result, effect);
    }
    for (const [id, stage] of this.shaders) {
      if (liveShaderIds.has(id)) continue;
      stage.renderer.dispose();
      this.shaders.delete(id);
    }
    if (this.disposed || revision !== this.requested) return;
    if (this.output.width !== result.width) this.output.width = result.width;
    if (this.output.height !== result.height) this.output.height = result.height;
    const context = this.output.getContext('2d');
    if (!context) throw new Error('Shader effect output requires Canvas 2D support.');
    context.clearRect(0, 0, this.output.width, this.output.height);
    context.drawImage(result, 0, 0);
    delete this.host.dataset.ografEffectError;
    this.error = null;
  }

  settle(): void {
    this.waiters = this.waiters.filter((waiter) => {
      if (this.error || this.disposed || waiter.revision <= this.completed) {
        waiter.resolve();
        return false;
      }
      return true;
    });
  }

  run(): void {
    if (this.busy || this.disposed) return;
    const revision = this.requested;
    this.busy = true;
    void this.render(revision)
      .catch((cause: unknown) => {
        this.error = cause instanceof Error ? cause : new Error(String(cause));
        this.host.dataset.ografEffectError = this.error.message;
        this.showOriginals();
        this.output.style.display = 'none';
      })
      .finally(() => {
        this.completed = Math.max(this.completed, revision);
        this.busy = false;
        this.settle();
        if (this.completed < this.requested) this.run();
      });
  }

  update(effects: LayerEffects, elapsedMs: number): void {
    this.effects = effects;
    this.elapsedMs = elapsedMs;
    this.requested += 1;
    this.run();
  }

  ready(): Promise<void> {
    if (this.error) return Promise.reject(this.error);
    if (this.completed >= this.requested) return Promise.resolve();
    return new Promise<void>((resolve) =>
      this.waiters.push({ revision: this.requested, resolve }),
    ).then(() => {
      if (this.error) throw this.error;
    });
  }

  dispose(): void {
    this.disposed = true;
    for (const stage of this.shaders.values()) stage.renderer.dispose();
    this.shaders.clear();
    this.showOriginals();
    this.output.remove();
    this.settle();
  }
}

const shaderStacks = new WeakMap<HTMLElement, ShaderEffectStackController>();

export function applyShaderEffectStack(
  host: HTMLElement,
  effects: LayerEffects,
  elapsedMs: number,
): void {
  let controller = shaderStacks.get(host);
  if (!controller) {
    controller = new ShaderEffectStackController(host, effects);
    shaderStacks.set(host, controller);
  }
  controller.update(effects, elapsedMs);
}

export function removeShaderEffectStack(host: HTMLElement): void {
  const controller = shaderStacks.get(host);
  if (!controller) return;
  controller.dispose();
  shaderStacks.delete(host);
}

export async function waitForShaderEffectStacksReady(root: ParentNode): Promise<void> {
  const controllers = [root, ...root.querySelectorAll<HTMLElement>('*')].flatMap((element) => {
    const controller = shaderStacks.get(element as HTMLElement);
    return controller ? [controller] : [];
  });
  await Promise.all(controllers.map((controller) => controller.ready()));
}
